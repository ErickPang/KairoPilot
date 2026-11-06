import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatStoreMocks = vi.hoisted(() => ({
  getApprovalRecord: vi.fn(),
  getLatestRun: vi.fn(),
  getLatestSessionContextSummary: vi.fn(),
  getPendingApproval: vi.fn(),
  getRunById: vi.fn(),
  getSessionById: vi.fn(),
}));



vi.mock('../store/chat', () => ({ ...chatStoreMocks, RESTART_INTERRUPTED_ERROR: 'RUN_INTERRUPTED_BY_RESTART: fixture' }));
vi.mock('../store/taskPages', () => ({ getOwnedSessionSummary: (_agent: string, id: string) => chatStoreMocks.getSessionById(id), getActiveSessionSummary: vi.fn() }));

import {
  getPendingApprovalForActiveAgentSession,
} from './chatRunService';

describe('chatRunService', () => {
  beforeEach(() => {
    for (const mock of [
      ...Object.values(chatStoreMocks)
    ]) {
      mock.mockReset();
    }

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
