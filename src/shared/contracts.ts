export type ProviderType = 'openai' | 'ollama' | 'anthropic' | 'deepseek' | 'zhipu' | 'kimi' | 'qianwen' | 'custom'

export interface ModelOption {
  id: string
  name: string
}

export interface ProviderConfig {
  provider: ProviderType
  baseUrl: string
  apiKey: string
  model: ModelOption[]
}

export interface ModelConfig {
  id: string
  name: string
  provider: ProviderType
  baseUrl: string
  apiKey: string
  model: string
  availableModels?: ModelOption[]
}

export interface AgentPermissionConfig {
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

export interface AgentConfig {
  id: string
  name: string
  workspace: string
  workspaceName?: string
  systemPrompt: string
  identityPrompt: string
  userPrompt: string
  soulPrompt: string
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
}

export interface AuditLogEntry {
  id: string
  timestamp: number
  tool: string
  args: Record<string, unknown>
  result?: unknown
  error?: string
  sessionId?: string
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

export type SkillScope = 'public' | 'agent'

export interface SkillMetadata {
  name: string
  description: string
  metadata: {
    version?: string
    allowedTools: string[]
  }
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
  content: string
  source: SkillScope
  skillDir: string
  skillFilePath: string
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

export interface PluginRegistryEntry {
  id: string
  name: string
  description: string
  version: string
  author: string
  icon?: string
  installedAt: number
  filePath: string
  scope: string
}

export interface KairoPilotConfig {
  version: string
  models: {
    providers: Record<string, ProviderConfig>
  }
  agents: {
    activeAgentId: string
    list: AgentConfig[]
  }
  plugins: {
    registry: PluginRegistryEntry[]
  }
  skills: {
    registry: SkillsRegistryEntry[]
  }
}

export interface LegacyAgentConfig {
  provider: ProviderType
  apiKey: string
  baseUrl: string
  model: string
  workspace: string
  systemPrompt: string
  enableShell: boolean
  enableNetwork?: boolean
  enableFileSystemRead?: boolean
  enableFileSystemWrite?: boolean
  allowedPaths?: string[]
  allowedDomains?: string[]
  allowedCommands?: string[]
  permissions?: AgentPermissionConfig
}

export const DEFAULT_SHELL_COMMANDS = [
  'ls',
  'cd',
  'pwd',
  'mkdir',
  'rm',
  'touch',
  'cat',
  'grep',
  'echo',
  'npm',
  'node',
  'git',
  'python',
  'python3',
  'open',
  'curl'
] as const

export function createDefaultAgentPermissions(): AgentPermissionConfig {
  return {
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
