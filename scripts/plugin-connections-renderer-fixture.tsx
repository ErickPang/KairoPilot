import React from 'react';
import { createRoot } from 'react-dom/client';
import { PluginConnectionsPanel } from '../src/renderer/components/PluginConnectionsPanel';
import { I18nProvider } from '../src/renderer/components/layout/I18nProvider';
import { KAIRO_INVOKE as C } from '../src/shared/ipc';
import type { PluginConnectionState, PluginRegistryEntry } from '../src/shared/contracts';
import '../src/renderer/index.css';
import '../src/renderer/App.css';
import '../src/renderer/components/Workbench.css';

const plugin: PluginRegistryEntry = {
  packageVersion: 1, id: 'fixture', name: 'Fixture', description: '', version: '1', author: 'Fixture',
  installedAt: 1, scope: 'public', filePath: '/synthetic/package.json', codeHash: 'reviewed-package', riskLevel: 'high', tools: [], capabilities: [],
  connections: [
    { id: 'remote', name: 'Remote fixture', transport: 'http', url: 'https://mcp.example.invalid/mcp' },
    { id: 'restricted', name: 'Restricted fixture', transport: 'stdio', executionMode: 'restricted-local', command: '/synthetic/node', args: [] }
  ]
};
let states: PluginConnectionState[] = [
  { id: 'remote', name: 'Remote fixture', transport: 'http', executionMode: 'remote', status: 'disconnected', tools: [] },
  { id: 'restricted', name: 'Restricted fixture', transport: 'stdio', executionMode: 'restricted-local', status: 'unavailable', tools: [] }
];
window.kairo = { invoke: async (channel: string, payload: Record<string, unknown>) => {
  const data = document.documentElement.dataset;
  if (channel === C.chatGetActiveSummary) return { id: 'task-fixture', title: 'Synthetic task' };
  if (channel === C.pluginsConnectionList) return structuredClone(states);
  data.lastChannel = channel; data.lastPayload = JSON.stringify(payload);
  if (channel === C.pluginsConnectionConnect) {
    data.connectCalls = String(Number(data.connectCalls || 0) + 1);
    states = [{ ...states[0], status: 'catalog_changed', catalogHash: 'reviewed-catalog', tools: [{ name: 'echo', description: 'Synthetic echo', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } }] }, states[1]];
  } else if (channel === C.pluginsConnectionApprove) {
    data.approveCalls = String(Number(data.approveCalls || 0) + 1); states[0] = { ...states[0], status: 'connected' };
  } else if (channel === C.pluginsConnectionDisconnect) states[0] = { ...states[0], status: 'disconnected', tools: [] };
  else throw new Error(`Unexpected fixture IPC: ${channel}`);
  return { success: true };
} } as unknown as KairoBridge;

createRoot(document.getElementById('root')!).render(<I18nProvider><PluginConnectionsPanel plugin={plugin} confirm={async options => {
  const data = document.documentElement.dataset;
  data.confirmMessage = options.message;
  data.confirmCount = String(Number(data.confirmCount || 0) + 1);
  return data.confirmOutcome === 'allow';
}}/></I18nProvider>);
