/// <reference types="vite/client" />

interface Window {
  ipcRenderer: {
    invoke(channel: string, ...args: any[]): Promise<any>;
    invoke(channel: 'ollama:check', baseUrl?: string): Promise<{running: boolean; message?: string; error?: string}>;
    invoke(channel: 'ollama:start'): Promise<{success: boolean; error?: string}>;
    invoke(channel: 'ollama:pull', args: {baseUrl: string; modelName: string}): Promise<{success: boolean; error?: string}>;
    invoke(channel: 'plugins:listStore'): Promise<any[]>;
    invoke(channel: 'plugins:listInstalled'): Promise<any[]>;
    invoke(channel: 'plugins:install', args: { id: string, scope?: string }): Promise<{ success: boolean; error?: string }>;
    invoke(channel: 'plugins:uninstall', args: { id: string, scope?: string }): Promise<{ success: boolean; error?: string }>;
    on(channel: string, listener: (event: any, ...args: any[]) => void): () => void;
    send(channel: string, ...args: any[]): void;
    off(channel: string, listener: (...args: any[]) => void): void;
  };
}
