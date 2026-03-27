import { ipcMain } from 'electron';
import {
  createSession,
  getActiveSession,
  getSessionById,
  updateSessionTitle,
  deleteSession,
  clearAllSessions,
  setActiveSessionId,
  listSessions,
  getAgentStats,
  getTokenUsageDetails
} from '../store/chat';
import { getActiveAgentId } from '../store/config';
import { KAIRO_INVOKE } from '../../shared/ipc';

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
