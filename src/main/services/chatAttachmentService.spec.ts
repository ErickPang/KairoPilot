import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatStoreMocks = vi.hoisted(() => ({
  registerPreparedAttachments: vi.fn(),
  isStoredAttachmentReferenced: vi.fn(),
  getSessionById: vi.fn(),
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



vi.mock('../store/chat', () => chatStoreMocks);
vi.mock('../store/attachments', () => attachmentMocks);
vi.mock('../store/audit', () => auditMocks);
vi.mock('./workbenchConfigService',()=>({getWorkbenchConfig:()=>({managementRoot:'/workspace/agent-1'})}));

import {
  ACTIVE_AGENT_ATTACHMENT_ERROR,
  ACTIVE_SESSION_ATTACHMENT_ERROR,
  deleteAttachmentForActiveSession,
  prepareAttachmentsForActiveAgent
} from './chatAttachmentService';

describe('chatAttachmentService', () => {
  beforeEach(() => {
    for (const mock of [
      ...Object.values(chatStoreMocks),
      ...Object.values(attachmentMocks),
      ...Object.values(auditMocks)
    ]) {
      mock.mockReset();
    }

    attachmentMocks.getWorkspaceAttachmentUploadsRoot.mockReturnValue('/workspace/agent-1/.kairopilot/uploads');
    attachmentMocks.scheduleAttachmentCleanup.mockReturnValue({ scheduled: true, reason: 'scheduled' });
  });

  it('prepares attachments for the active agent and records audit entries', async () => {
    chatStoreMocks.getSessionById.mockReturnValue({
      id: 'session-1',
      title: 'Owned',
      agentId: 'agent-1',
      messages: [],
      createdAt: 1,
      updatedAt: 1
    });
    attachmentMocks.prepareChatAttachments.mockResolvedValue([
      {
        id: 'attachment-1',
        sessionId: 'session-1',
        name: 'note.txt',
        mimeType: 'text/plain',
        size: 12,
        kind: 'text',
        storedPath: '/workspace/agent-1/.kairopilot/uploads/session-1/note.txt',
        contentHash: 'hash',
        createdAt: 1
      }
    ]);

    const attachments = await prepareAttachmentsForActiveAgent({
      sessionId: 'session-1',
      files: [{ path: '/tmp/note.txt', name: 'note.txt', mimeType: 'text/plain' }]
    });

    expect(attachments).toHaveLength(1);
    expect(attachmentMocks.prepareChatAttachments).toHaveBeenCalledWith({
      sessionId: 'session-1',
      workspace: '/workspace/agent-1',
      files: [{ path: '/tmp/note.txt', name: 'note.txt', mimeType: 'text/plain' }]
    });
    expect(auditMocks.addAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'prepare_attachments',
      sessionId: 'session-1',
      policyTags: ['attachment:prepare', 'filesystem:copy']
    }));
  });

  it('rejects attachment preparation for a missing task', async () => {
    chatStoreMocks.getSessionById.mockReturnValue(null);

    await expect(prepareAttachmentsForActiveAgent({
      sessionId: 'session-2',
      files: [{ path: '/tmp/note.txt' }]
    })).rejects.toThrow(ACTIVE_AGENT_ATTACHMENT_ERROR);
    expect(attachmentMocks.prepareChatAttachments).not.toHaveBeenCalled();
  });

  it('rejects deleting attachments outside the active session', async () => {
    chatStoreMocks.getSessionById.mockReturnValue({
      id: 'session-1',
      title: 'Owned',
      agentId: 'agent-1',
      messages: [],
      createdAt: 1,
      updatedAt: 1
    });

    await expect(deleteAttachmentForActiveSession({
      sessionId: 'session-1',
      attachment: {
        id: 'attachment-1',
        sessionId: 'session-2',
        name: 'note.txt',
        mimeType: 'text/plain',
        size: 12,
        kind: 'text',
        storedPath: '/workspace/agent-1/.kairopilot/uploads/session-2/note.txt',
        contentHash: 'hash',
        createdAt: 1
      }
    })).rejects.toThrow(ACTIVE_SESSION_ATTACHMENT_ERROR);
    expect(attachmentMocks.deleteAttachmentFile).not.toHaveBeenCalled();
  });
});
