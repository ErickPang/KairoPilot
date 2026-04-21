import type { ChatMessage } from '../core/llm/types';
import { isVisibleSessionMessage, parseUsage } from './chatMessageUtils';
import type {
  AgentStats,
  ApprovalRecord,
  MonitoringTokenUsageItem,
  RunStatus,
  ToolCallRecord
} from '../../shared/contracts';

export function buildAgentStats(params: {
  defaultAgentId: string;
  sessions: Array<{ id: string; agent_id: string | null }>;
  messages: Array<{
    session_id: string;
    role: ChatMessage['role'];
    content: string;
    usage: string | null;
    tool_calls: string | null;
  }>;
  runs: Array<{ id: string; agent_id: string | null; status: RunStatus }>;
  approvals: Array<{ run_id: string; status: ApprovalRecord['status'] }>;
  toolCalls: Array<{ run_id: string; status: ToolCallRecord['status'] }>;
}): AgentStats[] {
  const { defaultAgentId, sessions, messages, runs, approvals, toolCalls } = params;
  const statsMap = new Map<string, AgentStats>();
  const sessionAgentMap = new Map(sessions.map((session) => [session.id, session.agent_id || defaultAgentId]));
  const runAgentMap = new Map(runs.map((run) => [run.id, run.agent_id || defaultAgentId]));

  const ensureAgentStats = (agentId: string) => {
    const normalizedAgentId = agentId || defaultAgentId;
    if (!statsMap.has(normalizedAgentId)) {
      statsMap.set(normalizedAgentId, {
        agentId: normalizedAgentId,
        totalSessions: 0,
        totalMessages: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        totalRuns: 0,
        completedRuns: 0,
        failedRuns: 0,
        cancelledRuns: 0,
        waitingApprovalRuns: 0,
        approvalRequests: 0,
        approvalApproved: 0,
        toolCalls: 0,
        successfulToolCalls: 0
      });
    }
    return statsMap.get(normalizedAgentId)!;
  };

  for (const session of sessions) {
    ensureAgentStats(session.agent_id || defaultAgentId).totalSessions += 1;
  }

  for (const message of messages) {
    const agentId = sessionAgentMap.get(message.session_id);
    if (!agentId || !isVisibleSessionMessage(message)) {
      continue;
    }

    const stat = ensureAgentStats(agentId);
    stat.totalMessages += 1;
    const usage = parseUsage(message.usage);
    if (!usage) {
      continue;
    }

    stat.promptTokens += usage.promptTokens;
    stat.completionTokens += usage.completionTokens;
    stat.totalTokens += usage.totalTokens;
  }

  for (const run of runs) {
    const stat = ensureAgentStats(run.agent_id || defaultAgentId);
    stat.totalRuns += 1;
    if (run.status === 'completed') {
      stat.completedRuns += 1;
    } else if (run.status === 'failed') {
      stat.failedRuns += 1;
    } else if (run.status === 'cancelled') {
      stat.cancelledRuns += 1;
    } else if (run.status === 'waiting_approval') {
      stat.waitingApprovalRuns += 1;
    }
  }

  for (const approval of approvals) {
    const agentId = runAgentMap.get(approval.run_id);
    if (!agentId) {
      continue;
    }

    const stat = ensureAgentStats(agentId);
    stat.approvalRequests += 1;
    if (approval.status === 'approved') {
      stat.approvalApproved += 1;
    }
  }

  for (const toolCall of toolCalls) {
    const agentId = runAgentMap.get(toolCall.run_id);
    if (!agentId) {
      continue;
    }

    const stat = ensureAgentStats(agentId);
    stat.toolCalls += 1;
    if (toolCall.status === 'success') {
      stat.successfulToolCalls += 1;
    }
  }

  return Array.from(statsMap.values());
}

export function mapMonitoringRows(
  rows: Array<{
    id: string;
    session_id: string;
    session_title: string;
    agent_id: string | null;
    role: ChatMessage['role'];
    content: string;
    timestamp: number;
    usage: string;
    tool_calls: string | null;
    model: string | null;
  }>,
  resolveAgentModel: (agentId: string) => string | undefined
): MonitoringTokenUsageItem[] {
  return rows.flatMap((row) => {
    if (!isVisibleSessionMessage(row)) {
      return [];
    }

    const usage = parseUsage(row.usage);
    if (!usage) {
      return [];
    }

    const agentId = row.agent_id || 'mainAgent';
    const fallbackModel = resolveAgentModel(agentId) || '';
    return [{
      id: row.id,
      sessionId: row.session_id,
      sessionTitle: row.session_title,
      agentId,
      role: row.role,
      content: row.content,
      timestamp: row.timestamp,
      model: row.model || fallbackModel || 'Unknown',
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens
    }];
  });
}
