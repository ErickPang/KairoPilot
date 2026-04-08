export type {
  AgentConfig,
  AgentStats,
  AgentPermissionConfig,
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
  RunStep,
  RunTraceAggregations,
  RunTraceQuery,
  RunTrace,
  RunSummary,
  SkillSummary,
  ToolCallRecord
} from '../shared/contracts';

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'thinking';
  content?: string;
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

export interface SessionContextState {
  activeAgentId: string | null;
  activeSessionId: string | null;
  confirmationRequest: ConfirmationRequest | null;
  latestContextSummary: import('../shared/contracts').RunContextSummary | null;
  latestRun: import('../shared/contracts').RunSummary | null;
  activeRunSteps: import('../shared/contracts').RunStep[];
}
