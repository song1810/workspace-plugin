import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-connection/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-slots';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import { ConnectorsPanel } from './client/ConnectorsPanel.js';
import { ConnectorPicker } from './client/ConnectorPicker.js';
import { createConnectorManagementClient } from './client/management.js';
import { en, zh, type ConnectorsKey } from './client/locales.js';

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Connector panel and picker copy. */
    'workspace.connectors': ConnectorsKey
  }
}

export const name = 'workspace-connectors-client';
export const inject = ['slots', 'layout', 'connection', 'locale'];

/** Translation seat for connector copy. */
export type ConnectorsTranslate = TranslateNS<'workspace.connectors'>

const NS = 'workspace.connectors'

export function apply(ctx: Context): void {
  const lifetime = new AbortController();
  ctx.effect(() => () => lifetime.abort(), 'workspace.connectors.client');
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'workspace-connectors: dictionaries');
  const t = ctx.locale.bind(NS);
  const management = createConnectorManagementClient(ctx, lifetime.signal);
  const openCapability = (key: string) => ctx.layout.selectPanel(key as Parameters<typeof ctx.layout.selectPanel>[0]);
  const hasCapability = (key: string) => ctx.slots.entriesOfSlot('main').some(entry => entry.options.key === key);
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: 'workspace-connectors',
    inject: () => ({ toggleNavigation: () => ctx.layout.toggleSidebar(), management, openCapability, hasCapability, t }),
  }, ConnectorsPanel));
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left', id: 'workspace-connectors-picker', order: 30,
    inject: () => ({ management, openManagement: () => openCapability('workspace-connectors'), t }),
  }, ConnectorPicker));
}
