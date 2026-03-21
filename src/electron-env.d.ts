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
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): () => void;
  off(channel: string, listener: (...args: unknown[]) => void): void;
  send(channel: string, ...args: unknown[]): void;
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  invoke(channel: 'ollama:check', baseUrl?: string): Promise<{running: boolean; message?: string; error?: string}>;
  invoke(channel: 'ollama:start'): Promise<{success: boolean; error?: string}>;
  invoke(channel: 'ollama:pull', args: {baseUrl: string; modelName: string}): Promise<{success: boolean; error?: string}>;
  invoke(channel: 'plugins:getStore'): Promise<Record<string, unknown>[]>;
  invoke(channel: 'plugins:getInstalled'): Promise<Record<string, unknown>[]>;
  invoke(channel: 'plugins:install', args: {id: string, scope?: string}): Promise<{success: boolean; error?: string}>;
  invoke(channel: 'plugins:uninstall', args: {id: string, scope?: string}): Promise<{success: boolean; error?: string}>;
  invoke(channel: 'agent:init', args: Record<string, unknown>): Promise<{success: boolean; error?: string}>;
  invoke(channel: 'agent:chat', args: {userInput: string}): Promise<{content?: string; error?: string}>;
  removeListener(channel: string, listener: (...args: unknown[]) => void): void;
  removeAllListeners(channel: string): void;
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  ipcRenderer: CustomIpcRenderer
}
