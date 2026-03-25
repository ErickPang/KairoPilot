import { ipcMain } from 'electron';
import { getAuditLogs } from '../store/audit';
import { getActiveAgentId, setActiveAgentId } from '../store/config';
import { createSession, getActiveSession, getSessionById, listSessions, setActiveSessionId, updateSessionMessages } from '../store/chat';
import { getAgentRuntime, initializeAgent, pendingConfirmations, resolveAgentConfig } from './agentRuntime';

function registerAgentHandlers() {
  ipcMain.handle('agent:init', async (event, configOrId) => {
    try {
      const config = await resolveAgentConfig(configOrId);

      if (typeof configOrId === 'string') {
        setActiveAgentId(configOrId);
        const agentSessions = listSessions(configOrId);
        if (agentSessions.length > 0) {
          setActiveSessionId(agentSessions[0].id, configOrId);
        } else {
          createSession('New Chat', configOrId);
        }
      }

      await initializeAgent(config, event.sender);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (!message.startsWith('Model not found for agent model:')) {
        console.error('Failed to init agent:', error);
      }
      return { success: false, error: message };
    }
  });

  ipcMain.handle('agent:confirm-response', async (_, { id, approved }) => {
    const resolve = pendingConfirmations.get(id);
    if (resolve) {
      resolve(approved);
      pendingConfirmations.delete(id);
    }
    return { success: true };
  });

  ipcMain.handle('audit:get', async (_, limit) => {
    return getAuditLogs(limit);
  });

  ipcMain.handle('agent:chat', async (event, message) => {
    const activeAgentId = getActiveAgentId();
    if (!activeAgentId) {
      return { error: 'Agent not initialized. Please configure settings first.' };
    }

    let agent = getAgentRuntime(activeAgentId);

    if (!agent) {
      try {
        const config = await resolveAgentConfig(activeAgentId);
        agent = await initializeAgent(config, event.sender);
      } catch {
        return { error: 'Agent not initialized. Please configure settings first.' };
      }
    }

    if (!agent) {
      return { error: 'Agent initialization failed.' };
    }

    try {
      let session = getActiveSession(activeAgentId);
      if (!session || session.agentId !== activeAgentId) {
        const existingSession = listSessions(activeAgentId)[0];
        if (existingSession) {
          setActiveSessionId(existingSession.id, activeAgentId);
          session = getSessionById(existingSession.id);
        } else {
          session = createSession('New Chat', activeAgentId);
        }
      }

      if (!session) {
        return { error: 'Failed to resolve active session.' };
      }

      agent.setHistory(session.messages);
      const response = await agent.chat(message, (update) => {
        event.sender.send('agent:update', update);
      }, { sessionId: session.id });
      updateSessionMessages(session.id, agent.getHistory());
      return { content: response };
    } catch (error) {
      console.error('Agent chat error:', error);
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}

export { registerAgentHandlers };
