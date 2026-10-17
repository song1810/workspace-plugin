import * as React from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type { ExpertManagementClient } from './management.js';
import { isNativePreset, nativePresetRows, requireNativePreset } from './preset-policy.js';

/** Keep the native mount loader stable while always invoking the latest injected callback. */
function StableNativePresetSeat(props: any) {
  const { Native, ...seatProps } = props;
  const loadRef = React.useRef(props.load);
  loadRef.current = props.load;
  const load = React.useCallback(() => loadRef.current(), []);
  return <Native {...seatProps} load={load}/>;
}

/**
 * Native controllers stay owned by Harness; expert execution uses the binding-aware summon path.
 *
 * Only the new-session control is wrapped: `conversation.hero.agentPreset` is a single-seat
 * slot, so a later registration takes the seat over. `settings.section` is an additive list
 * slot (every registration is its own page with no replacement semantics), so wrapping it
 * only produced a duplicate "Agent 预设" page next to the Harness-owned one. The settings
 * page stays the Harness owner's; expert presets remain guarded by the Host-side preset
 * checks, not by a second client page.
 */
export function installExpertPresetMenu(ctx: Context, _management: ExpertManagementClient): void {
  const install = (key: string) => {
    let dispose: (() => void) | undefined;
    const ready = () => {
      if (dispose) return;
      const original = ctx.slots.entriesOfSlot(key as any).find((entry: any) => !!entry.inject);
      if (!original?.inject) return;
      const Native = original.component as React.ComponentType<any>;
      const projected = new WeakMap<object, any>();
      const project = (state: any, field: 'options') => {
        let value = projected.get(state);
        if (!value) { value = { ...state, [field]: nativePresetRows(state[field]) }; projected.set(state, value); }
        return value;
      };
      /**
       * A summoned expert is already bound; this surface names it without
       * offering a preset swap. A blank Session is the one exception: the
       * Host accepts returning it to a native preset, so offer that as an
       * explicit dismiss action beside the name.
       */
      function SummonedExpertSeat(props: any) {
        const state = props.useAgentPresetSeat((snapshot: any) => snapshot);
        // A fresh slot callback must not turn a roster update into another roster request.
        const loadRef = React.useRef(props.load);
        loadRef.current = props.load;
        React.useEffect(() => { void loadRef.current(); }, [state.current]);
        const name = state.options.find((row: any) => row.id === state.current)?.name;
        const sessionId = typeof props.sessionId === 'string' ? props.sessionId : undefined;
        const sessions = (ctx as any).sessions as {
          list: {
            subscribe(listener: () => void): () => void;
            getSnapshot(): { byId: Record<string, { blank?: boolean } | undefined> };
          };
        };
        const subscribe = React.useCallback(
          (notify: () => void) => sessions.list.subscribe(notify),
          [sessions],
        );
        const blank = React.useSyncExternalStore(
          subscribe,
          () => sessionId !== undefined && sessions.list.getSnapshot().byId[sessionId]?.blank === true,
          () => false,
        );
        // The harness always declares `standard`; the first native preset is
        // only a fallback for a deployment that renamed its default.
        const standardId = state.options.find((row: any) => row.id === 'standard')?.id
          ?? state.options.find((row: any) => isNativePreset(row.id))?.id;
        const canCancel = blank && standardId !== undefined && standardId !== state.current;
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, font: 'inherit', color: 'inherit' }} title={name || '已召唤专家'}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="6" r="3"/><circle cx="5" cy="17" r="3"/><circle cx="19" cy="17" r="3"/><path d="M10 9 6.5 14M14 9l3.5 5M8 17h8"/></svg>
            <span>{name || '已召唤专家'}</span>
            {canCancel && (
              <button
                type="button"
                aria-label="取消召唤（切回标准模式）"
                title="取消召唤（切回标准模式）"
                onClick={() => { void props.select(standardId); }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 18,
                  height: 18,
                  minHeight: 18,
                  padding: 0,
                  marginLeft: 2,
                  border: 0,
                  borderRadius: 999,
                  background: 'var(--dsw-alias-interactive-bg-hover)',
                  color: 'var(--dsw-alias-label-secondary)',
                  font: 'inherit',
                  fontSize: 14,
                  lineHeight: 1,
                  cursor: 'pointer',
                }}
              >
                ×
              </button>
            )}
          </span>
        );
      }
      function PublicPresets(props: any) {
        const current = props.useAgentPresetSeat((state: any) => state.current);
        if (current && !isNativePreset(current)) return <SummonedExpertSeat {...props}/>;
        const useSeat = (selector: (state: any) => unknown) => props.useAgentPresetSeat((state: any) => selector(project(state, 'options')));
        return <StableNativePresetSeat Native={Native} {...props} useAgentPresetSeat={useSeat} select={async (id: string) => { requireNativePreset(id); return props.select(id); }} />;
      }
      dispose = ctx.slots.register({ name: key, priority: -10, locale: 'settings.agentPreset', inject: original.inject } as any, PublicPresets);
    };
    ctx.effect(() => { const stop = ctx.slots.subscribe(key as any, ready); ready(); return () => { stop(); dispose?.(); }; }, 'workspace.expert-preset-menu.seat');
  };
  install('conversation.hero.agentPreset');
}
