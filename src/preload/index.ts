import { contextBridge, ipcRenderer } from 'electron'
import {
  KAIRO_EVENT_CHANNELS,
  KAIRO_INVOKE_CHANNELS,
  type KairoEventChannel,
  type KairoInvokeChannel
} from '../shared/ipc'

const ALLOWED_INVOKE_CHANNELS = new Set<KairoInvokeChannel>(KAIRO_INVOKE_CHANNELS)
const ALLOWED_EVENT_CHANNELS = new Set<KairoEventChannel>(KAIRO_EVENT_CHANNELS)

function assertAllowedChannel(channel: string, allowedChannels: Set<string>) {
  if (!allowedChannels.has(channel)) {
    throw new Error(`IPC channel not allowed: ${channel}`)
  }
}

contextBridge.exposeInMainWorld('kairo', {
  invoke(channel: KairoInvokeChannel, ...args: unknown[]) {
    assertAllowedChannel(channel, ALLOWED_INVOKE_CHANNELS)
    return ipcRenderer.invoke(channel, ...args)
  },
  on(channel: KairoEventChannel, listener: (...args: unknown[]) => void) {
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
