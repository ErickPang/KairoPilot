import { beforeEach, describe, expect, it, vi } from 'vitest';

const registeredHandlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    registeredHandlers.set(channel, handler);
  })
}));

const chatStoreMocks = vi.hoisted(() => ({
  getUnsettledRunsForAgent: vi.fn(() => []),
  createSession: vi.fn(),
  getActiveSession: vi.fn(),
  getApprovalRecord: vi.fn(),
  getLatestSessionContextSummary: vi.fn(),
  getLatestRun: vi.fn(),
  getPendingApproval: vi.fn(),
  getRunById: vi.fn(),
  getSessionById: vi.fn(),
  updateSessionTitle: vi.fn(),
  deleteSession: vi.fn(),
  setActiveSessionId: vi.fn(),
  listSessions: vi.fn(),
  getAgentStats: vi.fn(),
  getTokenUsageDetails: vi.fn()
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

vi.mock('../../store/chat', () => ({...chatStoreMocks,getDb:()=>({prepare:()=>({all:()=>[{id:'session-2'}]})})}));
vi.mock('../../store/taskPages', () => ({ getOwnedSessionSummary: (_agent: string, id: string) => chatStoreMocks.getSessionById(id), getActiveSessionSummary: (agent: string) => chatStoreMocks.getActiveSession(agent) }));
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
      ...Object.values(attachmentMocks),
      ...Object.values(auditMocks)
    ]) {
      mock.mockReset();
    }

    chatStoreMocks.getUnsettledRunsForAgent.mockReturnValue([]);
    registerChatHandlers();
  });

  it('allows title updates for historical tasks in the workbench', async () => {
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

    expect(result).toEqual({success:true});
    expect(chatStoreMocks.updateSessionTitle).toHaveBeenCalledWith('session-2','Renamed');
  });

  it('allows deletes for idle historical tasks in the workbench', async () => {
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

    expect(result).toEqual({success:true});
    expect(chatStoreMocks.deleteSession).toHaveBeenCalledWith('session-2');
  });

  it('clears tasks from all historical sources', async () => {
    const handler = registeredHandlers.get(KAIRO_INVOKE.chatClearAllSessions);
    const result = await handler?.({});

    expect(result).toEqual({ success: true });
    expect(chatStoreMocks.deleteSession).toHaveBeenCalledWith('session-2');
  });
});
