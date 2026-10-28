import { Button, Input } from 'workspace-ui';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// The `main` slot PropsRuntime is augmented by the official layout client module;
// without this side-effect type import the slot name resolves to `never`.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { Icon, Modal, type IconName } from 'workspace-ui';
import { EXPERT_LIMITS, type ExpertAvailability, type ExpertSummary } from '../shared.js';
import type { ExpertManagementClient } from './management.js';
import { ExpertDetailModal } from './ExpertDetailModal.js';
import { expertDraftId } from '../domain/navigation.js';
import { ExpertDraftEditor } from './ExpertDraftEditor.js';
import { ImportExpertModal } from './ImportExportModals.js';
import { TagEditor } from './TagEditor.js';
import { expertsCss } from './styles.js';

type ExpertsPanelInjected = {
  toggleNavigation: () => void;
  management: ExpertManagementClient;
  /** Switch the shared capability center to another registered panel (e.g. Skill). */
  openCapability: (key: string) => void;
  hasCapability: (key: string) => boolean;
  /** Summon a published expert into a fresh bound native Session; never auto-sends. */
  summon: (expertId: string, revisionId: string | undefined, draftText: string | undefined) => Promise<void>;
  /** Open a new native task seeded with the `/workspace-expert-manager` guide draft. */
  createExpertTask: (kind?: 'agent' | 'team') => Promise<void>;
  editExpertTask: (expertId: string) => Promise<void>;
};
export type ExpertsPanelProps = PropsRuntime<'main'> & InjectFace<ExpertsPanelInjected>;

type View = 'center' | 'mine';
type OriginFilter = 'all' | 'default' | 'personal';
type StateFilter = 'all' | 'draft' | 'published' | 'disabled' | 'archived';
type Notice = { kind: 'info' | 'warn' | 'error'; text: string };

function messageOf(cause: unknown): string { return cause instanceof Error ? cause.message : '专家操作失败，请重试。'; }
function codeOf(cause: unknown): string { const code = (cause as unknown as { code?: unknown })?.code; return typeof code === 'string' ? code : ''; }
function icon(name: string) { return <Icon name={name as IconName} />; }

const ORIGIN_LABEL: Record<string, string> = { default: '默认模板', personal: '我的专家', organization: '组织' };
const AVAILABILITY_LABEL: Record<ExpertAvailability, string> = { enabled: '已启用', disabled: '已停用', archived: '已归档' };
const READINESS: Record<string, { label: string; cls: string }> = {
  ready: { label: '可用', cls: 'ready' },
  'missing-dependency': { label: '依赖缺失', cls: 'bad' },
  'unsupported-capability': { label: '能力未满足', cls: 'warn' },
  broken: { label: 'preset 异常', cls: 'bad' },
  unknown: { label: '未发布', cls: '' },
};

