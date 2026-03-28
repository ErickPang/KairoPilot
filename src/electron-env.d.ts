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

type KairoInvokeChannel = import('./shared/ipc').KairoInvokeChannel
type KairoEventChannel = import('./shared/ipc').KairoEventChannel
type InvokeSuccess = { success: boolean; error?: string }
type OllamaStatus = { running: boolean; message?: string; error?: string }
type OllamaPullProgress = { status: string; completed?: number; total?: number }
type AgentUpdatePayload = {
  type: string;
  content?: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

interface KairoBridge {
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.agentChat, args: { userInput: string } | string): Promise<{ content?: string; error?: string }>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.agentConfirmResponse, args: { id: string; approved: boolean }): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.agentInit, args: import('./shared/contracts').AgentConfig | string): Promise<InvokeSuccess>;
  invoke(
    channel: typeof import('./shared/ipc').KAIRO_INVOKE.auditGet,
    query?: import('./renderer/types').AuditLogQuery | number
  ): Promise<import('./renderer/types').AuditLogQueryResult>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatClearAllSessions): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatCreateSession, title?: string): Promise<import('./renderer/types').Session>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatDeleteSession, sessionId: string): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatGetActiveSession): Promise<import('./renderer/types').Session | null>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatGetAgentStats): Promise<import('./renderer/types').AgentStats[]>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatGetSession, sessionId: string): Promise<import('./renderer/types').Session | null>;
  invoke(
    channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatGetTokenUsageDetails,
    args?: import('./renderer/types').MonitoringTokenQuery
  ): Promise<import('./renderer/types').MonitoringTokenQueryResult>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatListSessions): Promise<import('./renderer/types').SessionSummary[]>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatSetActiveSession, sessionId: string): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatUpdateSessionTitle, args: { sessionId: string; title: string }): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.configCreateAgentDraft, seed?: Partial<import('./shared/contracts').AgentConfig>): Promise<import('./shared/contracts').AgentConfig>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.configDeleteAgent, id: string): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.configDeleteModel, id: string): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.configGet): Promise<import('./shared/contracts').LegacyAgentConfig>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.configGetActiveAgentId): Promise<string | null>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.configGetAgents): Promise<import('./shared/contracts').AgentConfig[]>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.configGetAll): Promise<import('./shared/contracts').KairoPilotConfig>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.configGetModels): Promise<import('./shared/contracts').ProviderConfig[]>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.configSave, config: import('./shared/contracts').LegacyAgentConfig): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.configSaveAgent, agent: import('./shared/contracts').AgentConfig): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.configSaveModel, model: import('./shared/contracts').ModelConfig): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.configSetActiveAgent, id: string): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.llmListModels, config: import('./shared/contracts').ModelConfig): Promise<string[]>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.ollamaCheck, baseUrl?: string): Promise<OllamaStatus>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.ollamaPull, args: { baseUrl: string; modelName: string }): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.ollamaStart): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.pluginsGetInstalled): Promise<Record<string, unknown>[]>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.pluginsGetStore): Promise<Record<string, unknown>[]>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.pluginsInstall, args: { id: string; scope?: string }): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.pluginsUninstall, args: { id: string; scope?: string }): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.skillsGetAll): Promise<Record<string, import('./shared/contracts').SkillSummary[]>>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.skillsGetRegistry): Promise<import('./shared/contracts').SkillsRegistryEntry[]>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.skillsSetRegistry, args: import('./shared/contracts').SkillsRegistryEntry[]): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.skillsPrepareInstall, args: import('./shared/contracts').SkillInstallReviewArgs): Promise<import('./shared/contracts').SkillInstallReview>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.skillsGetStore): Promise<import('./shared/contracts').SkillStoreEntry[]>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.skillsGetStoreByQuery, args: import('./shared/contracts').SkillMarketplaceQuery): Promise<import('./shared/contracts').SkillStoreEntry[]>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.skillsInstall, args: import('./shared/contracts').SkillInstallArgs): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.skillsDiscardInstall, args: import('./shared/contracts').SkillInstallArgs): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.systemSelectDirectory): Promise<string | null>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.systemStats): Promise<import('./renderer/types').SystemStats | null>;
  on(channel: typeof import('./shared/ipc').KAIRO_EVENT.agentAskConfirmation, listener: (request: import('./renderer/types').ConfirmationRequest) => void): () => void;
  on(channel: typeof import('./shared/ipc').KAIRO_EVENT.agentUpdate, listener: (payload: AgentUpdatePayload) => void): () => void;
  on(channel: typeof import('./shared/ipc').KAIRO_EVENT.mainProcessMessage, listener: (message: string) => void): () => void;
  on(channel: typeof import('./shared/ipc').KAIRO_EVENT.ollamaPullProgress, listener: (payload: OllamaPullProgress) => void): () => void;
  invoke(channel: KairoInvokeChannel, ...args: unknown[]): Promise<unknown>;
  on(channel: KairoEventChannel, listener: (...args: unknown[]) => void): () => void;
}

interface Window {
  kairo: KairoBridge
}
