import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-connection/client';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type { ManagedSkillDetail, ManagedSkillResource, ManagedSkillSummary, SkillBatchAction, SkillBatchResult, SkillCatalogSummary, SkillDependencyImpact, SkillInstallScope, SkillMutationReceipt, SkillResourceWriteRequest, SkillWriteRequest, StagedSkillImport, TrashedSkillSummary } from '../shared.js';

const path = '/api/workspace-skills';
const exportPath = '/api/workspace-skills/export';

/** Parsed `content-disposition` filename (RFC 5987 `filename*` preferred). */
function fileNameOf(disposition: string | null, fallback: string): string {
  if (disposition === null) return fallback;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (utf8?.[1]) { try { return decodeURIComponent(utf8[1]); } catch { /* fall through */ } }
  const ascii = /filename="?([^";]+)"?/i.exec(disposition);
  return ascii?.[1] ? ascii[1] : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function failure(value: unknown): Error {
  if (isRecord(value) && typeof value.message === 'string') return Object.assign(new Error(value.message), { code: typeof value.code === 'string' ? value.code : 'skill/request-failed' });
  return new Error('技能操作失败，请重试。');
}

function transportFailure(cause: unknown): Error {
  if (cause instanceof DOMException && cause.name === 'TimeoutError') return Object.assign(new Error('请求超时，请检查连接后重试。'), { code: 'skill/request-timeout' });
  if (cause instanceof DOMException && cause.name === 'AbortError') return Object.assign(new Error('操作已取消。'), { code: 'skill/request-cancelled' });
  return cause instanceof Error ? cause : new Error('无法连接技能管理服务，请重试。');
}

async function request<T>(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await fetch(url, { ...init, signal: requestSignal });
    const result = await response.json() as { ok?: boolean; value?: unknown; error?: unknown };
    if (!result.ok) throw failure(result.error);
    return result.value as T;
  } catch (cause) {
    throw transportFailure(cause);
  }
}

async function call<T>(ctx: Context, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<T> {
  void ctx;
  return request<T>(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint, payload }),
  }, endpoint === 'commit-import' || endpoint === 'install-catalog' ? 60_000 : 30_000, signal);
}

export function createSkillManagementClient(ctx: Context, lifetime?: AbortSignal) {
  const scoped = (signal?: AbortSignal) => lifetime && signal ? AbortSignal.any([lifetime, signal]) : lifetime ?? signal;
  const invoke = <T>(endpoint: string, payload: unknown, signal?: AbortSignal) => call<T>(ctx, endpoint, payload, scoped(signal));
  return {
    list: () => invoke<readonly ManagedSkillSummary[]>('list', {}),
    catalog: () => invoke<SkillCatalogSummary>('catalog', {}),
    installFromCatalog: (name: string) => invoke<SkillMutationReceipt>('install-catalog', { name }),
    detail: (name: string) => invoke<ManagedSkillDetail>('detail', { name }),
    update: (request: SkillWriteRequest) => invoke<ManagedSkillDetail>('update', request),
    resource: (name: string, resourcePath: string) => invoke<ManagedSkillResource>('resource', { name, path: resourcePath }),
    writeResource: (request: SkillResourceWriteRequest) => invoke<ManagedSkillResource>('write-resource', request),
    setEnabled: (name: string, enabled: boolean) => invoke<SkillMutationReceipt>('set-enabled', { name, enabled }),
    dependencyImpact: (name: string) => invoke<SkillDependencyImpact>('dependency-impact', { name }),
    uninstall: (name: string, expectedImpactRevision: string) => invoke<SkillMutationReceipt>('uninstall', { name, expectedImpactRevision }),
    batch: (names: readonly string[], action: SkillBatchAction) => invoke<SkillBatchResult>('batch', { names, action }),
    listTrash: () => invoke<readonly TrashedSkillSummary[]>('trash-list', {}),
    restore: (id: string) => invoke<SkillMutationReceipt>('restore', { id }),
    stageImport: async (file: File, signal?: AbortSignal) => {
      return request<StagedSkillImport>(`${path}/import`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': file.type || 'application/octet-stream', 'x-workspace-file-name': encodeURIComponent(file.name) },
        body: file,
      }, 120_000, scoped(signal));
    },
    commitImport: (id: string, scope: SkillInstallScope, title?: string, signal?: AbortSignal) => invoke<SkillMutationReceipt>('commit-import', { id, scope, ...(title?.trim() ? { title: title.trim() } : {}) }, signal),
    discardImport: (id: string) => invoke<null>('discard-import', { id }),
    openDirectory: async (path: string) => {
      lifetime?.throwIfAborted();
      const result = await ctx.remote.session.openWorkspacePath({ path, action: 'reveal' });
      if (!result.ok) throw failure(result.error);
    },
    /** Binary download of one skill archive; triggers a browser save. */
    downloadExport: async (name: string): Promise<{ fileName: string; bytes: number; digest: string }> => {
      const timeout = AbortSignal.timeout(60_000);
      const requestSignal = lifetime ? AbortSignal.any([lifetime, timeout]) : timeout;
      let response: Response;
      try {
        response = await fetch(exportPath, {
          method: 'POST', credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
          signal: requestSignal,
        });
      } catch (cause) { throw transportFailure(cause); }
      if ((response.headers.get('content-type') ?? '').includes('application/json')) {
        const result = await response.json().catch(() => undefined) as { ok?: boolean; error?: unknown } | undefined;
        throw failure(result?.ok ? undefined : result?.error);
      }
      if (!response.ok) throw transportFailure(new Error('导出失败，请重试。'));
      const blob = await response.blob();
      const fileName = fileNameOf(response.headers.get('content-disposition'), `${name}.zip`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = fileName;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      URL.revokeObjectURL(url);
      return { fileName, bytes: blob.size, digest: response.headers.get('x-workspace-digest') ?? '' };
    },
  };
}

export type SkillManagementClient = ReturnType<typeof createSkillManagementClient>;
