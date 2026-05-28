import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatStoreMocks = vi.hoisted(() => ({
  getApprovalRecord: vi.fn(),
  getLatestRun: vi.fn(),
  getLatestRunSteps: vi.fn(),
  getLatestSessionContextSummary: vi.fn(),
  getPendingApproval: vi.fn(),
  getRunById: vi.fn(),
  getRunTrace: vi.fn(),
  getSessionById: vi.fn(),
  queryRuns: vi.fn()
}));

const configStoreMocks = vi.hoisted(() => ({
  getActiveAgentId: vi.fn()
}));

vi.mock('../store/chat', () => chatStoreMocks);
vi.mock('../store/config', () => configStoreMocks);

import {
  getPendingApprovalForActiveAgentSession,
  getRunTraceForActiveAgent,
  queryRunsForActiveAgent
} from './chatRunService';

describe('chatRunService', () => {
  beforeEach(() => {
    for (const mock of [
      ...Object.values(chatStoreMocks),
      ...Object.values(configStoreMocks)
    ]) {
      mock.mockReset();
    }

    configStoreMocks.getActiveAgentId.mockReturnValue('agent-1');
  });

  it('scopes run queries to the active agent', () => {
    chatStoreMocks.queryRuns.mockReturnValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1,
      aggregations: {}
    });

    queryRunsForActiveAgent({
      page: 2,
      status: 'completed'
    });

    expect(chatStoreMocks.queryRuns).toHaveBeenCalledWith({
      page: 2,
      status: 'completed',
      agentId: 'agent-1'
    });
  });

  it('blocks run trace access outside the active agent', () => {
    chatStoreMocks.getRunById.mockReturnValue({
      id: 'run-1',
      sessionId: 'session-2',
      agentId: 'agent-2'
    });
    chatStoreMocks.getSessionById.mockReturnValue({
      id: 'session-2',
      title: 'Other',
      agentId: 'agent-2',
      messages: [],
      createdAt: 1,
      updatedAt: 1
    });

    expect(getRunTraceForActiveAgent({ runId: 'run-1' })).toBeNull();
    expect(chatStoreMocks.getRunTrace).not.toHaveBeenCalled();
  });

  it('loads global pending approval through the approval record', () => {
    chatStoreMocks.getPendingApproval.mockReturnValue({
      id: 'approval-1'
    });
    chatStoreMocks.getApprovalRecord.mockReturnValue({
      id: 'approval-1',
      runId: 'run-1',
      toolName: 'read_file',
      args: {},
      status: 'pending',
      createdAt: 1,
      updatedAt: 1
    });

    expect(getPendingApprovalForActiveAgentSession()).toEqual({
      id: 'approval-1',
      runId: 'run-1',
      toolName: 'read_file',
      args: {},
      status: 'pending',
      createdAt: 1,
      updatedAt: 1
    });
    expect(chatStoreMocks.getApprovalRecord).toHaveBeenCalledWith('approval-1');
  });
});
