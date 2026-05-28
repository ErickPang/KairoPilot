import { beforeEach, describe, expect, it, vi } from 'vitest';

const registeredHandlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    registeredHandlers.set(channel, handler);
  })
}));

const chatStoreMocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  getActiveSession: vi.fn(),
  getApprovalRecord: vi.fn(),
  getLatestSessionContextSummary: vi.fn(),
  getLatestRun: vi.fn(),
  getLatestRunSteps: vi.fn(),
  getPendingApproval: vi.fn(),
  getRunById: vi.fn(),
  queryRuns: vi.fn(),
  getRunTrace: vi.fn(),
  migrateLegacyAttachmentsForSession: vi.fn(),
  getSessionById: vi.fn(),
  updateSessionTitle: vi.fn(),
  deleteSession: vi.fn(),
  deleteSessionsByAgent: vi.fn(),
  setActiveSessionId: vi.fn(),
  listSessions: vi.fn(),
  getAgentStats: vi.fn(),
  getTokenUsageDetails: vi.fn()
}));

const configStoreMocks = vi.hoisted(() => ({
  getActiveAgentId: vi.fn(() => 'agent-1'),
  getAgent: vi.fn()
}));

const attachmentMocks = vi.hoisted(() => ({
  deleteAttachmentFile: vi.fn(),
  getWorkspaceAttachmentUploadsRoot: vi.fn(),
  prepareChatAttachments: vi.fn(),
  scheduleAttachmentCleanup: vi.fn()
}));

const auditMocks = vi.hoisted(() => ({
  addAuditLog: vi.fn()
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMocks.handle
  }
}));

vi.mock('../../store/chat', () => chatStoreMocks);
vi.mock('../../store/config', () => configStoreMocks);
vi.mock('../../store/attachments', () => attachmentMocks);
vi.mock('../../store/audit', () => auditMocks);

import { KAIRO_INVOKE } from '../../../shared/ipc';
import { registerChatHandlers } from './chatHandlers';

describe('chatHandlers', () => {
  beforeEach(() => {
    registeredHandlers.clear();
    electronMocks.handle.mockClear();

    for (const mock of [
      ...Object.values(chatStoreMocks),
      ...Object.values(configStoreMocks),
      ...Object.values(attachmentMocks),
      ...Object.values(auditMocks)
    ]) {
      mock.mockReset();
    }

    configStoreMocks.getActiveAgentId.mockReturnValue('agent-1');
    registerChatHandlers();
  });

  it('rejects title updates for sessions outside the active agent', async () => {
    chatStoreMocks.getSessionById.mockReturnValue({
      id: 'session-2',
      title: 'Other',
      agentId: 'agent-2',
      messages: [],
      createdAt: 1,
      updatedAt: 1
    });

    const handler = registeredHandlers.get(KAIRO_INVOKE.chatUpdateSessionTitle);
    const result = await handler?.({}, {
      sessionId: 'session-2',
      title: 'Renamed'
    });

    expect(result).toEqual({
      success: false,
      error: 'Session does not belong to the active agent.'
    });
    expect(chatStoreMocks.updateSessionTitle).not.toHaveBeenCalled();
  });

  it('rejects deletes for sessions outside the active agent', async () => {
    chatStoreMocks.getSessionById.mockReturnValue({
      id: 'session-2',
      title: 'Other',
      agentId: 'agent-2',
      messages: [],
      createdAt: 1,
      updatedAt: 1
    });

    const handler = registeredHandlers.get(KAIRO_INVOKE.chatDeleteSession);
    const result = await handler?.({}, 'session-2');

    expect(result).toEqual({
      success: false,
      error: 'Session does not belong to the active agent.'
    });
    expect(chatStoreMocks.deleteSession).not.toHaveBeenCalled();
  });

  it('clears only sessions for the active agent', async () => {
    const handler = registeredHandlers.get(KAIRO_INVOKE.chatClearAllSessions);
    const result = await handler?.({});

    expect(result).toEqual({ success: true });
    expect(chatStoreMocks.deleteSessionsByAgent).toHaveBeenCalledWith('agent-1');
  });
});
