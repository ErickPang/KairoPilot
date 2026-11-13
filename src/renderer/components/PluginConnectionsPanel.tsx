import { useCallback, useEffect, useState } from 'react';
import type { PluginConnectionState, PluginRegistryEntry, SessionSummary } from '../../shared/contracts';
import type { AppConfirmationOptions } from '../types';
import { KAIRO_INVOKE as C } from '../../shared/ipc';
import { useTranslation } from '../hooks/useTranslation';

export function PluginConnectionsPanel({ plugin, confirm }: { plugin: PluginRegistryEntry; confirm: (value: AppConfirmationOptions) => Promise<boolean> }) {
  const { t } = useTranslation();
  const [task, setTask] = useState<SessionSummary | null>(null);
  const [states, setStates] = useState<PluginConnectionState[]>([]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [token, setToken] = useState('');
  const refresh = useCallback(async () => {
    const active = await window.kairo.invoke(C.chatGetActiveSummary); setTask(active);
    if (active) setStates(await window.kairo.invoke(C.pluginsConnectionList, { id: plugin.id, scope: plugin.scope, sessionId: active.id }) as PluginConnectionState[]);
  }, [plugin.id, plugin.scope]);
  useEffect(() => { void refresh().catch(() => setError(t('plugins.connectionFailed'))); }, [refresh, t]);
  const action = async (state: PluginConnectionState, kind: 'connect' | 'approve' | 'disconnect') => {
    if (!task || busy) return;
    const definition = plugin.connections?.find(item => item.id === state.id); if (!definition) return;
    setBusy(true); setError('');
    try {
      if (kind !== 'disconnect') {
        const detail = kind === 'approve' ? `${t('plugins.reviewTools')}\n${state.tools.map(tool => tool.name).join(', ')}` : `${definition.transport === 'http' ? definition.url : `${definition.command} ${definition.args.join(' ')}`}\n${t(definition.transport === 'http' ? 'plugins.remoteBoundary' : 'plugins.localBoundary')}\n${task.title}`;
        if (!await confirm({ title: t(kind === 'approve' ? 'plugins.reviewTools' : 'plugins.connect'), message: detail, confirmLabel: t('common.confirm'), variant: 'danger' })) return;
      }
      const channel = kind === 'connect' ? C.pluginsConnectionConnect : kind === 'approve' ? C.pluginsConnectionApprove : C.pluginsConnectionDisconnect;
      const result = await window.kairo.invoke(channel, { id: plugin.id, scope: plugin.scope, sessionId: task.id, connectionId: state.id, ...(kind === 'connect' ? { expectedHash: plugin.codeHash, ...(token && definition.transport === 'http' ? { token } : {}) } : {}), ...(kind === 'approve' ? { catalogHash: state.catalogHash } : {}) }) as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error || t('plugins.connectionFailed'));
      setToken(''); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <div className="plugin-detail-block">
    <div className="plugin-detail-label">{t('plugins.connections')}</div>
    <p>{t('plugins.connectionTask', { title: task?.title || t('plugins.noConnectionTask') })}</p>
    {error && <p role="alert">{error}</p>}
    {plugin.connections?.some(item => item.transport === 'http') && <label>{t('plugins.sessionToken')}<input className="form-control" type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} disabled={busy}/></label>}
    {states.map(state => <div key={state.id} className="plugin-detail-block" data-connection-id={state.id}>
      <strong>{state.name}</strong><p>{t(`plugins.mode.${state.executionMode}`)} · {t(`plugins.status.${state.status}`)}</p>
      <p>{t(state.transport === 'http' ? 'plugins.remoteBoundary' : state.executionMode === 'restricted-local' ? 'plugins.restrictedUnavailable' : 'plugins.localBoundary')}</p>
      {state.tools.map(tool => <details key={tool.name}><summary>{tool.name} — {tool.description}</summary><pre>{JSON.stringify(tool.inputSchema, null, 2)}</pre></details>)}
      <div className="store-card-actions">
        <button type="button" className="btn btn-secondary" disabled={busy || !task || state.status === 'unavailable'} onClick={() => void action(state, 'connect')}>{t('plugins.connect')}</button>
        {state.status === 'catalog_changed' && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void action(state, 'approve')}>{t('plugins.reviewTools')}</button>}
        {state.status !== 'disconnected' && state.status !== 'unavailable' && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void action(state, 'disconnect')}>{t('plugins.disconnect')}</button>}
      </div>
    </div>)}
  </div>;
}
