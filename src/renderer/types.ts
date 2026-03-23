export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'thinking';
  content?: string;
  details?: Record<string, unknown>;
  tool_calls?: Record<string, unknown>[];
  tool_call_id?: string;
  name?: string;
}

export interface LegacyAgentConfig {
  provider: 'openai' | 'ollama' | 'anthropic' | 'deepseek' | 'zhipu' | 'kimi' | 'qianwen' | 'custom';
  apiKey: string;
  baseUrl: string;
  model: string;
  workspace: string;
  systemPrompt: string;
  enableShell: boolean;
  allowedPaths: string[];
  allowedCommands: string[];
}

export interface ModelConfig {
  id: string;
  name: string;
  provider: '' | 'openai' | 'ollama' | 'anthropic' | 'deepseek' | 'zhipu' | 'kimi' | 'qianwen' | 'custom';
  baseUrl: string;
  apiKey: string;
  model: string;
  availableModels?: Array<{ id: string; name: string }>;
}

export interface FetchModelsResult {
  success: boolean;
  models: string[];
  error?: string;
}

export interface ProviderConfig {
  provider: 'openai' | 'ollama' | 'anthropic' | 'deepseek' | 'zhipu' | 'kimi' | 'qianwen' | 'custom';
  baseUrl: string;
  apiKey: string;
  model: Array<{ id: string; name: string }>;
}

export interface AgentConfig {
  id: string;
  name: string;
  workspace: string;
  workspaceName?: string;
  systemPrompt: string;
  model: string;
  allowedPaths: string[];
  allowedCommands: string[];
  enableShell: boolean;
}

export interface KairoPilotConfig {
  version: string;
  models: {
    providers: Record<string, ProviderConfig>;
  };
  agents: {
    activeAgentId: string;
    list: AgentConfig[];
  };
  plugins: {
    registry: unknown[];
  };
  skills: {
    registry: unknown[];
  };
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
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  sessionId?: string;
  policyTags?: string[];
}
