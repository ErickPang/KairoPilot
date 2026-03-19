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
  removeListener(channel: string, listener: (...args: any[]) => void): void;
  removeAllListeners(channel: string): void;
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  ipcRenderer: CustomIpcRenderer
}
