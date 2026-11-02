export type ProviderType = 'openai' | 'openrouter' | 'ollama' | 'anthropic' | 'deepseek' | 'zhipu' | 'kimi' | 'qianwen' | 'custom'

export interface OllamaModelInfo {
  name: string
  model: string
  modified_at: string
  size: number
  digest: string
  details: {
    parent_model: string
    format: string
    family: string
    families: string[]
    parameter_size: string
    quantization_level: string
  }
}

export interface OllamaListModelsResult {
  models: OllamaModelInfo[]
}

export interface ModelOption {
  id: string
  name: string
  contextWindowTokens?: number
}

export interface ProviderConfig {
  provider: ProviderType
  baseUrl: string
  apiKey: string
  apiKeyEncrypted?: string
  apiKeyStored?: boolean
  model: ModelOption[]
}

export interface ModelConfig {
  id: string
  name: string
  provider: ProviderType
  baseUrl: string
  apiKey: string
  apiKeyStored?: boolean
  model: string
  availableModels?: ModelOption[]
  contextWindowTokens?: number
}

export type ProviderProtocol = 'openai-compatible' | 'native'

export interface ProviderCapabilitySnapshot {
  provider: ProviderType
  adapterId: string
  adapterName: string
  protocol: ProviderProtocol
  supported: boolean
  defaultBaseUrl?: string
  capabilities: {
    chat: boolean
    stream: boolean
    toolCalling: boolean
    modelListing: boolean
    structuredOutput: boolean
    multimodalInput: boolean
  }
  notes?: string
}

export type ExecutionProfile =
  | 'chat_only'
  | 'read_only_workspace'
  | 'approved_execution'
  | 'trusted_automation'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type ApprovalMode = 'never' | 'on_write' | 'on_external' | 'always'
export type ApprovalDecisionScope = 'once' | 'session'
export interface SessionApprovalScope { kind: 'tool' | 'origin' | 'directory' | 'command'; target: string }

export type EnvironmentScope = 'workspace' | 'allowed_paths' | 'isolated_env'

export type DataClass = 'public' | 'project' | 'sensitive'

export interface AgentPermissionConfig {
  executionProfile: ExecutionProfile
  policy: {
    approvalMode: ApprovalMode
    environmentScope: EnvironmentScope
    dataClass: DataClass
    redactSensitiveOutput: boolean
  }
  fileSystem: {
    read: boolean
    write: boolean
    allowedPaths: string[]
  }
  network: {
    enabled: boolean
    allowedDomains: string[]
  }
  shell: {
    enabled: boolean
    allowedCommands: string[]
  }
}

export function applyExecutionProfileConstraints(permissions: AgentPermissionConfig): AgentPermissionConfig {
  if (permissions.executionProfile === 'chat_only') {
    return {
      ...permissions,
      fileSystem: {
        ...permissions.fileSystem,
        read: false,
        write: false
      },
      network: {
        ...permissions.network,
        enabled: false
      },
      shell: {
        ...permissions.shell,
        enabled: false
      }
    }
  }

  if (permissions.executionProfile === 'read_only_workspace') {
    return {
      ...permissions,
      fileSystem: {
        ...permissions.fileSystem,
        write: false
      },
      shell: {
        ...permissions.shell,
        enabled: false
      }
    }
  }

  return permissions
}

export interface AgentConfig {
  id: string
  name: string
  workspace: string
  workspaceName?: string
  systemPrompt: string
  instructionRoot?: string
  instructionSources?: Array<{path:string;hash:string;scope:'global'|'project'}>
  model: string
  permissions: AgentPermissionConfig
}

/** Unified workbench settings. */
export interface WorkbenchConfig {
  version: 2
  defaultModel: string
  managementRoot: string
  instructionRoot?: string
  permissions: AgentPermissionConfig
  instructions: string
  instructionPath?: string
  instructionsHash?: string
}

