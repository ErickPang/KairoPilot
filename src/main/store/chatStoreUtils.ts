import type { ChatMessage } from '../core/llm/types';
import type {
  ApprovalRecord,
  MonitoringTokenQuery,
  RunContextSummary,
  RunQuery,
  RunStatus,
  RunStep,
  RunStepStatus,
  RunStepType,
  RunSummary,
  TokenMetricFacet,
  ToolCallRecord
} from '../../shared/contracts';

export function parseJsonValue<T>(value: string | null | undefined): T | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export function serializeComparableMessage(message: ChatMessage): string {
  return JSON.stringify({
    role: message.role,
    content: message.content || '',
    timestamp: message.timestamp || 0,
    name: message.name || null,
    tool_call_id: message.tool_call_id || null,
    tool_calls: message.tool_calls || null,
    usage: message.usage || null,
    model: message.model || null
  });
}

export function getSharedMessagePrefixLength(existingMessages: ChatMessage[], nextMessages: ChatMessage[]) {
  const maxComparableLength = Math.min(existingMessages.length, nextMessages.length);
  let prefixLength = 0;

  while (prefixLength < maxComparableLength) {
    if (serializeComparableMessage(existingMessages[prefixLength]) !== serializeComparableMessage(nextMessages[prefixLength])) {
      break;
    }
    prefixLength += 1;
  }

  return prefixLength;
}

export function mapSessionRowToSummary(session: {
  id: string;
  title: string;
  agent_id: string;
  created_at: number;
  updated_at: number;
}) {
  return {
    id: session.id,
    title: session.title,
    agentId: session.agent_id,
    createdAt: session.created_at,
    updatedAt: session.updated_at
  };
}

export function mapRunRowToSummary(run: {
  id: string;
  session_id: string;
  agent_id: string;
  goal: string;
  user_input: string;
  status: RunStatus;
  final_response: string | null;
  error: string | null;
  waiting_approval_id: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
}): RunSummary {
  return {
    id: run.id,
    sessionId: run.session_id,
    agentId: run.agent_id,
    goal: run.goal,
    userInput: run.user_input,
    status: run.status,
    finalResponse: run.final_response || undefined,
    error: run.error || undefined,
    waitingApprovalId: run.waiting_approval_id || undefined,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    startedAt: run.started_at || undefined,
    completedAt: run.completed_at || undefined
  };
}

export function mapRunStepRow(step: {
  id: string;
  run_id: string;
  step_index: number;
  type: RunStepType;
  status: RunStepStatus;
  title: string;
  input: string | null;
  output: string | null;
  error: string | null;
  metadata: string | null;
  created_at: number;
  updated_at: number;
}): RunStep {
  return {
    id: step.id,
    runId: step.run_id,
    stepIndex: step.step_index,
    type: step.type,
    status: step.status,
    title: step.title,
    input: parseJsonValue(step.input),
    output: parseJsonValue(step.output),
    error: step.error || undefined,
    metadata: parseJsonValue<Record<string, unknown>>(step.metadata),
    createdAt: step.created_at,
    updatedAt: step.updated_at
  };
}