export function ExpertsPanel({ toggleNavigation, management, openCapability, hasCapability, summon, createExpertTask, editExpertTask }: ExpertsPanelProps) {
  const [view, setView] = useState<View>(() => expertDraftId(window.location.search) || new URLSearchParams(window.location.search).get('expert-library') === 'mine' ? 'mine' : 'center');
  const [kind, setKind] = useState<'agent' | 'team'>(() => new URLSearchParams(window.location.search).get('expert-kind') === 'team' ? 'team' : 'agent');
  const [typeCounts, setTypeCounts] = useState({ agent: 0, team: 0 });
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [originFilter, setOriginFilter] = useState<OriginFilter>('all');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [items, setItems] = useState<readonly ExpertSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [busy, setBusy] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<Notice | undefined>();
  const [mineCount, setMineCount] = useState(0);
  const [detailId, setDetailId] = useState<string>();
  const [editorId, setEditorId] = useState<string | undefined>(() => expertDraftId(window.location.search));
  const [importOpen, setImportOpen] = useState(false);
  const [rename, setRename] = useState<{ id: string; value: string; tags: string[] } | undefined>(undefined);
  const [removeTarget, setRemoveTarget] = useState<string | undefined>(undefined);
  const [actionMenu, setActionMenu] = useState<string>();
  const [acting, setActing] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const loadSequence = useRef(0);
  const kindLabel = kind === 'team' ? '专家团' : '专家';

  useEffect(() => {
    const url = new URL(window.location.href);
    if (view === 'mine') { url.searchParams.set('expert-library', 'mine'); url.searchParams.set('expert-kind', kind); }
    else { url.searchParams.delete('expert-library'); url.searchParams.set('expert-kind', kind); }
    window.history.replaceState(window.history.state, '', url);
  }, [view, kind]);

  useEffect(() => { const timer = window.setTimeout(() => setDebounced(query.trim()), 300); return () => window.clearTimeout(timer); }, [query]);

  const buildQuery = useCallback(() => {
    const search_ = debounced || undefined;
    if (view === 'center') {
      return { expertType: kind, ...(search_ ? { search: search_ } : {}), ...(originFilter === 'all' ? {} : { origin: originFilter as 'default' | 'personal' }), availability: 'enabled' as const, limit: 100 };
    }
    const availability = stateFilter === 'disabled' || stateFilter === 'archived' || stateFilter === 'published'
      ? (stateFilter === 'published' ? 'enabled' : stateFilter) as ExpertAvailability : undefined;
    return { expertType: kind, ...(search_ ? { search: search_ } : {}), origin: 'personal' as const, ...(availability ? { availability } : {}), limit: 100 };
  }, [view, kind, debounced, originFilter, stateFilter]);

  const load = useCallback(async (cursor?: string) => {
    const sequence = ++loadSequence.current;
    const appending = cursor !== undefined;
    if (appending) setLoadingMore(true); else { setBusy(true); setNotice(undefined); }
    setError('');
    try {
      const base = buildQuery();
      const result = await management.list(cursor ? { ...base, cursor } : base);
      if (sequence !== loadSequence.current) return;
      setItems(prev => (appending ? [...prev, ...result.items] : result.items));
      setTotal(result.total);
      setNextCursor(result.nextCursor);
    } catch (cause) {
      if (sequence !== loadSequence.current) return;
      if (codeOf(cause) === 'experts/cursor-stale') {
        setNotice({ kind: 'warn', text: '目录已变化，分页游标失效，已为你重新加载第一页。' });
        setItems([]); setNextCursor(undefined);
        try { const fresh = await management.list(buildQuery()); setItems(fresh.items); setTotal(fresh.total); setNextCursor(fresh.nextCursor); } catch { /* surfaced below */ }
      } else setError(messageOf(cause));
    } finally { if (sequence === loadSequence.current) { setBusy(false); setLoadingMore(false); } }
  }, [buildQuery, management]);

  const loadMineCount = useCallback(async () => {
    try { const [agent, team] = await Promise.all([management.list({ origin: 'personal', expertType: 'agent', limit: 1 }), management.list({ origin: 'personal', expertType: 'team', limit: 1 })]); setTypeCounts({ agent: agent.total, team: team.total }); setMineCount(agent.total + team.total); } catch { /* non-fatal badge */ }
  }, [management]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadMineCount(); }, [loadMineCount, items]);
  useEffect(() => {
    const revalidate = () => { if (document.visibilityState === 'visible') { void load(); void loadMineCount(); } };
    window.addEventListener('focus', revalidate); document.addEventListener('visibilitychange', revalidate);
    return () => { window.removeEventListener('focus', revalidate); document.removeEventListener('visibilitychange', revalidate); };
  }, [load, loadMineCount]);
  useEffect(() => {
    if (!actionMenu) return;
    const outside = (event: PointerEvent) => { if (!(event.target instanceof Element) || !event.target.closest('.card-actions')) setActionMenu(undefined); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [actionMenu]);

  const baseVisible = useMemo(() => {
    if (view === 'center') return items.filter(item => item.publishedRevisionRef !== undefined);
    if (stateFilter === 'draft') return items.filter(item => item.publishedRevisionRef === undefined);
    if (stateFilter === 'published') return items.filter(item => item.publishedRevisionRef !== undefined);
    return items;
  }, [items, view, stateFilter]);
  const allTags = useMemo(() => [...new Set(items.flatMap(item => item.userTags ?? []))].sort((a, b) => a.localeCompare(b)), [items]);
  const visibleTags = useMemo(() => [...new Set(baseVisible.flatMap(item => item.userTags ?? []))].sort((a, b) => a.localeCompare(b)), [baseVisible]);
  useEffect(() => { if (tagFilter !== 'all' && !visibleTags.includes(tagFilter)) setTagFilter('all'); }, [tagFilter, visibleTags]);
  useEffect(() => { setTagFilter('all'); }, [view, kind, debounced, stateFilter, originFilter]);
  const visible = tagFilter === 'all' ? baseVisible : baseVisible.filter(item => item.userTags?.includes(tagFilter));

  const refresh = useCallback(() => { void load(); void loadMineCount(); }, [load, loadMineCount]);
  const closeEditor = () => {
    setEditorId(undefined);
    const url = new URL(window.location.href);
    url.searchParams.delete('expert-draft');
    window.history.replaceState(window.history.state, '', url);
  };

  const runSummon = async (expertId: string, revisionId: string | undefined, draftText: string | undefined) => {
    setActing(true); setError('');
    try { await summon(expertId, revisionId, draftText); setDetailId(undefined); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setActing(false); }
  };
  const createExpert = async (type: 'agent' | 'team' = kind) => {
    setActing(true); setError('');
    try { await createExpertTask(type); } catch (cause) { setError(messageOf(cause)); } finally { setActing(false); }
  };
  const setAvailability = async (summary: ExpertSummary, availability: ExpertAvailability) => {
    setActionMenu(undefined); setActing(true); setError('');
    try { await management.setAvailability(summary.id, availability, management.newOperationId('availability')); refresh(); if (detailId === summary.id) setDetailId(undefined); }
    catch (cause) { setError(messageOf(cause)); } finally { setActing(false); }
  };
  const exportExpert = async (summary: ExpertSummary) => {
    setActionMenu(undefined); setActing(true); setError('');
    try { const result = await management.downloadExport(summary.id, summary.publishedRevisionRef?.revisionId); setNotice({ kind: 'info', text: `已导出「${result.fileName}」（${result.bytes} 字节，摘要 ${result.digest.slice(0, 12)}…）。` }); }
    catch (cause) { setError(messageOf(cause)); } finally { setActing(false); }
  };
  // 专家的定义存在存储域里、没有现成目录：这里把导出包物化成一个按专家分目录的文件夹再打开。
  const openDirectory = async (summary: ExpertSummary) => {
    setActionMenu(undefined); setActing(true); setError('');
    try {
      const { directory } = await management.directory(summary.id, summary.publishedRevisionRef?.revisionId);
      await management.openDirectory(directory);
    } catch (cause) { setError(messageOf(cause)); } finally { setActing(false); }
  };

  const capabilityTabs = [['experts', '专家'], ['skills', '技能'], ['connectors', '连接器']] as const;
  const capabilityKey: Record<string, string> = { experts: 'workspace-experts', skills: 'workspace-skills', connectors: 'workspace-connectors' };
  const isDraft = (summary: ExpertSummary) => summary.publishedRevisionRef === undefined;
  const stateLabel = (summary: ExpertSummary) => isDraft(summary) ? '草稿' : AVAILABILITY_LABEL[summary.availability];
  /**
   * 卡片副标题的英文标识：专家 id 去掉内部的修订摘要后缀（`<slug>-<12 位十六进制>`）。
   * 应用内创作的专家没有单独的英文名字段，id 里的 slug 就是它的英文名。
   */
  const englishName = (summary: ExpertSummary) => summary.id.replace(/-[0-9a-f]{12}$/i, '');

  const editInConversation = async (id: string) => {
    setActing(true); setActionMenu(undefined);
    try { await editExpertTask(id); setDetailId(undefined); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setActing(false); }
  };

  return <section className="wd-experts" data-testid="workspace-experts">
    <style>{expertsCss}</style>
    <header className="cap-header">
      <button className="nav-toggle" onClick={toggleNavigation} aria-label="切换导航">导航</button>
      {capabilityTabs.map(([key, label]) => {
        const active = key === 'experts';
        const target = capabilityKey[key];
        const enabled = active || (target !== undefined && hasCapability(target));
        return <button key={key} className={`cap-tab ${active ? 'active' : ''}`} disabled={!enabled}
          aria-current={active ? 'page' : undefined}
          onClick={() => { if (!active && target) openCapability(target); }}>{label}</button>;
      })}
      <Input ref={search} className="search" aria-label="搜索专家" placeholder={view === 'mine' ? `搜索我创建的${kind === 'team' ? '专家团' : '专家'}` : `搜索${kindLabel}`} value={query}
        onChange={event => setQuery(event.currentTarget.value)} />
      <details className="create-menu"><summary className="create-expert">制作专家</summary><div role="menu">
        <button role="menuitem" disabled={acting} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); void createExpert('agent'); }}>创建专家</button>
        <button role="menuitem" disabled={acting} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); void createExpert('team'); }}>创建专家团</button>
        <button role="menuitem" disabled={acting} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); setImportOpen(true); }}>上传专家包</button>
      </div></details>
    </header>

    
    <div className="section-head">
      <nav className="work-types" aria-label={view === 'mine' ? '我的作品类型' : '专家中心类型'}>{([['agent', '专家'], ['team', '专家团']] as const).map(([type, label]) => <button key={type} className={kind === type ? 'active' : ''} aria-pressed={kind === type} onClick={() => { setKind(type); setQuery(''); }}>{label}{view === 'mine' && <span>{typeCounts[type]}</span>}</button>)}</nav>
      <div className="section-actions">
        <Button onClick={() => setImportOpen(true)}>导入</Button>
        <Button onClick={refresh} disabled={busy}>刷新</Button>
      </div>
    </div>

    <nav className="tag-filter-bar" aria-label="按标签筛选">
      <button className={tagFilter === 'all' ? 'active' : ''} onClick={() => setTagFilter('all')}>全部</button>
      {visibleTags.map(tag => <button key={tag} className={tagFilter === tag ? 'active' : ''} onClick={() => setTagFilter(tag)}>{tag}</button>)}
    </nav>

    {view === 'mine' && <nav className="filter-tabs" aria-label="状态过滤">
        {([['all', '全部'], ['draft', '草稿'], ['published', '已发布'], ['disabled', '已停用'], ['archived', '已归档']] as const).map(([key, label]) =>
          <Button key={key} className={stateFilter === key ? 'active' : ''} aria-current={stateFilter === key ? 'page' : undefined}
            onClick={() => setStateFilter(key)}>{label}</Button>)}
      </nav>}

    {notice && <div className={`notice ${notice.kind}`} role="status"><div className="notice-body"><span>{notice.text}</span></div><Button onClick={() => setNotice(undefined)} aria-label="关闭提示">×</Button></div>}
    <div role="status" aria-live="polite" className={error ? 'error counts' : 'counts'}>
      {busy ? '正在读取专家目录…' : error || `目录共 ${total} 个${kindLabel} · 当前显示 ${visible.length} 个${debounced ? `（搜索“${debounced}”）` : ''}`}
    </div>

    {busy
      ? <div className="grid" aria-hidden>{Array.from({ length: 8 }, (_, index) => <div className="skeleton" key={index} />)}</div>
      : !error && !visible.length
        ? <div className="empty">
          <strong>{debounced ? `没有匹配的${kindLabel}` : view === 'mine' ? `还没有自己的${kind === 'team' ? '专家团' : '专家'}` : `暂无可用${kindLabel}`}</strong>
          <span className="muted">{debounced ? '保留搜索词，可清除后重试。' : view === 'mine' ? '从默认模板复制，或直接制作一个属于你的专家。' : '默认模板尚未就绪，请稍后重试或制作专家。'}</span>
          <div className="empty-actions">
            {debounced && <Button onClick={() => { setQuery(''); search.current?.focus(); }}>清除搜索</Button>}
            <Button variant="primary" className="create-expert" disabled={acting} onClick={() => void createExpert()}>创建{kindLabel}</Button>
            {view === 'mine' && <Button onClick={() => setView('center')}>浏览专家中心</Button>}
          </div>
        </div>
        : <div className="grid">{visible.map(summary => {
          const readiness = READINESS[summary.readiness] ?? READINESS.unknown;
          const draft = isDraft(summary);
          const usable = summary.canUse && !draft && summary.availability === 'enabled' && summary.readiness === 'ready';
          return <article className={`card ${draft ? 'draft' : ''} ${summary.availability !== 'enabled' ? 'unavailable' : ''} ${actionMenu === summary.id ? 'menu-open' : ''}`} key={summary.id}>
            <div className="card-top">
              <button className="card-open" aria-label={`查看专家 ${summary.name}`} onClick={() => setDetailId(summary.id)}>
                
                <span className="card-title"><strong title={summary.name}>{summary.displayName ?? summary.name}</strong>
                  <small className="slug">{englishName(summary)}</small>
                  {view === 'mine' && <span className="card-meta">{stateLabel(summary)}</span>}</span>
              </button>
            </div>
            <p className="desc">{summary.description || <span className="muted">（暂无简介）</span>}</p>
            <div className="card-foot"><button className="summon" disabled={!usable || acting} onClick={() => void runSummon(summary.id, summary.publishedRevisionRef?.revisionId, undefined)}>召唤</button>
              {/* The kind is already the tab you are looking at, and "可用" is the absence of
                  news; only a real problem still earns a badge here. */}
              {!draft && readiness.cls !== 'ready' && <span className={`badge ${readiness.cls}`}>{readiness.label}</span>}
              {draft && <span className="badge">未发布</span>}
              {summary.origin === 'default' && <span className="badge">默认</span>}
              {summary.canManage && <div className="card-actions">
                <Button variant="ghost" size="sm" className="more-button" aria-label={`管理专家 ${summary.name}`} aria-haspopup="menu" aria-expanded={actionMenu === summary.id}
                  onClick={() => setActionMenu(current => (current === summary.id ? undefined : summary.id))}>•••</Button>
                {actionMenu === summary.id && <div className="card-menu" role="menu">
                  {draft
                    ? <button role="menuitem" onClick={() => { void editInConversation(summary.id); }}>继续编辑</button>
                    : <button role="menuitem" disabled={!usable || acting} onClick={() => void runSummon(summary.id, summary.publishedRevisionRef?.revisionId, undefined)}>召唤专家</button>}
                  {summary.canEdit && !draft && <button role="menuitem" onClick={() => { void editInConversation(summary.id); }}>编辑</button>}
                  <button role="menuitem" disabled={acting} onClick={() => void openDirectory(summary)}>打开文件夹</button>
                  <button role="menuitem" disabled={acting} onClick={() => void exportExpert(summary)}>导出</button>
                  <button role="menuitem" disabled={acting} onClick={() => { setActionMenu(undefined); setRename({ id: summary.id, value: summary.displayName ?? '', tags: [...(summary.userTags ?? [])] }); }}>设置显示名称</button>
                  {summary.canManage && summary.availability === 'disabled' && <button role="menuitem" disabled={acting} onClick={() => void setAvailability(summary, 'enabled')}>启用</button>}

                  {summary.canManage && <button className="danger" role="menuitem" disabled={acting} onClick={() => { setActionMenu(undefined); setRemoveTarget(summary.id); }}>卸载</button>}
                </div>}
              </div>}
            </div>
          </article>;
        })}{view === 'mine' && <button className="card create-card" disabled={acting} onClick={() => void createExpert()}><span aria-hidden>＋</span>创建{kind === 'team' ? '专家团' : '专家'}</button>}</div>}

    {nextCursor && !busy && <div className="empty-actions" style={{ justifyContent: 'center', marginTop: 18 }}>
      <Button disabled={loadingMore} onClick={() => void load(nextCursor)}>{loadingMore ? '正在加载…' : '加载更多'}</Button>
    </div>}

    <Modal open={Boolean(detailId)} label={detailId ? '专家详情' : '专家详情'} className="expert-dialog" onClose={() => setDetailId(undefined)}>
      {detailId && <ExpertDetailModal expertId={detailId} management={management} acting={acting}
        onClose={() => setDetailId(undefined)}
        onSummon={(expertId, revisionId, draftText) => void runSummon(expertId, revisionId, draftText)}
        onEditTask={id => void editInConversation(id)}
        onEditDraft={id => { setDetailId(undefined); setEditorId(id); }}
        onCopy={async (expertId, revisionId) => {
          setActing(true);
          try { const draft = await management.copy(expertId, revisionId, management.newOperationId('copy')); setDetailId(undefined); refresh(); setEditorId(draft.expertId); }
          catch (cause) { setError(messageOf(cause)); } finally { setActing(false); }
        }}
        onAvailability={async (expertId, availability) => {
          setActing(true);
          try { await management.setAvailability(expertId, availability, management.newOperationId('availability')); setDetailId(undefined); refresh(); }
          catch (cause) { setError(messageOf(cause)); } finally { setActing(false); }
        }}
        onExport={async expertId => {
          setActing(true);
          try { const result = await management.downloadExport(expertId, undefined); setNotice({ kind: 'info', text: `已导出「${result.fileName}」。` }); }
          catch (cause) { setError(messageOf(cause)); } finally { setActing(false); }
        }}
        onChanged={refresh} />}
    </Modal>

    {editorId && <ExpertDraftEditor expertId={editorId} management={management}
      onClose={closeEditor}
      onSaved={refresh}
      onPublished={() => { closeEditor(); refresh(); }}
      onSummon={(id, revisionId, text) => { closeEditor(); void runSummon(id, revisionId, text); }} />}

    <Modal open={rename !== undefined} label="设置显示名称" className="confirm-dialog" onClose={() => setRename(undefined)}>{rename && <div><h2>设置显示名称</h2><p className="muted">只影响你自己的卡片显示和标签筛选，不会改变专家本身的内容。</p><TagEditor tags={rename.tags} options={allTags} onChange={tags => setRename({ ...rename, tags })} max={EXPERT_LIMITS.tagsMax} /><input className="rename-input" autoFocus value={rename.value} placeholder="留空则恢复原名称" onChange={event => setRename({ ...rename, value: event.currentTarget.value })} /><div className="confirm-actions"><Button onClick={() => setRename(undefined)}>取消</Button><Button variant="primary" onClick={() => { const target = rename; void (async () => { try { await management.setDisplayName(target.id, target.value); await management.setTags(target.id, target.tags); setRename(undefined); await refresh(); } catch (cause) { setError(messageOf(cause)); } })(); }}>保存</Button></div></div>}</Modal>
    <Modal open={removeTarget !== undefined} label="确认卸载专家" className="confirm-dialog" onClose={() => setRemoveTarget(undefined)}>{removeTarget && <div><h2>卸载这位专家？</h2><p className="muted">将删除它的草稿、全部已发布修订、随包安装的技能，以及所有人的显示偏好。此操作不可恢复。</p><p className="muted">如果已有会话使用该专家/专家团，必须先删除相关会话。</p><div className="confirm-actions"><Button onClick={() => setRemoveTarget(undefined)}>取消</Button><Button tone="danger" className="danger solid" onClick={() => { const target = removeTarget; void (async () => { try { await management.deleteExpert(target); setRemoveTarget(undefined); await refresh(); } catch (cause) { setError(messageOf(cause)); } })(); }}>确认卸载</Button></div></div>}</Modal>
    <Modal open={importOpen} label="导入专家" className="import-dialog" onClose={() => setImportOpen(false)}>
      {importOpen && <ImportExpertModal management={management} existingTags={allTags} onClose={() => setImportOpen(false)}
        onImported={id => { setImportOpen(false); refresh(); setEditorId(id); }} />}
    </Modal>
  </section>;
}
