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

type KairoInvokeChannel =
  | 'agent:chat'
  | 'agent:confirm-response'
  | 'agent:init'
  | 'audit:get'
  | 'chat:clearAllSessions'
  | 'chat:createSession'
  | 'chat:deleteSession'
  | 'chat:getActiveSession'
  | 'chat:getAgentStats'
  | 'chat:getTokenUsageDetails'
  | 'chat:getSession'
  | 'chat:listSessions'
  | 'chat:setActiveSession'
  | 'chat:updateSessionTitle'
  | 'config:delete-agent'
  | 'config:delete-model'
  | 'config:get-agents'
  | 'config:get-all'
  | 'config:save-agent'
  | 'config:save-model'
  | 'config:set-active-agent'
  | 'llm:listModels'
  | 'ollama:check'
  | 'ollama:pull'
  | 'ollama:start'
  | 'plugins:getInstalled'
  | 'plugins:getStore'
  | 'plugins:install'
  | 'plugins:uninstall'
  | 'skills:getAll'
  | 'system:stats'

type KairoEventChannel =
  | 'agent:ask-confirmation'
  | 'agent:update'
  | 'main-process-message'
  | 'ollama:pull-progress'

interface KairoBridge {
  invoke(channel: KairoInvokeChannel, ...args: unknown[]): Promise<unknown>;
  invoke(channel: 'ollama:check', baseUrl?: string): Promise<{ running: boolean; message?: string; error?: string }>;
  invoke(channel: 'ollama:start'): Promise<{ success: boolean; error?: string }>;
  invoke(channel: 'ollama:pull', args: { baseUrl: string; modelName: string }): Promise<{ success: boolean; error?: string }>;
  invoke(channel: 'plugins:getStore'): Promise<Record<string, unknown>[]>;
  invoke(channel: 'plugins:getInstalled'): Promise<Record<string, unknown>[]>;
  invoke(channel: 'plugins:install', args: { id: string; scope?: string }): Promise<{ success: boolean; error?: string }>;
  invoke(channel: 'plugins:uninstall', args: { id: string; scope?: string }): Promise<{ success: boolean; error?: string }>;
  invoke(channel: 'agent:init', args: Record<string, unknown> | string): Promise<{ success: boolean; error?: string }>;
  invoke(channel: 'agent:chat', args: { userInput: string } | string): Promise<{ content?: string; error?: string }>;
  on(channel: KairoEventChannel, listener: (...args: unknown[]) => void): () => void;
}

interface Window {
  kairo: KairoBridge
}
