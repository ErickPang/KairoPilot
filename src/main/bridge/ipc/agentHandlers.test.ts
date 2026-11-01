import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KAIRO_INVOKE } from '../../../shared/ipc';

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => Promise<unknown>>());
const services = vi.hoisted(() => ({
  runApprovalResponse: vi.fn(), runStoredAgentAction: vi.fn(), controlStoredRun: vi.fn(), runActiveAgentChat: vi.fn(),
  createRuntimeUpdateForwarder: vi.fn(), mapRuntimeHandlerFailure: (error: unknown) => ({ success: false, error: error instanceof Error ? error.message : 'Unknown error' })
}));
vi.mock('electron', () => ({ ipcMain: { handle: (id: string, fn: (...args: unknown[]) => Promise<unknown>) => handlers.set(id, fn) } }));
vi.mock('../../store/audit', () => ({ queryAuditLogs: vi.fn() }));
vi.mock('../../store/chat', () => ({ ensureActiveSession: vi.fn() }));
vi.mock('../../core/skills/manager', () => ({ skillsManager: {} }));
vi.mock('./agentHandlerService', () => services);
import { registerAgentHandlers } from './agentHandlers';

beforeEach(() => { vi.clearAllMocks(); handlers.clear(); registerAgentHandlers(); });

describe('agent handler execution boundaries', () => {
  it('delegates the exact approval decision to the serialized service', async () => {
    const sender = {};
    services.runApprovalResponse.mockResolvedValue({ success: true });
    expect(await handlers.get(KAIRO_INVOKE.agentConfirmResponse)!({ sender }, { id: 'approval-1', approved: false })).toEqual({ success: true });
    expect(services.runApprovalResponse).toHaveBeenCalledWith('approval-1', false, sender);
  });
  it.each([KAIRO_INVOKE.agentPauseRun, KAIRO_INVOKE.agentCancelRun])('does not persist unrelated history when %s fails', async (channel) => {
    services.controlStoredRun.mockRejectedValue(new Error('wrong run'));
    expect(await handlers.get(channel)!({ sender: {} }, { runId: 'run-1' })).toEqual({ success: false, error: 'wrong run' });
    expect(services.controlStoredRun).toHaveBeenCalledTimes(1);
  });
  it.each([KAIRO_INVOKE.agentResumeRun, KAIRO_INVOKE.agentRetryStep])('routes %s through the exclusive runtime service', async (channel) => {
    services.runStoredAgentAction.mockRejectedValue(new Error('Agent execution is already in progress.'));
    expect(await handlers.get(channel)!({ sender: {} }, { runId: 'run-1', stepId: 'step-1' })).toEqual({ success: false, error: 'Agent execution is already in progress.' });
    expect(services.runStoredAgentAction).toHaveBeenCalledTimes(1);
  });
});
