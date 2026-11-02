import {getUsageOverview} from '../../services/usageOverviewService';
import {z} from 'zod';
import { registerTaskOrganizationHandlers } from './taskOrganizationHandlers';
import { ipcMain } from 'electron';
import {
  clearActiveAgentSessions,
  createActiveAgentSession,
  deleteActiveAgentSession,
  getActiveAgentSession,
  listActiveAgentSessions,
  setActiveAgentSession,
  updateActiveAgentSessionTitle
} from '../../services/chatService';
import {
  getLatestRunForActiveAgentSession,
  getPendingApprovalForActiveAgentSession
} from '../../services/chatRunService';
import {
  deleteAttachmentForActiveSession,
  getTaskSession,
  prepareAttachmentsForActiveAgent,
  recordPrepareAttachmentsFailure
} from '../../services/chatAttachmentService';
import {
  getMonitoringAgentStats,
  getMonitoringTokenUsageDetails
} from '../../services/chatMonitoringService';
import { KAIRO_INVOKE } from '../../../shared/ipc';
import { parseIpcInput } from './configValidation';
import {
  CreateSessionInputSchema,
  DeleteAttachmentInputSchema,
  MonitoringTokenQueryInputSchema,
  PrepareAttachmentsInputSchema,
  SessionIdInputSchema,
  UpdateSessionTitleInputSchema
} from './chatSystemValidation';
import { ipcFailure, ipcSuccess } from './ipcResult';

function registerChatHandlers() {
  registerTaskOrganizationHandlers();
  ipcMain.handle(KAIRO_INVOKE.usageOverview,(_,value)=>{const input=z.object({projectId:z.string().trim().min(1).max(200).optional()}).strict().parse(value||{});return getUsageOverview(input.projectId);});
  ipcMain.handle(KAIRO_INVOKE.chatListSessions, async () => {
    return listActiveAgentSessions();
  });

  ipcMain.handle(KAIRO_INVOKE.chatCreateSession, async (_, title) => {
    const payload = parseIpcInput(CreateSessionInputSchema, title, 'session creation');
    return typeof payload === 'object'
      ? createActiveAgentSession(payload.title || 'New Chat', payload.projectId)
      : createActiveAgentSession(payload || 'New Chat');
  });

  ipcMain.handle(KAIRO_INVOKE.chatGetActiveSession, async () => {
    return getActiveAgentSession();
  });

  ipcMain.handle(KAIRO_INVOKE.chatGetSession, async (_, sessionId) => {
    const payload = SessionIdInputSchema.safeParse(sessionId);
    if (!payload.success) {
      return null;
    }
    return getTaskSession(payload.data);
  });

  ipcMain.handle(KAIRO_INVOKE.chatGetLatestRun, async (_, sessionId) => {
    const payload = SessionIdInputSchema.safeParse(sessionId);
    if (!payload.success) {
      return null;
    }
    return getLatestRunForActiveAgentSession(payload.data);
  });

  ipcMain.handle(KAIRO_INVOKE.chatGetPendingApproval, async (_, sessionId) => {
    const payload = SessionIdInputSchema.safeParse(sessionId);
    if (payload.success) {
      return getPendingApprovalForActiveAgentSession(payload.data);
    }
    return getPendingApprovalForActiveAgentSession();
  });

  ipcMain.handle(KAIRO_INVOKE.chatSetActiveSession, async (_, sessionId) => {
    const resolvedSessionId = parseIpcInput(SessionIdInputSchema, sessionId, 'session id');
    try {
      setActiveAgentSession(resolvedSessionId);
      return ipcSuccess();
    } catch (error) {
      return ipcFailure(error);
    }
  });

  ipcMain.handle(KAIRO_INVOKE.chatUpdateSessionTitle, async (_, input) => {
    const payload = parseIpcInput(UpdateSessionTitleInputSchema, input, 'session title update');
    try {
      updateActiveAgentSessionTitle(payload.sessionId, payload.title);
      return ipcSuccess();
    } catch (error) {
      return ipcFailure(error);
    }
  });

  ipcMain.handle(KAIRO_INVOKE.chatDeleteSession, async (_, sessionId) => {
    const resolvedSessionId = parseIpcInput(SessionIdInputSchema, sessionId, 'session id');
    try {
      deleteActiveAgentSession(resolvedSessionId);
      return ipcSuccess();
    } catch (error) {
      return ipcFailure(error);
    }
  });

  ipcMain.handle(KAIRO_INVOKE.chatClearAllSessions, async () => {
    clearActiveAgentSessions();
    return ipcSuccess();
  });

  ipcMain.handle(KAIRO_INVOKE.chatGetAgentStats, async () => {
    return getMonitoringAgentStats();
  });

  ipcMain.handle(KAIRO_INVOKE.chatGetTokenUsageDetails, async (_, params) => {
    const query = parseIpcInput(MonitoringTokenQueryInputSchema, params, 'token usage query');
    return getMonitoringTokenUsageDetails(query);
  });

  ipcMain.handle(KAIRO_INVOKE.chatPrepareAttachments, async (_, input) => {
    try {
      const payload = parseIpcInput(PrepareAttachmentsInputSchema, input, 'attachment prepare request');
      const attachments = await prepareAttachmentsForActiveAgent({
        sessionId: payload.sessionId,
        files: payload.files
      });
      return ipcSuccess({ attachments });
    } catch (error) {
      const result = ipcFailure(error);
      recordPrepareAttachmentsFailure(result.error);
      return result;
    }
  });

  ipcMain.handle(KAIRO_INVOKE.chatDeleteAttachment, async (_, input) => {
    try {
      const payload = parseIpcInput(DeleteAttachmentInputSchema, input, 'attachment delete request');
      const deleted = await deleteAttachmentForActiveSession(payload);
      return ipcSuccess({ deleted });
    } catch (error) {
      return ipcFailure(error);
    }
  });
}

export { registerChatHandlers };
