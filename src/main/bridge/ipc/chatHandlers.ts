import { ipcMain } from 'electron';
import {
  createSession,
  getActiveSession,
  getApprovalRecord,
  getLatestSessionContextSummary,
  getLatestRun,
  getLatestRunSteps,
  getPendingApproval,
  getRunById,
  queryRuns,
  getRunTrace,
  migrateLegacyAttachmentsForSession,
  getSessionById,
  updateSessionTitle,
  deleteSession,
  clearAllSessions,
  setActiveSessionId,
  listSessions,
  getAgentStats,
  getTokenUsageDetails
} from '../../store/chat';
import { getActiveAgentId } from '../../store/config';
import { getAgent, saveAgent } from '../../store/config';
import { deleteAttachmentFile, getWorkspaceAttachmentUploadsRoot, prepareChatAttachments, scheduleAttachmentCleanup } from '../../store/attachments';
import { addAuditLog } from '../../store/audit';
import { KAIRO_INVOKE } from '../../../shared/ipc';
import type { PrepareAttachmentInput } from '../../../shared/contracts';

function registerChatHandlers() {
  ipcMain.handle(KAIRO_INVOKE.chatListSessions, async () => {
    const agentId = getActiveAgentId();
    return listSessions(agentId || undefined);
  });

  ipcMain.handle(KAIRO_INVOKE.chatCreateSession, async (_, title) => {
    const sessionTitle = typeof title === 'string' ? title : 'New Chat';
    const agentId = getActiveAgentId();
    return createSession(sessionTitle, agentId || undefined);
  });

  ipcMain.handle(KAIRO_INVOKE.chatGetActiveSession, async () => {
    const agentId = getActiveAgentId();
    return getActiveSession(agentId || undefined);
  });

  ipcMain.handle(KAIRO_INVOKE.chatGetSession, async (_, sessionId) => {
    if (typeof sessionId !== 'string') {
      return null;
    }
    const agentId = getActiveAgentId();
    const initialSession = getSessionById(sessionId);
    if (initialSession) {
      const agent = getAgent(initialSession.agentId || agentId || '');
      if (agent?.workspace) {
        const migrated = await migrateLegacyAttachmentsForSession(initialSession.id, agent.workspace);
        if (migrated > 0) {
          addAuditLog({
            tool: 'migrate_legacy_attachments',
            args: { sessionId: initialSession.id },
            result: { migrated },
            sessionId: initialSession.id,
            policyTags: ['attachment:migrate']
          });
        }
      }
    }
    const session = getSessionById(sessionId);
    if (session && agentId && session.agentId !== agentId) {
      return null;
    }
    return session;
  });

  ipcMain.handle(KAIRO_INVOKE.chatGetLatestRun, async (_, sessionId) => {
    if (typeof sessionId !== 'string') {
      return null;
    }
    const session = getSessionById(sessionId);
    const agentId = getActiveAgentId();
    if (!session || (agentId && session.agentId !== agentId)) {
      return null;
    }
    return getLatestRun(sessionId);
  });

  ipcMain.handle(KAIRO_INVOKE.chatGetLatestContextSummary, async (_, sessionId) => {
    if (typeof sessionId !== 'string') {
      return null;
    }
    const session = getSessionById(sessionId);
    const agentId = getActiveAgentId();
    if (!session || (agentId && session.agentId !== agentId)) {
      return null;
    }
    return getLatestSessionContextSummary(sessionId);
  });

  ipcMain.handle(KAIRO_INVOKE.chatGetSessionRuns, async (_, sessionId) => {
    if (typeof sessionId !== 'string') {
      return [];
    }
    const session = getSessionById(sessionId);
    const agentId = getActiveAgentId();
    if (!session || (agentId && session.agentId !== agentId)) {
      return [];
    }
    return getLatestRunSteps(sessionId);
  });

  ipcMain.handle(KAIRO_INVOKE.chatGetPendingApproval, async (_, sessionId) => {
    if (typeof sessionId === 'string') {
      const session = getSessionById(sessionId);
      const agentId = getActiveAgentId();
      if (!session || (agentId && session.agentId !== agentId)) {
        return null;
      }
      return getPendingApproval(sessionId);
    }

    const approval = getPendingApproval();
    if (!approval?.id) {
      return null;
    }
    return getApprovalRecord(approval.id);
  });

  ipcMain.handle(KAIRO_INVOKE.chatQueryRuns, async (_, input) => {
    const agentId = getActiveAgentId();
    const query = typeof input === 'object' && input ? input : {};
    return queryRuns({
      ...(query as Record<string, unknown>),
      agentId: agentId || undefined
    });
  });

  ipcMain.handle(KAIRO_INVOKE.chatGetRunTrace, async (_, input) => {
    const runId = typeof input === 'string'
      ? input
      : (input && typeof input === 'object' && typeof (input as { runId?: unknown }).runId === 'string'
        ? (input as { runId: string }).runId
        : null);
    if (!runId) {
      return null;
    }

    const run = getRunById(runId);
    if (!run) {
      return null;
    }

    const session = getSessionById(run.sessionId);
    const agentId = getActiveAgentId();
    if (!session || (agentId && session.agentId !== agentId)) {
      return null;
    }

    return getRunTrace(typeof input === 'string' ? runId : input);
  });

  ipcMain.handle(KAIRO_INVOKE.chatSetActiveSession, async (_, sessionId) => {
    const agentId = getActiveAgentId();
    const session = typeof sessionId === 'string' ? getSessionById(sessionId) : null;
    if (!session || (agentId && session.agentId !== agentId)) {
      return { success: false, error: 'Session does not belong to the active agent.' };
    }
    setActiveSessionId(sessionId, agentId || undefined);
    return { success: true };
  });

  ipcMain.handle(KAIRO_INVOKE.chatUpdateSessionTitle, async (_, { sessionId, title }) => {
    updateSessionTitle(sessionId, title);
    return { success: true };
  });

  ipcMain.handle(KAIRO_INVOKE.chatDeleteSession, async (_, sessionId) => {
    deleteSession(sessionId);
    return { success: true };
  });

  ipcMain.handle(KAIRO_INVOKE.chatClearAllSessions, async () => {
    clearAllSessions();
    return { success: true };
  });

  ipcMain.handle(KAIRO_INVOKE.chatGetAgentStats, async () => {
    return getAgentStats();
  });

  ipcMain.handle(KAIRO_INVOKE.chatGetTokenUsageDetails, async (_, params) => {
    return getTokenUsageDetails(typeof params === 'object' && params ? params : {});
  });

  ipcMain.handle(KAIRO_INVOKE.chatPrepareAttachments, async (_, input) => {
    try {
      const payload = typeof input === 'object' && input ? input as Record<string, unknown> : {};
      const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
      const session = sessionId ? getSessionById(sessionId) : null;
      const activeAgentId = getActiveAgentId();
      if (!session || (activeAgentId && session.agentId !== activeAgentId)) {
        return { success: false, error: 'Session does not belong to the active agent.' };
      }

      const agent = getAgent(session.agentId || activeAgentId || '');
      if (!agent?.workspace) {
        return { success: false, error: 'Active agent workspace is not configured.' };
      }

      const uploadRoot = getWorkspaceAttachmentUploadsRoot(agent.workspace);
      if (!agent.permissions.fileSystem.allowedPaths.includes(uploadRoot)) {
        saveAgent({
          ...agent,
          permissions: {
            ...agent.permissions,
            fileSystem: {
              ...agent.permissions.fileSystem,
              allowedPaths: [...agent.permissions.fileSystem.allowedPaths, uploadRoot]
            }
          }
        });
      }

      const files = Array.isArray(payload.files)
        ? payload.files.filter((file): file is PrepareAttachmentInput => {
            if (!file || typeof file !== 'object') {
              return false;
            }
            const candidate = file as Record<string, unknown>;
            return typeof candidate.path === 'string' && candidate.path.trim().length > 0;
          })
        : [];
      if (files.length === 0) {
        return { success: false, error: 'No files selected.' };
      }

      const attachments = await prepareChatAttachments({
        sessionId: session.id,
        workspace: agent.workspace,
        files
      });
      const cleanup = scheduleAttachmentCleanup(agent.workspace);
      addAuditLog({
        tool: 'prepare_attachments',
        args: {
          sessionId: session.id,
          count: attachments.length,
          files: attachments.map((attachment) => ({
            id: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            size: attachment.size,
            kind: attachment.kind,
            storedPath: attachment.storedPath
          }))
        },
        result: {
          success: true,
          uploadRoot,
          cleanup
        },
        sessionId: session.id,
        policyTags: ['attachment:prepare', 'filesystem:copy']
      });
      return { success: true, attachments };
    } catch (error) {
      addAuditLog({
        tool: 'prepare_attachments',
        args: {},
        error: error instanceof Error ? error.message : 'Unknown error',
        policyTags: ['attachment:prepare', 'decision:error']
      });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(KAIRO_INVOKE.chatDeleteAttachment, async (_, input) => {
    try {
      const payload = typeof input === 'object' && input ? input as Record<string, unknown> : {};
      const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
      const attachment = payload.attachment && typeof payload.attachment === 'object'
        ? payload.attachment as import('../../../shared/contracts').ChatAttachment
        : null;
      const session = sessionId ? getSessionById(sessionId) : null;
      const activeAgentId = getActiveAgentId();
      if (!session || (activeAgentId && session.agentId !== activeAgentId) || !attachment || attachment.sessionId !== session.id) {
        return { success: false, error: 'Attachment does not belong to the active session.' };
      }

      const deleted = await deleteAttachmentFile(attachment);
      addAuditLog({
        tool: 'delete_attachment',
        args: { sessionId, attachmentId: attachment.id, name: attachment.name },
        result: { deleted },
        sessionId,
        policyTags: ['attachment:delete']
      });
      return { success: true, deleted };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}

export { registerChatHandlers };
