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
import { KAIRO_INVOKE } from '../../../shared/ipc';

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
    const session = getSessionById(sessionId);
    const agentId = getActiveAgentId();
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
}

export { registerChatHandlers };
