import { Button, Input, Select, Textarea } from 'workspace-ui';
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { Modal } from 'workspace-ui';
import type { ConnectorConfigView, ConnectorInput, ConnectorSummary } from '../shared.js';
import type { ConnectorManagementClient } from './management.js';
import type { ConnectorsTranslate } from '../client.js';
import { connectorCss } from './styles.js';

type Injected = { toggleNavigation: () => void; management: ConnectorManagementClient; openCapability: (key: string) => void; hasCapability: (key: string) => boolean; t: ConnectorsTranslate };
type Props = PropsRuntime<'main'> & InjectFace<Injected>;
type Draft = { id?: string; title: string; description: string; serverName: string; transport: 'stdio' | 'streamable-http'; command: string; argsText: string; url: string; authorizationToken: string; authorizationConfigured: boolean };
const blank = (): Draft => ({ title: '', description: '', serverName: '', transport: 'stdio', command: '', argsText: '', url: '', authorizationToken: '', authorizationConfigured: false });
const fromConfig = (row: ConnectorConfigView): Draft => ({ id: row.id, title: row.title, description: row.description, serverName: row.serverName, transport: row.transport, command: row.command ?? '', argsText: (row.args ?? []).join('\n'), url: row.url ?? '', authorizationToken: '', authorizationConfigured: row.authorizationConfigured });

