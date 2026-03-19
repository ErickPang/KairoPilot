/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Custom IPC interface matching preload.ts
interface CustomIpcRenderer {
  on(channel: string, listener: (event: any, ...args: any[]) => void): () => void;
  off(channel: string, listener: (...args: any[]) => void): void;
  send(channel: string, ...args: any[]): void;
  invoke(channel: string, ...args: any[]): Promise<any>;
  invoke(channel: 'ollama:check', baseUrl?: string): Promise<{running: boolean; message?: string; error?: string}>;
  invoke(channel: 'ollama:start'): Promise<{success: boolean; error?: string}>;
  invoke(channel: 'ollama:pull', args: {baseUrl: string; modelName: string}): Promise<{success: boolean; error?: string}>;
  invoke(channel: 'plugins:getStore'): Promise<any[]>;
  invoke(channel: 'plugins:getInstalled'): Promise<any[]>;
  invoke(channel: 'plugins:install', args: {id: string, scope?: string}): Promise<{success: boolean; error?: string}>;
  invoke(channel: 'plugins:uninstall', args: {id: string, scope?: string}): Promise<{success: boolean; error?: string}>;
  removeListener(channel: string, listener: (...args: any[]) => void): void;
  removeAllListeners(channel: string): void;
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  ipcRenderer: CustomIpcRenderer
}
