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
  agentId?: string;
  sessionId?: string;
  type: string;
  content?: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  runId?: string;
  stepId?: string;
  status?: string;
}

interface KairoBridge {
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.projectMemoryGet, projectId:string): Promise<import('./shared/contracts').ProjectMemoryState>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.projectMemoryRetry, value:{projectId:string;runId:string;revision:number}): Promise<import('./shared/contracts').ProjectMemoryState>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.projectMemoryConfigure, value:{projectId:string;enabled:boolean}): Promise<import('./shared/contracts').ProjectMemoryState>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.projectMemoryEdit, value:{projectId:string;id:string;revision:number;action:'edit'|'forget'|'accept';content?:string}): Promise<import('./shared/contracts').ProjectMemoryEntry>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.delegationList, sessionId:string): Promise<import('./shared/contracts').DelegatedTask[]>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.delegationStop, value:{sessionId:string;id:string}): Promise<{success:boolean}>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.delegationRetry, value:{sessionId:string;id:string;revision:number}): Promise<import('./shared/contracts').DelegatedTask>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.taskTemplatesList): Promise<import('./shared/contracts').TaskTemplate[]>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.taskTemplatesSave, value: Pick<import('./shared/contracts').TaskTemplate,'name'|'instructions'|'output'|'acceptance'> & {id?:string;version?:number}): Promise<import('./shared/contracts').TaskTemplate>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.usageOverview, input?:{projectId?:string}): Promise<import('./shared/usageOverview').UsageOverview>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.taskPlanGet, sessionId:string): Promise<import('./shared/contracts').TaskPlan|null>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.taskQueueList, sessionId:string): Promise<import('./shared/contracts').QueuedTaskMessage[]>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.taskQueueAdd, input:{sessionId:string;draftRevision:number;data:import('./shared/contracts').TaskDraftInput}): Promise<import('./shared/contracts').QueuedTaskMessage>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.taskQueueChange, input:{sessionId:string;id:string;revision:number;action:'edit'|'remove'|'up'|'down'|'continue';content?:string}): Promise<import('./shared/contracts').QueuedTaskMessage[]>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.taskPlanEdit, value:{sessionId:string;planId:string;revision:number;body:string}): Promise<import('./shared/contracts').TaskPlan>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.taskPlanReject, value:{sessionId:string;planId:string;revision:number}): Promise<import('./shared/contracts').TaskPlan>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.taskPlanApprove, value:{sessionId:string;planId:string;revision:number}): Promise<import('./shared/contracts').AgentRuntimeInvokeResult>;

  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.workbenchInit): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.configGetWorkbench): Promise<import('./shared/contracts').WorkbenchConfig>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.configSaveWorkbench, value: import('./shared/contracts').WorkbenchSettingsInput): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatUpdateTaskSettings, value: {sessionId:string;model?:string;executionProfile?:import('./shared/contracts').ExecutionProfile;rootPath?:string;templateId?:string|null;workflow?:'direct'|'plan';delegation?:'off'|'auto'|'manual';intelligenceBudget?:import('./shared/contracts').IntelligenceBudget}): Promise<import('./shared/contracts').SessionSummary>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.projectUpdateRules, input: {projectId: string; rules: string; memory: string}): Promise<void>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.projectRename, input: { projectId: string; name: string }): Promise<void>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.projectDetach, projectId: string): Promise<void>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.projectContinue, input: { projectId: string; name: string; rootPath: string }): Promise<import('./shared/contracts').ProjectSummary>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatQuerySessions, input?: import('./shared/contracts').SessionListQuery): Promise<import('./shared/contracts').SessionListPage>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatGetActiveSummary): Promise<import('./shared/contracts').SessionSummary | null>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatGetMessagePage, input: import('./shared/contracts').MessagePageQuery): Promise<import('./shared/contracts').SessionMessagePage<import('./renderer/types').Message>>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatGetTaskChanges, sessionId: string): Promise<import('./shared/contracts').TaskChangeSummary[]>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatGetTaskChangeDiff, input: { sessionId: string; path: string;runId?:string }): Promise<import('./shared/contracts').ArtifactDiff>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.appQuitDraftResponse, input: import('./shared/contracts').QuitDraftResponse): Promise<boolean>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatCreateReference, input: {sessionId: string; path: string}): Promise<import('./shared/contracts').ContextReference>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatGetDraft, sessionId: string): Promise<import('./shared/contracts').TaskDraft>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatSaveDraft, input: {sessionId: string; revision: number; data: import('./shared/contracts').TaskDraftInput}): Promise<number>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatArchiveTask, input: {sessionId: string; archived: boolean}): Promise<void>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatReadTask, input: {sessionId: string; version: number}): Promise<void>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.projectList): Promise<import('./shared/contracts').ProjectSummary[]>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.projectCreate, input: { name: string; rootPath: string }): Promise<import('./shared/contracts').ProjectSummary>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.projectBind, projectId: string): Promise<import('./shared/contracts').ProjectSummary>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatGetTaskResults, sessionId: string): Promise<import('./shared/contracts').TaskResults>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatGetArtifactDiff, artifactId: string): Promise<import('./shared/contracts').ArtifactDiff>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatGetWorkingDiff, sessionId: string): Promise<{ available: boolean; diff: string; omittedFiles?: number }>;
  invoke(
    channel: typeof import('./shared/ipc').KAIRO_INVOKE.agentChat,
    args: { userInput: string } | string
  ): Promise<import('./shared/contracts').AgentRuntimeInvokeResult>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.agentPauseRun, args: { runId: string }): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.agentResumeRun, args: { runId: string }): Promise<import('./shared/contracts').AgentRuntimeInvokeResult>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.agentCancelRun, args: { runId: string }): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.agentRetryStep, args: { runId: string; stepId: string }): Promise<import('./shared/contracts').AgentRuntimeInvokeResult>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.agentConfirmResponse, args: { id: string; approved: boolean; scope?: import('./shared/contracts').ApprovalDecisionScope }): Promise<import('./shared/contracts').AgentRuntimeInvokeResult>;
  invoke(
    channel: typeof import('./shared/ipc').KAIRO_INVOKE.auditGet,
    query?: import('./renderer/types').AuditLogQuery | number
  ): Promise<import('./renderer/types').AuditLogQueryResult>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatClearAllSessions): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatCreateSession, input?: string | { title?: string; projectId?: string }): Promise<import('./renderer/types').Session>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatDeleteSession, sessionId: string): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatGetActiveSession): Promise<import('./renderer/types').Session | null>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatGetAgentStats): Promise<import('./renderer/types').AgentStats[]>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatGetLatestRun, sessionId?: string): Promise<import('./renderer/types').RunSummary | null>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatGetPendingApproval, sessionId?: string): Promise<import('./renderer/types').ApprovalRecord | null>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatGetSession, sessionId: string): Promise<import('./renderer/types').Session | null>;
  invoke(
    channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatGetTokenUsageDetails,
    args?: import('./renderer/types').MonitoringTokenQuery
  ): Promise<import('./renderer/types').MonitoringTokenQueryResult>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatListSessions): Promise<import('./renderer/types').SessionSummary[]>;
  invoke(
    channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatPrepareAttachments,
    args: import('./shared/contracts').PrepareAttachmentsRequest
  ): Promise<import('./shared/contracts').PrepareAttachmentsResult>;
  invoke(
    channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatDeleteAttachment,
    args: import('./shared/contracts').DeleteAttachmentRequest
  ): Promise<InvokeSuccess & { deleted?: boolean }>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatSetActiveSession, sessionId: string): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.chatUpdateSessionTitle, args: { sessionId: string; title: string }): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.configDeleteModel, id: string): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.configGetAll): Promise<import('./shared/contracts').KairoPilotConfig>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.configGetAppearance): Promise<import('./shared/contracts').AppearanceConfig>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.configGetModels): Promise<import('./shared/contracts').ProviderConfig[]>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.configGetWebSearch): Promise<import('./shared/contracts').WebSearchConfig>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.configSaveAppearance, config: import('./shared/contracts').AppearanceConfig): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.configSaveModel, model: import('./shared/contracts').ModelConfig): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.configSaveWebSearch, config: import('./shared/contracts').WebSearchConfig): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.llmListModels, config: import('./shared/contracts').ModelConfig): Promise<string[]>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.ollamaCheck, baseUrl?: string): Promise<OllamaStatus>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.ollamaPull, args: { baseUrl: string; modelName: string }): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.ollamaStart): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.ollamaListModels, baseUrl?: string): Promise<import('./shared/contracts').OllamaListModelsResult>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.ollamaDeleteModel, args: { baseUrl?: string; modelName: string }): Promise<InvokeSuccess>;
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
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.skillsImport, args: import('./shared/contracts').SkillImportArgs): Promise<InvokeSuccess>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.systemSelectFile, args?: { filters?: { name: string; extensions: string[] }[] }): Promise<string | null>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.systemSelectFiles, args?: { filters?: { name: string; extensions: string[] }[] }): Promise<string[]>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.systemSelectDirectory): Promise<string | null>;
  invoke(channel: typeof import('./shared/ipc').KAIRO_INVOKE.systemStats): Promise<import('./renderer/types').SystemStats | null>;
  on(channel: typeof import('./shared/ipc').KAIRO_EVENT.agentUpdate, listener: (payload: AgentUpdatePayload) => void): () => void;
  on(channel: typeof import('./shared/ipc').KAIRO_EVENT.mainProcessMessage, listener: (message: string) => void): () => void;
  on(channel: typeof import('./shared/ipc').KAIRO_EVENT.ollamaPullProgress, listener: (payload: OllamaPullProgress) => void): () => void;
  invoke(channel: KairoInvokeChannel, ...args: unknown[]): Promise<unknown>;
  on(channel: KairoEventChannel, listener: (...args: unknown[]) => void): () => void;
}

interface Window {
  kairo: KairoBridge
}
