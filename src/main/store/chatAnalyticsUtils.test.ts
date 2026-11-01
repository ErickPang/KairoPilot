import { describe, expect, it } from 'vitest';
import { buildAgentStats, mapMonitoringRows } from './chatAnalyticsUtils';

describe('chatAnalyticsUtils', () => {
  it('聚合 agent stats 时会忽略不可见消息并统计运行状态', () => {
    const stats = buildAgentStats({
      defaultAgentId: 'mainAgent',
      sessions: [
        { id: 's1', agent_id: 'agent-a' },
        { id: 's2', agent_id: null }
      ],
      messages: [
        {
          session_id: 's1',
          role: 'assistant',
          content: 'done',
          usage: JSON.stringify({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }),
          tool_calls: null
        },
        {
          session_id: 's1',
          role: 'assistant',
          content: '',
          usage: JSON.stringify({ prompt_tokens: 9, completion_tokens: 9, total_tokens: 18 }),
          tool_calls: null
        },
        {
          session_id: 's2',
          role: 'user',
          content: 'hello',
          usage: null,
          tool_calls: null
        }
      ],
      runs: [
        { id: 'r1', agent_id: 'agent-a', status: 'completed' as const },
        { id: 'r2', agent_id: null, status: 'waiting_approval' as const }
      ],
      approvals: [
        { run_id: 'r1', status: 'approved' as const },
        { run_id: 'missing', status: 'pending' as const }
      ],
      toolCalls: [
        { run_id: 'r1', status: 'success' as const },
        { run_id: 'r2', status: 'failed' as const }
      ]
    });

    expect(stats).toEqual([
      {
        agentId: 'agent-a',
        totalSessions: 1,
        totalMessages: 1,
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        totalRuns: 1,
        completedRuns: 1,
        failedRuns: 0,
        cancelledRuns: 0,
        waitingApprovalRuns: 0,
        approvalRequests: 1,
        approvalApproved: 1,
        toolCalls: 1,
        successfulToolCalls: 1
      },
      {
        agentId: 'mainAgent',
        totalSessions: 1,
        totalMessages: 1,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        totalRuns: 1,
        completedRuns: 0,
        failedRuns: 0,
        cancelledRuns: 0,
        waitingApprovalRuns: 1,
        approvalRequests: 0,
        approvalApproved: 0,
        toolCalls: 1,
        successfulToolCalls: 0
      }
    ]);
  });

  it('映射 monitoring rows 时会补默认模型并过滤不可见消息', () => {
    const items = mapMonitoringRows([
      {
        id: 'm1',
        session_id: 's1',
        session_title: 'Session 1',
        agent_id: 'agent-a',
        role: 'assistant',
        content: 'answer',
        timestamp: 1,
        usage: JSON.stringify({ prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 }),
        tool_calls: null,
        model: null
      },
      {
        id: 'm2',
        session_id: 's1',
        session_title: 'Session 1',
        agent_id: 'agent-a',
        role: 'assistant',
        content: 'tool calling',
        timestamp: 2,
        usage: JSON.stringify({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }),
        tool_calls: '[{"id":"call_1"}]',
        model: 'hidden'
      }
    ], (agentId) => agentId === 'agent-a' ? 'fallback-model' : undefined);

    expect(items).toEqual([
      {
        id: 'm1',
        sessionId: 's1',
        sessionTitle: 'Session 1',
        agentId: 'agent-a',
        role: 'assistant',
        content: 'answer',
        timestamp: 1,
        model: 'fallback-model',
        promptTokens: 4,
        completionTokens: 6,
        totalTokens: 10
      }
    ]);
  });
});
