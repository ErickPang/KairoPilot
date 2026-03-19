import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Mock ipcRenderer for browser preview
if (!window.ipcRenderer) {
  window.ipcRenderer = {
    invoke: async (channel, ...args) => {
      console.log(`[Mock] invoke ${channel}`, args);
      if (channel === 'config:get') return {};
      if (channel === 'chat:getActiveSession') return null;
      if (channel === 'chat:clearAllSessions') return { success: true };
      if (channel === 'system:selectDirectory') return '/mock/directory/path';
      if (channel === 'system:stats') return {
        platform: 'web',
        arch: 'mock',
        cpuModel: 'Mock CPU',
        memoryUsage: 50,
        totalMemory: '16.0 GB',
        uptime: 123
      };
      return null;
    },
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
    <App />
  </React.StrictMode>,
)

// Use contextBridge
window.ipcRenderer.on('main-process-message', (_event, message) => {
  console.log(message)
})
