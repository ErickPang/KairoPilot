import { ipcMain } from 'electron';
import {
  createSession,
  getActiveSession,
  updateSessionTitle,
  deleteSession,
  clearAllSessions,
  setActiveSessionId,
  getSessions,
  getAgentStats
} from '../store/chat';
import { getActiveAgentId } from '../store/config';

function registerChatHandlers() {
  ipcMain.handle('chat:getSessions', async () => {
    const agentId = getActiveAgentId();
    return getSessions(agentId || undefined);
  });

  ipcMain.handle('chat:createSession', async (_, title) => {
    const sessionTitle = typeof title === 'string' ? title : 'New Chat';
    const agentId = getActiveAgentId();
    return createSession(sessionTitle, agentId || undefined);
  });

  ipcMain.handle('chat:getActiveSession', async () => {
    return getActiveSession();
  });

  ipcMain.handle('chat:setActiveSession', async (_, sessionId) => {
    setActiveSessionId(sessionId);
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
}

export { registerChatHandlers };
