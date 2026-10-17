/**
 * 在 harness 的「代理预设」chip 旁补一个明确的「×」：取消召唤，切回默认预设。
 *
 * 专家的本质是**会话级预设**（不是消息里的文本），所以无法"删掉"，只能换回标准预设；
 * 而 harness 只允许在**空白会话**（还没发过消息）里换预设。这个入口不改变那条规则，
 * 只是把"点专家名 → 选标准模式"变成一个直观的删除键。
 *
 * 实现：用一个更低 priority 的条目遮蔽 `conversation.hero.agentPreset` 单占位插槽，
 * 渲染 harness 自己的 chip，并在旁边加按钮。
 */

import * as React from 'react'
import { useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the conversation SlotMap merge into this program.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** 专家预设 id 前缀（presetIdFor() 产出 `wd-exp-<slug>-<digest>`）。 */
const EXPERT_PRESET_PREFIX = 'wd-exp-'

/** harness chip 的注入面里我们用到的那部分。 */
interface SeatState {
  readonly current?: string
  readonly options?: readonly { readonly id: string; readonly name?: string }[]
}
interface SeatProps {
  readonly sessionId?: string
  readonly useAgentPresetSeat?: (selector: (state: SeatState) => unknown) => unknown
  readonly useDeveloperTools?: (selector: (enabled: boolean) => unknown) => unknown
  readonly select?: (id: string) => Promise<string | undefined>
}
interface PresetRoster {
  readonly presets?: readonly { readonly id: string; readonly isDefault?: boolean }[]
}

/** 默认预设：roster 标记的默认项，退而求其次取第一个非专家预设。 */
function defaultPresetId(roster: PresetRoster | undefined): string | undefined {
  const presets = roster?.presets ?? []
  return presets.find(preset => preset.isDefault)?.id
    ?? presets.find(preset => !preset.id.startsWith(EXPERT_PRESET_PREFIX))?.id
}

/**
 * 安装"取消召唤"按钮。
 * @param ctx - 浏览器插件上下文。
 */
export function installExpertPresetCancel(ctx: Context): void {
  const key = 'conversation.hero.agentPreset'
  const bridge = {
    /** harness 只允许在空白会话里换预设；这里读的就是同一条规则。 */
    sessionBlank(sessionId: string): boolean {
      const sessions = (ctx as unknown as {
        sessions?: { list: { getSnapshot(): { byId: Record<string, { blank?: boolean }> } } }
      }).sessions
      return sessions?.list.getSnapshot().byId[sessionId]?.blank === true
    },
    async defaultPreset(): Promise<string | undefined> {
      const remote = (ctx as unknown as { remote?: { agentPresets?: { list(): Promise<unknown> } } }).remote
      try {
        const answered = await remote?.agentPresets?.list()
        if (answered === null || typeof answered !== 'object' || !('ok' in answered)) return undefined
        return (answered as { ok: boolean }).ok ? defaultPresetId((answered as { value?: PresetRoster }).value) : undefined
      } catch { return undefined }
    },
  }

  let dispose: (() => void) | undefined
  const install = (): void => {
    if (dispose !== undefined) return
    // 首次成功安装时条目表里只有 harness 自己的 chip（我们的条目还没注册）。
    const entry = ctx.slots.entriesOfSlot(key)[0]
    if (entry === undefined) return
    const Native = entry.component as React.ComponentType<Record<string, unknown>>
    const options = entry.options as { readonly locale?: string; readonly inject?: unknown }

    function ChipWithCancel(props: Record<string, unknown>): React.ReactElement {
      const seat = (props.useAgentPresetSeat as ((selector: (state: SeatState) => unknown) => unknown) | undefined)
        ?.(state => state) as SeatState | undefined
      const developerTools = ((props.useDeveloperTools as ((selector: (enabled: boolean) => unknown) => unknown) | undefined)
        ?.(enabled => enabled)) === true
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : undefined
      const [standard, setStandard] = useState<string>()

      // 默认预设只在 chip 可用时读一次（开发者工具关闭时 chip 本身不显示）。
      useEffect(() => {
        if (!developerTools) return
        let active = true
        void bridge.defaultPreset().then((id) => { if (active) setStandard(id) })
        return () => { active = false }
      }, [developerTools])

      const native = React.createElement(Native, props)
      const current = seat?.current ?? ''
      const select = props.select as ((id: string) => Promise<string | undefined>) | undefined
      // 只在"当前是专家预设 + 空白会话 + 有可回的默认预设"时给出 ×，避免点了必然被拒。
      const canCancel = developerTools
        && current.startsWith(EXPERT_PRESET_PREFIX)
        && standard !== undefined
        && standard !== current
        && sessionId !== undefined
        && bridge.sessionBlank(sessionId)
      if (!canCancel) return <>{native}</>
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          {native}
          <button
            type="button"
            aria-label="取消召唤（切回标准模式）"
            title="取消召唤（切回标准模式）"
            onClick={() => { void select?.(standard) }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 20,
              height: 20,
              minHeight: 20,
              padding: 0,
              margin: 0,
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
        </span>
      )
    }

    dispose = ctx.slots.register({
      name: key,
      // 单占位插槽按 priority 升序取最低者，-10 遮蔽 harness 自己的条目（默认 0）。
      priority: -10,
      ...(options.locale === undefined ? {} : { locale: options.locale }),
      ...(options.inject === undefined ? {} : { inject: options.inject }),
    } as never, ChipWithCancel as never)
  }

  // harness 的插件可能晚于我们挂载：订阅该插槽，出现后再包一层。
  ctx.effect(() => {
    const stop = ctx.slots.subscribe(key, install)
    install()
    return () => {
      stop()
      dispose?.()
      dispose = undefined
    }
  }, 'workspace.expert-preset-cancel')
}
