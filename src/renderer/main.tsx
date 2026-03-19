import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { I18nProvider } from './components/layout/I18nProvider'

// Mock ipcRenderer for browser preview
if (!window.ipcRenderer) {
  window.ipcRenderer = {
    invoke: (async (channel: string, ...args: any[]) => {
      console.log(`[Mock] invoke ${channel}`, args);
      if (channel === 'config:get') return {};
      if (channel === 'chat:getActiveSession') return null;
      if (channel === 'chat:clearAllSessions') return { success: true };
      if (channel === 'system:selectDirectory') return '/mock/directory/path';
      if (channel === 'ollama:check') return { running: true, message: 'Mock Ollama' };
      if (channel === 'ollama:start') return { success: true };
      if (channel === 'ollama:pull') return { success: true };
      if (channel === 'plugins:getStore') return [
        { id: 'kairo-weather-plugin', name: 'Weather Forecaster', description: 'Mock Weather', version: '1.0', author: 'Kairo', icon: '🌤️' },
        { id: 'kairo-crypto-plugin', name: 'Crypto Tracker', description: 'Mock Crypto', version: '1.0', author: 'Kairo', icon: '₿' }
      ];
      if (channel === 'plugins:getInstalled') return [];
      if (channel === 'plugins:install') return { success: true };
      if (channel === 'plugins:uninstall') return { success: true };
      if (channel === 'system:stats') return {
        platform: 'web',
        arch: 'mock',
        cpuModel: 'Mock CPU',
        memoryUsage: 50,
        totalMemory: '16.0 GB',
        uptime: 123
      };
      return null;
    }) as any,
    on: (channel, _listener) => {
      console.log(`[Mock] on ${channel}`);
      return () => {};
    },
    send: (channel, ...args) => {
      console.log(`[Mock] send ${channel}`, args);
    },
    off: (channel, _listener) => {
      console.log(`[Mock] off ${channel}`);
    },
    removeListener: (channel, _listener) => {
      console.log(`[Mock] removeListener ${channel}`);
    },
    removeAllListeners: (channel) => {
      console.log(`[Mock] removeAllListeners ${channel}`);
    }
  };
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
)

// Use contextBridge
window.ipcRenderer.on('main-process-message', (_event, message) => {
  console.log(message)
})