export function ConnectorsPanel({ toggleNavigation, management, openCapability, hasCapability, t }: Props) {
  const stateLabel = (state: ConnectorSummary['state']): string => t(state === 'ready' ? 'stateReady' : state === 'discovering' ? 'stateDiscovering' : state === 'disabled' ? 'stateDisabled' : 'stateOffline');
  const [rows, setRows] = useState<readonly ConnectorSummary[]>([]); const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(true); const [error, setError] = useState(''); const [expanded, setExpanded] = useState<string>();
  const [draft, setDraft] = useState<Draft>(); const [removeTarget, setRemoveTarget] = useState<ConnectorSummary>();
  const refresh = useCallback(async () => { setBusy(true); setError(''); try { setRows(await management.list()); } catch (cause) { setError(cause instanceof Error ? cause.message : t('errorList')); } finally { setBusy(false); } }, [management, t]);
  useEffect(() => { void refresh(); }, [refresh]);
  const toggle = async (row: ConnectorSummary, enabled: boolean) => { setBusy(true); setError(''); try { await management.setEnabled(row.id, enabled); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : t('errorToggle')); setBusy(false); } };
  const edit = async (id: string) => { setError(''); try { setDraft(fromConfig(await management.config(id))); } catch (cause) { setError(cause instanceof Error ? cause.message : t('errorConfig')); } };
  const save = async () => {
    if (!draft) return; setBusy(true); setError('');
    const input: ConnectorInput = { title: draft.title, description: draft.description, serverName: draft.serverName, transport: draft.transport,
      ...(draft.transport === 'stdio' ? { command: draft.command, args: draft.argsText.split('\n').map(value => value.trim()).filter(Boolean) } : { url: draft.url, ...(draft.authorizationToken.trim() ? { authorizationToken: draft.authorizationToken } : {}) }) };
    try { if (draft.id) await management.update(draft.id, input); else await management.create(input); setDraft(undefined); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('errorSave')); setBusy(false); }
  };
  const remove = async () => { if (!removeTarget) return; setBusy(true); setError(''); try { await management.remove(removeTarget.id); setRemoveTarget(undefined); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : t('errorRemove')); setBusy(false); } };
  const normalized = query.trim().toLowerCase(); const filtered = rows.filter(row => `${row.title} ${row.description} ${row.serverName} ${row.toolNames.join(' ')}`.toLowerCase().includes(normalized));
  const detail = rows.find(row => row.id === expanded);
  const capabilityTabs = [['experts', t('tabExperts')], ['skills', t('tabSkills')], ['connectors', t('tabConnectors')]] as const;
  const capabilityKey: Record<string, string> = { experts: 'workspace-experts', skills: 'workspace-skills', connectors: 'workspace-connectors' };
  return <section className="wd-connectors" data-testid="workspace-connectors"><style>{connectorCss}</style>
    <header className="cap-header"><button className="nav-toggle" onClick={toggleNavigation} aria-label={t('navToggleAria')}>{t('navToggle')}</button>
      {capabilityTabs.map(([key, label]) => { const active = key === 'connectors'; const target = capabilityKey[key]; const enabled = active || Boolean(target && hasCapability(target)); return <button key={key} className={`cap-tab ${active ? 'active' : ''}`} disabled={!enabled} aria-current={active ? 'page' : undefined} onClick={() => { if (!active && target) openCapability(target); }}>{label}</button>; })}
      <Input className="search" aria-label={t('searchLabel')} placeholder={t('searchPlaceholder')} value={query} onChange={event => setQuery(event.currentTarget.value)} />
    </header>
    <div className="connector-head"><div><h1>{t('title')}</h1><p>{t('subtitle')}</p></div>
      <div className="head-actions"><Button className="secondary" onClick={() => void refresh()} disabled={busy}>{t('refresh')}</Button><Button variant="primary" className="primary" onClick={() => setDraft(blank())}>{t('add')}</Button></div></div>
    <div className="list-meta"><strong>{t('mine')} <span className="count">{rows.length}</span></strong><span className="muted">{t('connectedCount', { count: rows.filter(row => row.enabled && row.state === 'ready').length })}</span></div>
    {error ? <p className="error" role="alert">{error}</p> : null}
    {!busy && !filtered.length ? <div className="empty">{rows.length ? t('emptyFiltered') : t('emptyNone')}</div> : null}
    {filtered.length ? <div className="connector-grid">{filtered.map(row => <article key={row.id} className={`connector-card ${!row.enabled ? 'disabled' : ''}`}>
      <div className="card-top"><button className="card-open" aria-label={t('openCardAria', { title: row.title })} onClick={() => setExpanded(row.id)}><span className="connector-mark" aria-hidden>{row.title.charAt(0).toUpperCase()}</span><span className="card-title"><strong title={row.title}>{row.title}</strong><small>{row.transport} · {row.serverName}</small></span></button><button className="switch" role="switch" aria-label={t(row.enabled ? 'disableAria' : 'enableAria', { title: row.title })} aria-checked={row.enabled} disabled={busy} onClick={() => void toggle(row, !row.enabled)} /></div>
      <button className="card-body" onClick={() => setExpanded(row.id)}>{row.description || t('cardFallback')}</button><div className="card-foot"><span className="status-line"><i className={`status-dot ${row.state}`} />{stateLabel(row.state)}</span><span>{t('toolCount', { count: row.toolNames.length })}</span></div>
    </article>)}</div> : null}
    <Modal open={Boolean(detail)} label={t('detailLabel')} className="connector-detail-dialog" onClose={() => setExpanded(undefined)}>{detail ? <><div className="detail-hero"><span className="connector-mark" aria-hidden>{detail.title.charAt(0).toUpperCase()}</span><div className="detail-title"><h1>{detail.title}</h1><span className="status-line"><i className={`status-dot ${detail.state}`} />{stateLabel(detail.state)} · {detail.transport} · {detail.serverName}</span></div><div className="detail-actions"><Button variant="primary" className="primary" onClick={() => { setExpanded(undefined); void edit(detail.id); }}>{t('edit')}</Button><button className="switch" role="switch" aria-label={t(detail.enabled ? 'disableAria' : 'enableAria', { title: detail.title })} aria-checked={detail.enabled} disabled={busy} onClick={() => void toggle(detail, !detail.enabled)} /></div></div><p className="detail-summary">{detail.description}</p><div className="connector-detail"><div className="metric"><small>{t('detailState')}</small><strong>{stateLabel(detail.state)}</strong></div><div className="metric"><small>{t('detailTools')}</small><strong>{detail.toolNames.length}</strong></div><div className="metric"><small>{t('detailResources')}</small><strong>{detail.resourceCount}</strong></div><div className="metric"><small>{t('detailTemplates')}</small><strong>{detail.resourceTemplateCount}</strong></div><div className="tool-list">{t('detailCallable')}{detail.toolNames.length ? detail.toolNames.map(name => <React.Fragment key={name}><code>{name}</code>{' '}</React.Fragment>) : t('detailRemoved')}{detail.diagnostic ? <div className="error">{detail.diagnostic}</div> : null}</div></div><Button variant="ghost" size="sm" tone="danger" className="danger-link" onClick={() => { setExpanded(undefined); setRemoveTarget(detail); }}>{t('remove')}</Button></> : null}</Modal>
    <Modal open={Boolean(draft)} label={draft?.id ? t('formEdit') : t('formAdd')} className="connector-config-dialog" onClose={() => setDraft(undefined)}>
      <h1>{draft?.id ? t('formEdit') : t('formAdd')}</h1><p>{draft?.id ? t('formEditNote') : t('formAddNote')}</p>
      {draft ? <div className="connector-form"><label>{t('fieldTitle')}<Input value={draft.title} onChange={e => setDraft({ ...draft, title: e.currentTarget.value })} /></label><label>{t('fieldServerName')}<Input value={draft.serverName} placeholder={t('fieldServerNamePlaceholder')} onChange={e => setDraft({ ...draft, serverName: e.currentTarget.value })} /></label>
        <label className="wide">{t('fieldDescription')}<Input value={draft.description} onChange={e => setDraft({ ...draft, description: e.currentTarget.value })} /></label><label>{t('fieldTransport')}<Select value={draft.transport} onChange={e => setDraft({ ...draft, transport: e.currentTarget.value as Draft['transport'] })}><option value="stdio">{t('fieldTransportStdio')}</option><option value="streamable-http">Streamable HTTP</option></Select></label>
        {draft.transport === 'stdio' ? <><label className="wide">{t('fieldCommand')}<Input value={draft.command} placeholder={t('fieldCommandPlaceholder')} onChange={e => setDraft({ ...draft, command: e.currentTarget.value })} /></label><label className="wide">{t('fieldArgs')}<Textarea value={draft.argsText} onChange={e => setDraft({ ...draft, argsText: e.currentTarget.value })} /></label></> : <><label className="wide">{t('fieldUrl')}<Input value={draft.url} placeholder="https://example.com/mcp" onChange={e => setDraft({ ...draft, url: e.currentTarget.value })} /></label><label className="wide">{t('fieldToken')}<Input type="password" autoComplete="new-password" value={draft.authorizationToken} placeholder={draft.authorizationConfigured ? t('fieldTokenPlaceholderConfigured') : t('fieldTokenPlaceholder')} onChange={e => setDraft({ ...draft, authorizationToken: e.currentTarget.value })} /></label></>}
        <div className="form-note wide">{t('formNote')}</div><div className="form-actions wide"><Button className="secondary" onClick={() => setDraft(undefined)}>{t('cancel')}</Button><Button variant="primary" className="primary" disabled={busy || !draft.title.trim() || !draft.serverName.trim()} onClick={() => void save()}>{t('save')}</Button></div></div> : null}
    </Modal>
    <Modal open={Boolean(removeTarget)} label={t('removeLabel')} className="connector-config-dialog small" onClose={() => setRemoveTarget(undefined)}><h1>{t('removeTitle', { title: removeTarget?.title ?? '' })}</h1><p>{t('removeBody')}</p><div className="form-actions"><Button className="secondary" onClick={() => setRemoveTarget(undefined)}>{t('cancel')}</Button><Button tone="danger" className="danger-button" onClick={() => void remove()}>{t('remove')}</Button></div></Modal>
  </section>;
}
