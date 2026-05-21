import type { ChatAttachment } from '../shared/contracts';

export type {
  AgentConfig,
  AgentStats,
  AgentPermissionConfig,
  AppearanceConfig,
  AppearanceTheme,
  ApprovalRecord,
  AuditLogEntry,
  AuditLogQuery,
  AuditLogQueryResult,
  ContextAssemblyBudget,
  KairoPilotConfig,
  LegacyAgentConfig,
  ModelConfig,
  MonitoringTokenQuery,
  MonitoringTokenQueryResult,
  ProviderCapabilitySnapshot,
  ProviderConfig,
  ProviderType,
  RunContextSummary,
  RunQuery,
  RunQueryResult,
  RunQueryStatus,
  RuntimeUpdateEvent,
  RunStep,
  RunTraceAggregations,
  RunTraceQuery,
  RunTrace,
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

export interface Session {
  id: string;
  title: string;
  agentId?: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface SessionSummary {
  id: string;
  title: string;
  agentId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ConfirmationRequest {
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
  latestContextSummary: import('../shared/contracts').RunContextSummary | null;
  latestRun: import('../shared/contracts').RunSummary | null;
  activeRunSteps: import('../shared/contracts').RunStep[];
}

export type SessionContextUpdate =
  | Partial<SessionContextState>
  | ((current: SessionContextState) => Partial<SessionContextState> | SessionContextState);
