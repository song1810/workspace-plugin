import * as React from 'react';
import { useEffect } from 'react';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';

export type SkillTaskKind = 'create' | 'edit' | 'open' | 'disable' | 'enable' | 'uninstall';
export const pendingDraftKey = 'workspace.pending-skill-task-draft';
export const skillTaskDrafts = {
  create: '/workspace-skill-creator 请帮我创建一个可以实现「……」的 skill',
} as const;

export function skillManagementDraft(kind: Exclude<SkillTaskKind, 'create'>, name: string): string {
  const actions = {
    edit: `请帮我优化【${name}】这个 skill，增加/优化[请补充你希望新增/优化的内容]`,
    open: `请定位共享技能「${name}」的官方技能目录并使用可用的原生打开能力打开它；如果当前环境不能打开，请返回经过校验的目录路径。`,
    disable: `请停用共享技能「${name}」，不要修改它的 SKILL.md。先说明影响范围并确认，再使用 Workspace 技能管理能力完成并验证新任务不再加载它。`,
    enable: `请重新启用共享技能「${name}」，不要修改它的 SKILL.md，并验证 Harness 官方技能目录能重新发现它。`,
    uninstall: `请卸载共享技能「${name}」。先读取资源和依赖影响并让我确认；使用可恢复移除，不要直接永久删除，然后验证 Harness 官方目录不再加载它。`,
  } as const;
  return `/workspace-skill-creator ${actions[kind]}`;
}

export function PendingSkillDraft({ inputActions }: PropsRuntime<'conversation.input.overlay'>) {
  useEffect(() => {
    const draft = window.sessionStorage.getItem(pendingDraftKey);
    if (!draft) return;
    const timer = window.setTimeout(() => {
      inputActions.setDraft(draft);
      window.sessionStorage.removeItem(pendingDraftKey);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [inputActions]);
  return null;
}
