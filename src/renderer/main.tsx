import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { I18nProvider } from './components/layout/I18nProvider'
import { KAIRO_INVOKE } from '../shared/ipc'

// Mock bridge for browser preview
if (!window.kairo) {
  const mockWebSearch = {
    timeoutMs: 10000,
    preferredProviders: ['searxng', 'tavily', 'bing', 'duckduckgo', 'baidu'],
    providers: {
      searxng: { enabled: false, baseUrl: '' },
      tavily: { enabled: false, baseUrl: 'https://api.tavily.com', apiKey: '' },
      bing: { enabled: true },
      duckduckgo: { enabled: true },
      baidu: { enabled: true }
    }
  }
  window.kairo = {
    invoke: (async (channel: string, ..._args: unknown[]) => {
      if (channel === KAIRO_INVOKE.configGetAll) return { models: { providers: {} }, agents: { activeAgentId: 'mainAgent', list: [] }, plugins: { registry: [] }, skills: { registry: [] }, webSearch: mockWebSearch };
      if (channel === KAIRO_INVOKE.configGetWebSearch) return mockWebSearch;
      if (channel === KAIRO_INVOKE.configSaveWebSearch) return { success: true };
      if (channel === KAIRO_INVOKE.agentChat) return { success: true, status: 'completed', content: 'Mock response' };
      if (channel === KAIRO_INVOKE.agentConfirmResponse) return { success: true, status: 'completed' };
      if (channel === KAIRO_INVOKE.agentResumeRun) return { success: true, status: 'completed' };
      if (channel === KAIRO_INVOKE.agentRetryStep) return { success: true, status: 'completed' };
      if (channel === KAIRO_INVOKE.configGetAgents) return [];
      if (channel === KAIRO_INVOKE.chatListSessions) return [];
      if (channel === KAIRO_INVOKE.chatGetActiveSession) return null;
      if (channel === KAIRO_INVOKE.chatGetLatestContextSummary) return null;
      if (channel === KAIRO_INVOKE.chatQueryRuns) return {
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 1,
        aggregations: {
          totalRuns: 0,
          runningRuns: 0,
          waitingApprovalRuns: 0,
          pausedRuns: 0,
          completedRuns: 0,
          failedRuns: 0,
          cancelledRuns: 0,
          statuses: []
        }
      };
      if (channel === KAIRO_INVOKE.chatGetRunTrace) return null;
      if (channel === KAIRO_INVOKE.chatGetSession) return null;
      if (channel === KAIRO_INVOKE.chatClearAllSessions) return { success: true };
      if (channel === KAIRO_INVOKE.ollamaCheck) return { running: true, message: 'Mock Ollama' };
      if (channel === KAIRO_INVOKE.ollamaStart) return { success: true };
      if (channel === KAIRO_INVOKE.ollamaPull) return { success: true };
      if (channel === KAIRO_INVOKE.skillsGetAll) return { public: [] };
      if (channel === KAIRO_INVOKE.skillsGetRegistry) return [];
      if (channel === KAIRO_INVOKE.skillsGetStore) return [
        { id: 'research-brief', name: 'Research Brief', description: 'Mock research workflow', version: '1.0.0', author: 'KairoPilot', icon: '🔎', tags: ['research'], marketplace: 'KairoPilot Curated', installedScopes: [], source: { type: 'inline', content: 'mock' } },
        { id: 'issue-triage', name: 'Issue Triage', description: 'Mock issue triage workflow', version: '1.0.0', author: 'KairoPilot', icon: '🛠️', tags: ['debug'], marketplace: 'KairoPilot Curated', installedScopes: [], source: { type: 'inline', content: 'mock' } }
      ];
      if (channel === KAIRO_INVOKE.skillsGetStoreByQuery) return [
        { id: 'research-brief', name: 'Research Brief', description: 'Mock research workflow', version: '1.0.0', author: 'KairoPilot', icon: '🔎', tags: ['research'], marketplace: 'KairoPilot Curated', installedScopes: [], source: { type: 'inline', content: 'mock' } },
        { id: 'issue-triage', name: 'Issue Triage', description: 'Mock issue triage workflow', version: '1.0.0', author: 'KairoPilot', icon: '🛠️', tags: ['debug'], marketplace: 'KairoPilot Curated', installedScopes: [], source: { type: 'inline', content: 'mock' } }
      ];
      if (channel === KAIRO_INVOKE.skillsInstall) return { success: true };
      if (channel === KAIRO_INVOKE.pluginsGetStore) return [
        { id: 'kairo-weather-plugin', name: 'Weather Forecaster', description: 'Mock Weather', version: '1.0', author: 'Kairo', icon: '🌤️' },
        { id: 'kairo-crypto-plugin', name: 'Crypto Tracker', description: 'Mock Crypto', version: '1.0', author: 'Kairo', icon: '₿' }
      ];
      if (channel === KAIRO_INVOKE.pluginsGetInstalled) return [];
      if (channel === KAIRO_INVOKE.pluginsInstall) return { success: true };
      if (channel === KAIRO_INVOKE.pluginsUninstall) return { success: true };
      if (channel === KAIRO_INVOKE.systemStats) return {
        platform: 'web',
        arch: 'mock',
        cpuModel: 'Mock CPU',
        memoryUsage: 50,
        totalMemory: '16.0 GB',
        uptime: 123
      };
      return null;
    }) as KairoBridge['invoke'],
    on: () => () => {}
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
)
