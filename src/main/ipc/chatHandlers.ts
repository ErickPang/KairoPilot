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

function registerChatHandlers() {
  ipcMain.handle('chat:listSessions', async () => {
    const agentId = getActiveAgentId();
    return listSessions(agentId || undefined);
  });

  ipcMain.handle('chat:createSession', async (_, title) => {
    const sessionTitle = typeof title === 'string' ? title : 'New Chat';
    const agentId = getActiveAgentId();
    return createSession(sessionTitle, agentId || undefined);
  });

  ipcMain.handle('chat:getActiveSession', async () => {
    const agentId = getActiveAgentId();
    return getActiveSession(agentId || undefined);
  });

  ipcMain.handle('chat:getSession', async (_, sessionId) => {
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

  ipcMain.handle('chat:setActiveSession', async (_, sessionId) => {
    const agentId = getActiveAgentId();
    const session = typeof sessionId === 'string' ? getSessionById(sessionId) : null;
    if (!session || (agentId && session.agentId !== agentId)) {
      return { success: false, error: 'Session does not belong to the active agent.' };
    }
    setActiveSessionId(sessionId, agentId || undefined);
    return { success: true };
  });

  ipcMain.handle('chat:updateSessionTitle', async (_, { sessionId, title }) => {
    updateSessionTitle(sessionId, title);
    return { success: true };
  });

  ipcMain.handle('chat:deleteSession', async (_, sessionId) => {
    deleteSession(sessionId);
    return { success: true };
  });

  ipcMain.handle('chat:clearAllSessions', async () => {
    clearAllSessions();
    return { success: true };
  });

  ipcMain.handle('chat:getAgentStats', async () => {
    return getAgentStats();
  });

  ipcMain.handle('chat:getTokenUsageDetails', async (_, params) => {
    const agentId = typeof params?.agentId === 'string' ? params.agentId : undefined;
    const page = typeof params?.page === 'number' ? params.page : 1;
    const pageSize = typeof params?.pageSize === 'number' ? params.pageSize : 20;
    return getTokenUsageDetails(agentId, page, pageSize);
  });
}

export { registerChatHandlers };