export function mapApprovalRowToRecord(row: {
  id: string;
  run_id: string;
  step_id: string | null;
  session_id: string | null;
  tool_name: string;
  args: string;
  status: 'pending' | 'approved' | 'denied';
  metadata: string | null;
  created_at: number;
  updated_at: number;
  resolved_at: number | null;
}): ApprovalRecord {
  return {
    id: row.id,
    runId: row.run_id,
    stepId: row.step_id || undefined,
    sessionId: row.session_id || undefined,
    toolName: row.tool_name,
    args: parseJsonValue<Record<string, unknown>>(row.args) || {},
    status: row.status,
    metadata: parseJsonValue<Record<string, unknown>>(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at || undefined
  };
}

export function mapToolCallRecordRow(row: {
  id: string;
  run_id: string;
  step_id: string | null;
  tool_name: string;
  args: string | null;
  result: string | null;
  error: string | null;
  status: 'running' | 'waiting_approval' | 'success' | 'failed' | 'cancelled';
  created_at: number;
  updated_at: number;
}): ToolCallRecord {
  return {
    id: row.id,
    runId: row.run_id,
    stepId: row.step_id || undefined,
    toolName: row.tool_name,
    args: parseJsonValue(row.args),
    result: parseJsonValue(row.result),
    error: row.error || undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function mapContextSummaryRow(row: {
  id: string;
  run_id: string;
  session_id: string | null;
  step_id: string | null;
  summary: string;
  created_at: number;
}): RunContextSummary | null {
  const parsedSummary = parseJsonValue<Omit<RunContextSummary, 'id' | 'runId' | 'sessionId' | 'stepId' | 'createdAt'>>(row.summary);
  if (!parsedSummary) {
    return null;
  }

  return {
    id: row.id,
    runId: row.run_id,
    sessionId: row.session_id || undefined,
    stepId: row.step_id || undefined,
    activeTaskSummary: parsedSummary.activeTaskSummary || '',
    activeSkillsSummary: parsedSummary.activeSkillsSummary || '',
    availableSkillsSummary: parsedSummary.availableSkillsSummary || '',
    availableToolsSummary: parsedSummary.availableToolsSummary || '',
    compactedHistorySummary: parsedSummary.compactedHistorySummary || '',
    unresolvedApprovals: parsedSummary.unresolvedApprovals || '',
    selectedToolResults: parsedSummary.selectedToolResults || '',
    workspaceRetrieval: parsedSummary.workspaceRetrieval || '',
    memoryDigest: parsedSummary.memoryDigest || '',
    layers: Array.isArray(parsedSummary.layers)
      ? parsedSummary.layers.map((layer) => ({
          id: String(layer.id || ''),
          title: String(layer.title || ''),
          kind: layer.kind === 'system' || layer.kind === 'support' || layer.kind === 'history' ? layer.kind : 'support',
          messageCount: Number.isFinite(layer.messageCount) ? layer.messageCount : 0,
          charCount: Number.isFinite(layer.charCount) ? layer.charCount : 0,
          summary: String(layer.summary || '')
        }))
      : [],
    recentMessageCount: Number.isFinite(parsedSummary.recentMessageCount) ? parsedSummary.recentMessageCount : 0,
    omittedMessageCount: Number.isFinite(parsedSummary.omittedMessageCount) ? parsedSummary.omittedMessageCount : 0,
    budget: {
      maxContextChars: parsedSummary.budget?.maxContextChars || 0,
      systemPromptChars: parsedSummary.budget?.systemPromptChars || 0,
      supportChars: parsedSummary.budget?.supportChars || 0,
      recentHistoryChars: parsedSummary.budget?.recentHistoryChars || 0,
      totalChars: parsedSummary.budget?.totalChars || 0
    },
    createdAt: row.created_at
  };
}

export function buildRunQueryWhere(query: RunQuery) {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  const search = query.search?.trim().toLowerCase();
  const status = query.status ?? 'all';
  const sessionId = query.sessionId?.trim();
  const agentId = query.agentId?.trim();

  if (status !== 'all') {
    clauses.push('status = ?');
    params.push(status);
  }

  if (sessionId) {
    clauses.push('session_id = ?');
    params.push(sessionId);
  }

  if (agentId) {
    clauses.push('agent_id = ?');
    params.push(agentId);
  }

  if (search) {
    const keyword = `%${search}%`;
    clauses.push(`(
      LOWER(id) LIKE ?
      OR LOWER(goal) LIKE ?
      OR LOWER(user_input) LIKE ?
      OR LOWER(COALESCE(final_response, '')) LIKE ?
      OR LOWER(COALESCE(error, '')) LIKE ?
      OR LOWER(session_id) LIKE ?
    )`);
    params.push(keyword, keyword, keyword, keyword, keyword, keyword);
  }

  return {
    whereClause: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params
  };
}

export function buildMonitoringWhereClause(query: MonitoringTokenQuery) {
  const clauses = [
    'messages.usage IS NOT NULL',
    "(messages.tool_calls IS NULL OR messages.tool_calls = '' OR messages.tool_calls = '[]')"
  ];
  const params: Array<string | number> = [];
  const agentId = query.agentId?.trim();
  const model = query.model?.trim();
  const role = query.role?.trim();
  const sessionId = query.sessionId?.trim();
  const search = query.search?.trim().toLowerCase();
  const startTime = Number.isFinite(query.startTime) ? Number(query.startTime) : undefined;
  const endTime = Number.isFinite(query.endTime) ? Number(query.endTime) : undefined;

  if (agentId) {
    clauses.push('sessions.agent_id = ?');
    params.push(agentId);
  }

  if (model) {
    clauses.push("COALESCE(messages.model, '') = ?");
    params.push(model);
  }

  if (role && role !== 'all') {
    clauses.push('messages.role = ?');
    params.push(role);
  }

  if (sessionId) {
    clauses.push('messages.session_id = ?');
    params.push(sessionId);
  }

  if (typeof startTime === 'number') {
    clauses.push('messages.timestamp >= ?');
    params.push(startTime);
  }

  if (typeof endTime === 'number') {
    clauses.push('messages.timestamp <= ?');
    params.push(endTime);
  }

  if (search) {
    const keyword = `%${search}%`;
    clauses.push(`(
      LOWER(COALESCE(messages.content, '')) LIKE ?
      OR LOWER(COALESCE(messages.model, '')) LIKE ?
      OR LOWER(COALESCE(sessions.title, '')) LIKE ?
      OR LOWER(COALESCE(sessions.agent_id, '')) LIKE ?
    )`);
    params.push(keyword, keyword, keyword, keyword);
  }

  return {
    whereClause: `WHERE ${clauses.join(' AND ')}`,
    params,
    normalizedAgentId: agentId
  };
}

export function buildTokenMetricFacets<TItem extends {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}>(items: TItem[], keySelector: (item: TItem) => string): TokenMetricFacet[] {
  const facetMap = new Map<string, TokenMetricFacet>();

  for (const item of items) {
    const value = keySelector(item) || 'Unknown';
    const current = facetMap.get(value) ?? {
      value,
      count: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    };
    current.count += 1;
    current.promptTokens += item.promptTokens;
    current.completionTokens += item.completionTokens;
    current.totalTokens += item.totalTokens;
    facetMap.set(value, current);
  }

  return Array.from(facetMap.values()).sort((left, right) => {
    if (right.totalTokens !== left.totalTokens) {
      return right.totalTokens - left.totalTokens;
    }
    if (right.count !== left.count) {
      return right.count - left.count;
    }
    return left.value.localeCompare(right.value);
  });
}
