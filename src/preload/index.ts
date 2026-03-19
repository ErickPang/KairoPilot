import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(channel: string, listener: (event: Electron.IpcRendererEvent, ...args: any[]) => void) {
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  },
  off(channel: string, listener: (...args: any[]) => void) {
    ipcRenderer.removeListener(channel, listener)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})
