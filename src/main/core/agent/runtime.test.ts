import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({
  createRun: vi.fn(),
  createRunStep: vi.fn(),
  getApprovalRecord: vi.fn(),
  getLatestContextSnapshot: vi.fn(),
  getLatestContextSnapshotByStep: vi.fn(),
  getRecentSessionContextSummaries: vi.fn(),
  getPendingApproval: vi.fn(),
  getRunById: vi.fn(),
  getRunSteps: vi.fn(),
  resolveApprovalRecord: vi.fn(),
  saveContextSnapshot: vi.fn(),
  saveRunContextSummary: vi.fn(),
  updateRun: vi.fn(),
  updateRunStep: vi.fn(),
  updateToolCallRecord: vi.fn()
}));

vi.mock('../../store/chat', () => ({
  getDb:()=>({transaction:(operation:()=>unknown)=>operation}),
  createRun: runtimeMocks.createRun,
  createRunStep: runtimeMocks.createRunStep,
  getApprovalRecord: runtimeMocks.getApprovalRecord,
  getLatestContextSnapshot: runtimeMocks.getLatestContextSnapshot,
  getLatestContextSnapshotByStep: runtimeMocks.getLatestContextSnapshotByStep,
  getRecentSessionContextSummaries: runtimeMocks.getRecentSessionContextSummaries,
  getPendingApproval: runtimeMocks.getPendingApproval,
  getRunById: runtimeMocks.getRunById,
  getRunSteps: runtimeMocks.getRunSteps,
  resolveApprovalRecord: runtimeMocks.resolveApprovalRecord,
  saveContextSnapshot: runtimeMocks.saveContextSnapshot,
  saveRunContextSummary: runtimeMocks.saveRunContextSummary,
  updateRun: runtimeMocks.updateRun,
  updateRunStep: runtimeMocks.updateRunStep,
  updateToolCallRecord: runtimeMocks.updateToolCallRecord
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => `/tmp/kairopilot-test/${name}`),
    getAppPath: vi.fn(() => '/tmp/kairopilot-test/app'),
    isPackaged: false
  }
}));

import { AgentRuntime } from './runtime';

describe('AgentRuntime', () => {
  beforeEach(() => {
    for (const mock of Object.values(runtimeMocks)) {
      mock.mockReset();
    }

    runtimeMocks.createRunStep.mockReturnValue({ id: 'summary-step' });
  });

  it('暂停态取消会立即将 run 标记为 cancelled', async () => {
    runtimeMocks.getRunById.mockReturnValue({
      id: 'run-1',
      sessionId: 'session-1',
      agentId: 'agent-1',
      userInput: 'do work',
      status: 'paused'
    });

    const runtime = new AgentRuntime({} as never, {} as never, '/tmp/workspace');
    await runtime.cancelRun('run-1');

    expect(runtimeMocks.createRunStep).toHaveBeenCalledWith('run-1', 'summary', '运行已取消', {
      status: 'cancelled',
      output: {
        reason: 'cancel_requested'
      }
    });
    expect(runtimeMocks.updateRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
      status: 'cancelled',
      error: 'Run cancelled by user.',
      waitingApprovalId: null,
      completedAt: expect.any(Number)
    }));
  });

  it('已结束 run 不再接受取消请求', async () => {
    runtimeMocks.getRunById.mockReturnValue({
      id: 'run-2',
      sessionId: 'session-2',
      agentId: 'agent-1',
      userInput: 'done',
      status: 'completed'
    });

    const runtime = new AgentRuntime({} as never, {} as never, '/tmp/workspace');

    await expect(runtime.cancelRun('run-2')).rejects.toThrow(
      'Run is not suspended.'
    );
    expect(runtimeMocks.updateRun).not.toHaveBeenCalled();
  });
});