export type WorkbenchSettingsInput = Pick<WorkbenchConfig,'defaultModel'|'permissions'|'instructions'>

export interface TaskExecutionSettings {
  intelligenceBudget?: IntelligenceBudget
  delegation?: 'off' | 'auto' | 'manual'
  workflow?: 'direct' | 'plan'
  template?: TaskTemplate | null
  model: string
  permissions: AgentPermissionConfig
}

export interface AgentStats {
  agentId: string
  totalSessions: number
  totalMessages: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  totalRuns: number
  completedRuns: number
  failedRuns: number
  cancelledRuns: number
  waitingApprovalRuns: number
  approvalRequests: number
  approvalApproved: number
  toolCalls: number
  successfulToolCalls: number
}

export interface AuditLogEntry {
  id: string
  timestamp: number
  tool: string
  args: Record<string, unknown>
  result?: unknown
  error?: string
  sessionId?: string
  runId?: string
  stepId?: string
  policyTags?: string[]
}

export interface QueryFacet {
  value: string
  count: number
}

export interface TokenMetricFacet extends QueryFacet {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface PagedQueryResult<TItem, TAggregations> {
  items: TItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  aggregations: TAggregations
}

export type AuditStatusFilter = 'all' | 'success' | 'error'

export interface AuditLogQuery {
  page?: number
  pageSize?: number
  search?: string
  status?: AuditStatusFilter
  tool?: string
  tag?: string
  sessionId?: string
  runId?: string
  stepId?: string
  startTime?: number
  endTime?: number
}

export interface AuditLogAggregations {
  successCount: number
  errorCount: number
  tools: QueryFacet[]
  tags: QueryFacet[]
}

export type AuditLogQueryResult = PagedQueryResult<AuditLogEntry, AuditLogAggregations>

export interface MonitoringTokenUsageItem {
  id: string
  sessionId: string
  sessionTitle: string
  agentId: string
  role: string
  content: string
  timestamp: number
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface MonitoringTokenQuery {
  projectId?: string
  agentId?: string
  page?: number
  pageSize?: number
  search?: string
  model?: string
  role?: string
  sessionId?: string
  startTime?: number
  endTime?: number
}

export interface MonitoringTokenAggregations {
  agentId?: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  totalRecords: number
  models: TokenMetricFacet[]
  roles: TokenMetricFacet[]
}

export type MonitoringTokenQueryResult = PagedQueryResult<MonitoringTokenUsageItem, MonitoringTokenAggregations>

export type RunStatus = 'running' | 'waiting_approval' | 'paused' | 'completed' | 'failed' | 'cancelled'

export interface AgentRuntimeInvokeResult {
  success: boolean
  content?: string
  error?: string
  status?: RunStatus
  runId?: string
  approvalId?: string
}

export type ChatAttachmentKind = 'image' | 'text' | 'file'

export interface ChatAttachment {
  id: string
  sessionId: string
  name: string
  mimeType: string
  size: number
  kind: ChatAttachmentKind
  originalPath?: string
  storedPath: string
  contentHash: string
  previewUri?: string
  extractedText?: string
  createdAt: number
}

export interface PrepareAttachmentInput {
  path: string
  name?: string
  mimeType?: string
}

export interface PrepareAttachmentsRequest {
  sessionId: string
  files: PrepareAttachmentInput[]
}

export interface PrepareAttachmentsResult {
  success: boolean
  attachments?: ChatAttachment[]
  error?: string
}

export interface DeleteAttachmentRequest {
  sessionId: string
  attachment: ChatAttachment
}

export interface AgentChatRequest {
  sessionId: string
  referenceIds?: string[]
  draftRevision?: number
  content: string
  attachments?: ChatAttachment[]
}

export type RuntimeUpdateEvent = { agentId?: string; sessionId?: string; callId?: string } & (
  | { type: 'assistant-message'; runId: string; stepId: string; content: string; phase: 'commentary' | 'draft' }
  | { type: 'session-title-updated'; runId: string; title: string }
  | {type:'queue-dispatched';runId:string;queueId:string;content:string;attachments?:ChatAttachment[];references?:ContextReference[]}
  | { type: 'draft-accepted'; runId: string; revision: number; referenceIds: string[]; attachmentIds: string[] }
  | {
      type: 'thinking'
      content: string
      runId: string
      stepId?: string
      status?: 'running'
    }
  | {
      type: 'assistant-delta'
      delta: string
      content: string
      runId: string
      stepId?: string
      status?: 'running'
    }
  | {
      type: 'tool-call'
      tool: string
      args: Record<string, unknown>
      runId: string
      stepId?: string
      status?: 'running'
    }
  | {
      type: 'tool-result'
      tool: string
      result: unknown
      runId: string
      stepId?: string
      status?: 'completed'
    }
  | {
      type: 'tool-error'
      tool: string
      error: string
      runId: string
      stepId?: string
      status?: 'failed'
    }
  | {
      type: 'assistant-response'
      content: string
      runId: string
      status: 'completed'
    }
  | {
      type: 'approval-required'
      sessionApproval?: SessionApprovalScope
      tool: string
      args: Record<string, unknown>
      runId: string
      sessionId?: string
      stepId?: string
      approvalId: string
      riskLevel?: string
      approvalMode?: string
      policyTags?: string[]
      redacted?: boolean
      status: 'waiting_approval'
    }
  | {
      type: 'run-paused' | 'run-cancelled' | 'run-failed'
      runId: string
      stepId?: string
      status: 'paused' | 'cancelled' | 'failed'
      error?: string
    }

)

export type RunStepType =
  | 'plan'
  | 'model_call'
  | 'tool_call'
  | 'approval_wait'
  | 'tool_result'
  | 'summary'
  | 'complete'
  | 'failed'

export type RunStepStatus = 'pending' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled'

export interface RunSummary {
  id: string
  sessionId: string
  agentId: string
  goal: string
  userInput: string
  status: RunStatus
  finalResponse?: string
  error?: string
  waitingApprovalId?: string
  createdAt: number
  updatedAt: number
  startedAt?: number
  completedAt?: number
  executionContext?: RunExecutionContext
}

export interface ProjectSummary {
  authorized?: boolean
  instructionPath?:string
  rules?: string
  memory?: string
  id: string
  name: string
  rootPath: string
  createdAt: number
  previousProjectId?: string
}



export interface SessionSummary extends SessionProjectContext {
  id: string
  title: string
  agentId?: string
  createdAt: number
  updatedAt: number
  runStatus?: RunStatus
}

export interface SessionListQuery {
  projectId?: string | null
  filter?: 'open' | 'archived' | 'unread' | 'all'
  search?: string
  limit?: number
  before?: { updatedAt: number; id: string }
  includeSessionId?: string
  includeActiveSession?: boolean
}

export interface SessionListPage {
  items: SessionSummary[]
  total: number
  nextCursor?: { updatedAt: number; id: string }
  selectedSession?: SessionSummary
}

export interface MessagePageQuery {
  sessionId: string
  limit?: number
  before?: { timestamp: number; rowId: number; generation: number }
}

export interface SessionMessagePage<T> {
  session: SessionSummary
  messages: T[]
  total: number
  generation: number
  nextCursor?: { timestamp: number; rowId: number; generation: number }
}

export interface TaskChangeSummary {
  path: string
  artifactIds: string[]
  runIds: string[]
  operation: 'created' | 'modified' | 'deleted' | 'no_remaining_file'
  hasDiscontinuity: boolean
  diffAvailable: boolean
  availability: 'available' | 'changed' | 'missing' | 'denied'
}

export interface SessionProjectContext {
  executionSettings?: TaskExecutionSettings
  projectId?: string
  executionRoot?: string
  archivedAt?: number
  activityVersion?: number
  readVersion?: number
}

export interface ContextReference {
  id: string
  sessionId: string
  agentId: string
  projectId?: string
  path: string
  name: string
  kind: 'file' | 'directory'
  createdAt: number
  availability?: 'available' | 'missing' | 'denied'
}

export interface TaskDraftInput {
  input: string
  referenceIds: string[]
  attachmentIds: string[]
}

export interface QueuedTaskMessage {
 id:string
 sessionId:string
 revision:number
 position:number
 createdAt:number
 status:'queued'|'blocked'|'dispatching'|'sent'
 data:TaskDraftInput
 error?:string
 runId?:string
}

export interface TaskDraft extends TaskDraftInput {
  revision: number
  references: ContextReference[]
  attachments: ChatAttachment[]
  missingAttachmentIds: string[]
}

export interface RunExecutionContext extends SessionProjectContext {
  instructionVersion?:1
  instructionSources?: Array<{path:string;hash:string;scope:'global'|'project'}>
  acceptance?:string
  intelligenceBudget?: IntelligenceBudget
  delegation?: 'off' | 'auto' | 'manual'
  memorySnapshot?: ProjectMemorySnapshot
  phase?: 'planning' | 'execution'
  planId?: string
  planRevision?: number
  version?: 2
  sessionId?: string
  rulesHash?: string
  agentId: string
  agentWorkspace: string
  executionRoot: string
  model: string
  provider: ProviderType
  permissionsHash: string
  modelConfigHash?: string
}

export interface TaskArtifact {
  id: string
  runId: string
  sessionId: string
  toolCallId: string
  path: string
  operation: 'created' | 'modified' | 'deleted' | 'written'
  createdAt: number
  beforeHash?: string
  afterHash?: string
  diffAvailable: boolean
  availability?: 'available' | 'changed' | 'missing' | 'denied'
}

export interface VerificationRecord {
  id: string
  runId: string
  sessionId: string
  toolCallId: string
  command: string
  cwd: string
  status: 'passed' | 'failed' | 'interrupted'
  exitCode?: number
  stdout: string
  stderr: string
  createdAt: number
  outputAvailable?: boolean
}

export interface TaskResults {
  changes?: TaskChangeSummary[]
  artifacts: TaskArtifact[]
  verifications: VerificationRecord[]
}

export interface ArtifactDiff {
  oldText: string
  newText: string
  path: string
}

export interface RunStep {
  id: string
  runId: string
  stepIndex: number
  type: RunStepType
  status: RunStepStatus
  title: string
  input?: unknown
  output?: unknown
  error?: string
  metadata?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface ApprovalRecord {
  id: string
  runId: string
  stepId?: string
  sessionId?: string
  toolName: string
  args: Record<string, unknown>
  status: 'pending' | 'approved' | 'denied' | 'invalidated'
  metadata?: Record<string, unknown>
  createdAt: number
  updatedAt: number
  resolvedAt?: number
}

export interface ToolCallRecord {
  id: string
  runId: string
  stepId?: string
  toolName: string
  args?: unknown
  result?: unknown
  error?: string
  status: 'running' | 'waiting_approval' | 'success' | 'failed' | 'cancelled'
  createdAt: number
  updatedAt: number
}

export interface RequestContextBudget {
  contextTokens: number
  outputTokens: number
  safetyTokens: number
  inputLimitTokens: number
  messageTokens: number
  toolTokens: number
  estimatedInputTokens: number
  estimator: 'utf8_bytes_with_vision_reserve'
  source: 'model_limit' | 'local_fallback'
}

export interface ContextAssemblyBudget {
  request?: RequestContextBudget
  maxContextChars: number
  systemPromptChars: number
  supportChars: number
  recentHistoryChars: number
  totalChars: number
}

export interface ContextAssemblyLayerSummary {
  id: string
  title: string
  kind: 'system' | 'support' | 'history'
  messageCount: number
  charCount: number
  summary: string
}

export interface RunContextSummary {
  id: string
  runId: string
  sessionId?: string
  stepId?: string
  activeTaskSummary: string
  activeSkillsSummary: string
  availableSkillsSummary: string
  availableToolsSummary: string
  compactedHistorySummary: string
  unresolvedApprovals: string
  selectedToolResults: string
  workspaceRetrieval: string
  memoryDigest: string
  layers: ContextAssemblyLayerSummary[]
  recentMessageCount: number
  omittedMessageCount: number
  budget: ContextAssemblyBudget
  createdAt: number
}

export type SkillScope = 'public' | 'agent'

export interface SkillArgumentDefinition {
  name: string
  description: string
  required: boolean
  defaultValue?: string
}

export type SkillExecutionMode = 'inline' | 'fork'

export interface SkillMetadata {
  name: string
  description: string
  version?: string
  allowedTools: string[]
  whenToUse: string
  arguments: SkillArgumentDefinition[]
  userInvocable: boolean
  modelInvocable: boolean
  executionMode: SkillExecutionMode
}

export interface SkillRecord {
  id: string
  scope: SkillScope
  agentId?: string
  content: string
  skillDir: string
  skillFilePath: string
  contentHash: string
  metadata: SkillMetadata
}

export interface SkillSummary {
  id: string
  name: string
  description: string
  version?: string
  allowedTools: string[]
  whenToUse: string
  arguments: SkillArgumentDefinition[]
  userInvocable: boolean
  modelInvocable: boolean
  executionMode: SkillExecutionMode
  content: string
  source: SkillScope
  skillDir: string
  skillFilePath: string
  removable?: boolean
  rollbackAvailable?: boolean
  previousVersion?: string
}

export interface SkillStoreResource {
  path: string
  url?: string
  content?: string
  encoding?: 'utf-8' | 'base64'
}

export interface SkillStoreHttpSource {
  type: 'http'
  skillUrl: string
  files?: SkillStoreResource[]
}

export interface SkillStoreGithubSource {
  type: 'github'
  repo: string
  path: string
  ref?: string
  files?: SkillStoreResource[]
}

export interface SkillStoreInlineSource {
  type: 'inline'
  content: string
  files?: SkillStoreResource[]
}

export type SkillStoreSource = SkillStoreHttpSource | SkillStoreGithubSource | SkillStoreInlineSource

export type SkillsRegistrySourceType = 'manifest' | 'claude_marketplace'

export interface SkillStoreEntry {
  id: string
  name: string
  description: string
  version?: string
  author?: string
  icon?: string
  tags: string[]
  homepage?: string
  marketplace?: string
  registryUrl?: string
  sourceType?: SkillsRegistrySourceType
  source: SkillStoreSource
  installedScopes: string[]
}

export interface SkillInstallArgs {
  requestId: string
}

export interface SkillImportArgs {
  sourceFile: string
  scope: string
}

export interface SkillUninstallArgs {
  id: string
  scope: string
}

export interface SkillRollbackArgs {
  id: string
  scope: string
}

export const SKILL_IMPORT_ERROR = {
  invalidArchive: 'skills.importError.invalidArchive',
  invalidArchivePath: 'skills.importError.invalidArchivePath',
  zipRequired: 'skills.importError.zipRequired',
  missingSkillFile: 'skills.importError.missingSkillFile',
  multipleSkillFiles: 'skills.importError.multipleSkillFiles',
  invalidFilePath: 'skills.importError.invalidFilePath',
  duplicateSkill: 'skills.importError.duplicateSkill',
  invalidSkillId: 'skills.importError.invalidSkillId',
  invalidSkillPackage: 'skills.importError.invalidSkillPackage',
  symbolicLinksNotSupported: 'skills.importError.symbolicLinksNotSupported',
  unsupportedFileType: 'skills.importError.unsupportedFileType',
  extractFailed: 'skills.importError.extractFailed',
  selectArchiveFailed: 'skills.importError.selectArchiveFailed',
  unknown: 'skills.importError.unknown'
} as const

export type SkillImportErrorCode = typeof SKILL_IMPORT_ERROR[keyof typeof SKILL_IMPORT_ERROR]

export interface SkillInstallReviewArgs {
  id: string
  scope: string
  marketplaceQuery?: SkillMarketplaceQuery
}

export type SkillReviewSeverity = 'low' | 'medium' | 'high'

export interface SkillReviewFinding {
  id: string
  severity: SkillReviewSeverity
  title: string
  detail: string
  filePath?: string
}

export interface SkillInstallReview {
  requestId: string
  skillId: string
  skillName: string
  scope: string
  marketplace?: string
  version?: string
  author?: string
  recommendation: 'allow' | 'caution' | 'block'
  summary: string
  report: string
  findings: SkillReviewFinding[]
  downloadedFiles: number
  downloadedBytes: number
  usedSkillVetter: boolean
  versionDiff?: {
    fromVersion?: string
    toVersion?: string
    fromHash?: string
    toHash?: string
  }
}

export interface SkillsRegistryManifestEntry {
  type: SkillsRegistrySourceType
  url: string
  name?: string
  enabled?: boolean
}

export type SkillsRegistryEntry = string | SkillsRegistryManifestEntry

export interface SkillMarketplacePreset {
  id: string
  type: SkillsRegistrySourceType
  name: string
  url: string
  homepage?: string
}

export type SkillMarketplaceQuery =
  | {
    kind: 'curated'
  }
  | {
    kind: 'registry'
    url: string
  }

export const DEFAULT_SKILL_MARKETPLACE_PRESETS: SkillMarketplacePreset[] = [
  {
    id: 'n-skills',
    type: 'claude_marketplace',
    name: 'n-skills',
    url: 'https://raw.githubusercontent.com/numman-ali/n-skills/main/.claude-plugin/marketplace.json',
    homepage: 'https://github.com/numman-ali/n-skills'
  },
  {
    id: 'claude-skills',
    type: 'claude_marketplace',
    name: 'claude-code-skills',
    url: 'https://raw.githubusercontent.com/alirezarezvani/claude-skills/main/.claude-plugin/marketplace.json',
    homepage: 'https://github.com/alirezarezvani/claude-skills'
  }
]

export interface PluginToolManifest {
  name: string
  description: string
  requiredPermissions?: PluginPermissionRequirement
}

export interface PluginPermissionRequirement {
  fileSystem?: {
    read?: boolean
    write?: boolean
    paths?: string[]
  }
  network?: {
    enabled?: boolean
    domains?: string[]
  }
  shell?: {
    enabled?: boolean
    commands?: string[]
  }
}

export interface PluginCapabilityDeclaration {
  id: string
  label: string
  description?: string
  riskLevel: RiskLevel
  requiredPermissions?: PluginPermissionRequirement
}

export interface PluginManifest {
  id: string
  name: string
  description: string
  version: string
  author: string
  icon?: string
  engineVersion?: string
  homepage?: string
  license?: string
  checksum?: string
  signature?: string
  entry?: string
  tools: PluginToolManifest[]
  capabilities: PluginCapabilityDeclaration[]
  riskLevel: RiskLevel
}

export interface PluginRegistryEntry extends PluginManifest {
  installedAt: number
  filePath: string
  scope: string
  codeHash?: string
  source?: {
    type: 'builtin-store' | 'local' | 'registry'
    id?: string
    url?: string
  }
  enabled?: boolean
  previousVersion?: PluginRollbackSnapshot
}

export interface PluginRollbackSnapshot {
  version: string
  filePath: string
  codeHash?: string
  backedUpAt: number
  manifest?: PluginManifest
}

export interface PluginStoreHttpSource {
  type: 'http'
  codeUrl: string
}

export interface PluginStoreInlineSource {
  type: 'inline'
  code: string
}

export type PluginStoreSource = PluginStoreHttpSource | PluginStoreInlineSource

export interface PluginStoreEntry extends PluginManifest {
  marketplace?: string
  registryUrl?: string
  installedScopes: string[]
  source: PluginStoreSource
}

export interface PluginInstallReviewArgs {
  id: string
  scope: string
  registryUrl?: string
}

export interface PluginImportReviewArgs {
  sourceFile: string
  scope: string
}

export interface PluginInstallArgs {
  requestId: string
}

export interface PluginUpdateReviewArgs {
  id: string
  scope: string
  registryUrl?: string
}

export interface PluginRollbackArgs {
  id: string
  scope: string
}

export interface PluginVersionDiff {
  fromVersion?: string
  toVersion: string
  fromHash?: string
  toHash: string
  toolChanges: {
    added: string[]
    removed: string[]
    unchanged: string[]
  }
  capabilityChanges: {
    added: string[]
    removed: string[]
    unchanged: string[]
  }
}

export interface PluginInstallReview {
  requestId: string
  pluginId: string
  pluginName: string
  scope: string
  version: string
  author: string
  marketplace?: string
  recommendation: 'allow' | 'caution' | 'block'
  summary: string
  findings: SkillReviewFinding[]
  downloadedBytes: number
  codeHash: string
  versionDiff?: PluginVersionDiff
  operation: 'install' | 'update' | 'import'
}

export type WebSearchProviderId = 'searxng' | 'tavily' | 'bing' | 'duckduckgo' | 'baidu'

export interface WebSearchProviderToggleConfig {
  enabled: boolean
}

export interface WebSearchSearxngConfig extends WebSearchProviderToggleConfig {
  baseUrl: string
}

export interface WebSearchTavilyConfig extends WebSearchProviderToggleConfig {
  baseUrl: string
  apiKey: string
  apiKeyEncrypted?: string
  apiKeyStored?: boolean
}

export interface WebSearchConfig {
  timeoutMs: number
  preferredProviders: WebSearchProviderId[]
  providers: {
    searxng: WebSearchSearxngConfig
    tavily: WebSearchTavilyConfig
    bing: WebSearchProviderToggleConfig
    duckduckgo: WebSearchProviderToggleConfig
    baidu: WebSearchProviderToggleConfig
  }
}

export type AppearanceTheme = 'system' | 'light' | 'dark' | 'slate' | 'warm'

export interface AppearanceConfig {
  theme: AppearanceTheme
  clipboardSuggestions?: boolean
}

export interface KairoPilotConfig {
  workbench?: WorkbenchConfig
  version: string
  models: {
    providers: Record<string, ProviderConfig>
  }
  plugins: {
    registry: PluginRegistryEntry[]
  }
  skills: {
    registry: SkillsRegistryEntry[]
  }
  appearance: AppearanceConfig
  webSearch: WebSearchConfig
}

export const DEFAULT_SHELL_COMMANDS = [
  'ls',
  'pwd',
  'mkdir',
  'touch',
  'cat',
  'grep',
  'echo',
  'npm',
  'node',
  'git',
  'python',
  'python3'
] as const

export const PRIVILEGED_SHELL_COMMANDS = [
  'rm',
  'open',
  'curl'
] as const

export function createDefaultPolicyConfig(executionProfile: ExecutionProfile = 'chat_only'): AgentPermissionConfig['policy'] {
  if (executionProfile === 'trusted_automation') {
    return {
      approvalMode: 'never',
      environmentScope: 'allowed_paths',
      dataClass: 'project',
      redactSensitiveOutput: true
    }
  }

  if (executionProfile === 'approved_execution') {
    return {
      approvalMode: 'on_external',
      environmentScope: 'allowed_paths',
      dataClass: 'project',
      redactSensitiveOutput: true
    }
  }

  return {
    approvalMode: 'always',
    environmentScope: 'workspace',
    dataClass: 'project',
    redactSensitiveOutput: true
  }
}

export function createDefaultAgentPermissions(): AgentPermissionConfig {
  return {
    executionProfile: 'chat_only',
    policy: createDefaultPolicyConfig('chat_only'),
    fileSystem: {
      read: false,
      write: false,
      allowedPaths: []
    },
    network: {
      enabled: false,
      allowedDomains: []
    },
    shell: {
      enabled: false,
      allowedCommands: []
    }
  }
}



export interface TaskTemplate {
  id:string
  version:number
  name:string
  instructions:string
  output:string
  acceptance:string
  builtin:boolean
}
export type TaskPlanStatus='planning'|'pending'|'rejected'|'superseded'|'executing'|'completed'|'failed';
export interface TaskPlan {
 investigations?:PlanningInvestigation[]
 memorySnapshot?:ProjectMemorySnapshot
 id:string
 sessionId:string
 revision:number
 status:TaskPlanStatus
 goal:string
 body:string
 model:string
 referenceIds:string[]
 attachmentIds:string[]
 fingerprint:string
 scope?:{directory:string;profile:ExecutionProfile}
 approvedRevision?:number
 planningRunId?:string
 executionRunId?:string
 error?:string
 createdAt:number
 updatedAt:number
}

export interface PlanningInvestigation {tool:string;args:Record<string,unknown>;digest:string}


export interface ProjectMemorySnapshot {
  projectId: string
  entries: Array<{id: string; revision: number; content: string}>
}
export interface ProjectMemoryEntry {
  id: string
  projectId: string
  key: string
  content: string
  status: 'active' | 'conflict' | 'forgotten' | 'superseded'
  forgottenStatus?: 'active' | 'conflict'
  revision: number
  sourceSessionId: string
  sourceRunId: string
  quote: string
  updatedAt: number
}
export interface ProjectMemoryState {
  enabled: boolean
  epoch: number
  entries: ProjectMemoryEntry[]
  jobs: Array<{runId: string; status: 'queued'|'running'|'completed'|'failed'|'cancelled'|'skipped'; revision:number;attempt:number; reason?: 'capacity'|'budget'; error?: string}>
}
export interface IntelligenceBudget {maxTokens:number;maxRetries:number}
export interface IntelligenceUsage {charged:number;reported:number;reserved:number;unknownRequests:number}
export interface IntelligenceBudgetState extends IntelligenceUsage {limit:number;remaining:number}
export interface DelegationTraceEntry {id:string;time:number;attempt:number;kind:'model'|'tool';name:string;status:'running'|'completed'|'failed';input?:string;output?:string}
export interface DelegatedTask {
  id: string
  sessionId: string
  parentRunId: string
  goal: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  result: string
  error?: string
  model: string
  revision: number
  createdAt: number
  updatedAt: number
  attempt?: number
  usage?: IntelligenceUsage
  parentBudget?: IntelligenceBudgetState
  trace?: DelegationTraceEntry[]
}

export interface ConversationActivity {
  action: 'files' | 'search' | 'read' | 'write' | 'command' | 'tool';
  target: string;
  icon: 'search' | 'read' | 'terminal' | 'tool';
}
export type ConversationRun = Pick<RunSummary, 'id' | 'status' | 'createdAt' | 'startedAt' | 'updatedAt' | 'completedAt' | 'error'>;
export interface ConversationItem {
  id: string;
  runId: string;
  sequence: number;
  activity?: ConversationActivity;
  kind: 'user' | 'commentary' | 'draft' | 'tool' | 'final';
  content: string;
  status: string;
  attachments?: ChatAttachment[];
  references?: ContextReference[];
}
export interface ConversationRound { run: ConversationRun; items: ConversationItem[] }
export interface ConversationPage { rounds: ConversationRound[]; before?: number }
