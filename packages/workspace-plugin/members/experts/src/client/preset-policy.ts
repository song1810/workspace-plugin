/** Compiled expert presets require an execution binding and are never native choices. */
export function isNativePreset(id: string): boolean { return !id.startsWith('wd-exp-'); }
export function nativePresetRows<T extends { id: string }>(rows: readonly T[]): readonly T[] {
  return rows.filter(row => isNativePreset(row.id));
}
export function requireNativePreset(id: string): void {
  if (!isNativePreset(id)) throw new Error('请从专家中心召唤专家；内部专家配置不能作为普通对话或默认配置。');
}
/** A blank Session can inherit a visible expert preset from the previous conversation. */
export function shouldClearInheritedExpert(input: {
  readonly blank: boolean;
  readonly sessionId?: string;
  readonly standardId?: string;
  readonly current?: string;
}): boolean {
  return input.blank
    && Boolean(input.sessionId)
    && Boolean(input.standardId)
    && typeof input.current === 'string'
    && !isNativePreset(input.current)
    && input.current !== input.standardId;
}
/** Binding failures that prove the inherited expert preset is no longer usable. */
export function isStaleExpertBinding(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'experts/not-found'
    || code === 'experts/disabled'
    || code === 'experts/archived'
    || code === 'experts/conflict'
    || code === 'experts/unsupported-capability';
}
