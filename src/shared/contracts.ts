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

export interface SkillsRegistryEntry {
  [key: string]: unknown
}

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
