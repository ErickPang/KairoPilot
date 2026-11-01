import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatStoreMocks = vi.hoisted(() => ({
  getApprovalRecord: vi.fn(),
  getLatestRun: vi.fn(),
  getLatestRunSteps: vi.fn(),
  getRetryableRunStepIds: vi.fn(),
  getLatestSessionContextSummary: vi.fn(),
  getPendingApproval: vi.fn(),
  getRunById: vi.fn(),
  getRunTrace: vi.fn(),
  getSessionById: vi.fn(),
  queryRuns: vi.fn()
}));



vi.mock('../store/chat', () => ({ ...chatStoreMocks, RESTART_INTERRUPTED_ERROR: 'RUN_INTERRUPTED_BY_RESTART: fixture' }));
vi.mock('../store/taskPages', () => ({ getOwnedSessionSummary: (_agent: string, id: string) => chatStoreMocks.getSessionById(id), getActiveSessionSummary: vi.fn() }));

import {
  getPendingApprovalForActiveAgentSession,
  getRunStepsForActiveAgentSession,
  getRunTraceForActiveAgent,
  queryRunsForActiveAgent
} from './chatRunService';

describe('chatRunService', () => {
  beforeEach(() => {
    for (const mock of [
      ...Object.values(chatStoreMocks)
    ]) {
      mock.mockReset();
    }

  });

  it('redacts displayed activity and exposes retry only for recorded checkpoints', () => {
    chatStoreMocks.getSessionById.mockReturnValue({ id: 'session-1', agentId: 'agent-1' });
    chatStoreMocks.getLatestRun.mockReturnValue({ id: 'run-1', status: 'failed', executionContext: { executionRoot: '/synthetic' } });
    chatStoreMocks.getRetryableRunStepIds.mockReturnValue(['step-with-snapshot']);
    chatStoreMocks.getLatestRunSteps.mockReturnValue([
      { id: 'step-with-snapshot', input: { apiKey: 'sample-private-value' }, output: 'token=sample-private-value', status: 'failed' },
      { id: 'step-without-snapshot', input: undefined, output: undefined, status: 'failed' }
    ]);
    const result = getRunStepsForActiveAgentSession('session-1');
    expect(result[0]).toMatchObject({ input: { apiKey: '[REDACTED]' }, output: 'token=[REDACTED]', metadata: { retryable: true } });
    expect(result[1].metadata.retryable).toBe(false);
  });

  it('queries workbench runs across historical sources', () => {
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
      agentId: undefined
    });
  });

  it('loads historical run traces by task ownership', () => {
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

    getRunTraceForActiveAgent({runId:'run-1'});
    expect(chatStoreMocks.getRunTrace).toHaveBeenCalledWith({runId:'run-1'});
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
