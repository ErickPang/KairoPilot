export type { WorkbenchConfig,WorkbenchSettingsInput,TaskExecutionSettings } from '../shared/contracts';
import type { SessionProjectContext } from '../shared/contracts';
import type { ChatAttachment } from '../shared/contracts';

export type {
  AgentConfig,
  AgentStats,
  OllamaModelInfo,
  OllamaListModelsResult,
  AgentPermissionConfig,
  AppearanceConfig,
  AppearanceTheme,
  ApprovalRecord,
  AuditLogEntry,
  AuditLogQuery,
  AuditLogQueryResult,
  ContextAssemblyBudget,
  KairoPilotConfig,
  ModelConfig,
  MonitoringTokenQuery,
  MonitoringTokenQueryResult,
  PluginCapabilityDeclaration,
  PluginInstallReview,
  PluginManifest,
  PluginRegistryEntry,
  PluginStoreEntry,
  PluginToolManifest,
  ProviderCapabilitySnapshot,
  ProviderConfig,
  ProviderType,
  RunContextSummary,
  RiskLevel,
  RuntimeUpdateEvent,
  RunStep,
  RunSummary,
  SkillSummary,
  ToolCallRecord,
  WebSearchConfig
} from '../shared/contracts';

export type { ChatAttachment } from '../shared/contracts';

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'thinking';
  content?: string;
  attachments?: ChatAttachment[];
  references?: import('../shared/contracts').ContextReference[];
  skillMentions?: import('../shared/contracts').SkillMention[];
  details?: Record<string, unknown>;
  tool_calls?: Record<string, unknown>[];
  tool_call_id?: string;
  name?: string;
}

export interface FetchModelsResult {
  success: boolean;
  models: string[];
  error?: string;
}

export interface SystemStats {
  platform: string;
  arch: string;
  cpuModel: string;
  cpuUsage: number;
  memoryUsage: number;
  totalMemory: string;
  uptime: number;
}

export interface Session extends SessionProjectContext {
  id: string;
  title: string;
  agentId?: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export type SessionSummary = import('../shared/contracts').SessionSummary;

export interface ConfirmationRequest {
  sessionApproval?: import('../shared/contracts').SessionApprovalScope;
  id: string;
  tool: string;
  args: Record<string, unknown>;
  sessionId?: string;
  runId?: string;
  riskLevel?: string;
  approvalMode?: string;
  policyTags?: string[];
  redacted?: boolean;
}

export interface AppNotice {
  kind: 'error' | 'info' | 'success';
  message: string;
  source?: string;
}

export interface AppConfirmationOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
}

export interface SessionContextState {
  activeAgentId: string | null;
  activeSessionId: string | null;
  appNotice: AppNotice | null;
  confirmationRequest: ConfirmationRequest | null;
  latestRun: import('../shared/contracts').RunSummary | null;
}

export type SessionContextUpdate =
  | Partial<SessionContextState>
  | ((current: SessionContextState) => Partial<SessionContextState> | SessionContextState);
