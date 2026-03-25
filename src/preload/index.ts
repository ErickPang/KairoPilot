import { contextBridge, ipcRenderer } from 'electron'

const ALLOWED_INVOKE_CHANNELS = new Set([
  'agent:chat',
  'agent:confirm-response',
  'agent:init',
  'audit:get',
  'chat:clearAllSessions',
  'chat:createSession',
  'chat:deleteSession',
  'chat:getActiveSession',
  'chat:getAgentStats',
  'chat:getTokenUsageDetails',
  'chat:getSession',
  'chat:listSessions',
  'chat:setActiveSession',
  'chat:updateSessionTitle',
  'config:delete-agent',
  'config:delete-model',
  'config:get-agents',
  'config:get-all',
  'config:save-agent',
  'config:save-model',
  'config:set-active-agent',
  'llm:listModels',
  'ollama:check',
  'ollama:pull',
  'ollama:start',
  'plugins:getInstalled',
  'plugins:getStore',
  'plugins:install',
  'plugins:uninstall',
  'skills:getAll',
  'system:stats',
])

const ALLOWED_EVENT_CHANNELS = new Set([
  'agent:ask-confirmation',
  'agent:update',
  'main-process-message',
  'ollama:pull-progress',
])

function assertAllowedChannel(channel: string, allowedChannels: Set<string>) {
  if (!allowedChannels.has(channel)) {
    throw new Error(`IPC channel not allowed: ${channel}`)
  }
}

contextBridge.exposeInMainWorld('kairo', {
  invoke(channel: string, ...args: unknown[]) {
    assertAllowedChannel(channel, ALLOWED_INVOKE_CHANNELS)
    return ipcRenderer.invoke(channel, ...args)
  },
  on(channel: string, listener: (...args: unknown[]) => void) {
    assertAllowedChannel(channel, ALLOWED_EVENT_CHANNELS)
    const wrappedListener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
      listener(...args)
    }
    ipcRenderer.on(channel, wrappedListener)
    return () => {
      ipcRenderer.removeListener(channel, wrappedListener)
    }
  },
})
