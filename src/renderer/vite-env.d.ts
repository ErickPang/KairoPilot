/// <reference types="vite/client" />

interface Window {
  ipcRenderer: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    invoke(channel: 'ollama:check', baseUrl?: string): Promise<{running: boolean; message?: string; error?: string}>;
    invoke(channel: 'ollama:start'): Promise<{success: boolean; error?: string}>;
    invoke(channel: 'ollama:pull', args: {baseUrl: string; modelName: string}): Promise<{success: boolean; error?: string}>;
    invoke(channel: 'plugins:listStore'): Promise<unknown[]>;
    invoke(channel: 'plugins:listInstalled'): Promise<unknown[]>;
    invoke(channel: 'plugins:install', args: { id: string, scope?: string }): Promise<{ success: boolean; error?: string }>;
    invoke(channel: 'plugins:uninstall', args: { id: string, scope?: string }): Promise<{ success: boolean; error?: string }>;
    on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): () => void;
    send(channel: string, ...args: unknown[]): void;
    off(channel: string, listener: (...args: unknown[]) => void): void;
    removeListener?(channel: string, listener: (...args: unknown[]) => void): void;
    removeAllListeners?(channel: string): void;
  };
}
