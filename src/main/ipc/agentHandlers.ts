import { ipcMain } from 'electron';
import { getAuditLogs } from '../store/audit';
import { getActiveAgentId, setActiveAgentId } from '../store/config';
import { createSession, getActiveSession, getSessions, setActiveSessionId, updateSessionMessages } from '../store/chat';
import { getCurrentAgent, initializeAgent, pendingConfirmations, resolveAgentConfig } from './agentRuntime';

function registerAgentHandlers() {
  ipcMain.handle('agent:init', async (event, configOrId) => {
    try {
      const config = await resolveAgentConfig(configOrId);

      if (typeof configOrId === 'string') {
        setActiveAgentId(configOrId);
        const agentSessions = getSessions(configOrId);
        if (agentSessions.length > 0) {
          setActiveSessionId(agentSessions[0].id);
        } else {
          createSession('New Chat', configOrId);
        }
      }

      await initializeAgent(config, event.sender);
      return { success: true };
    } catch (error) {
      console.error('Failed to init agent:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
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
    let agent = getCurrentAgent();

    if (!agent) {
      try {
        const activeAgentId = getActiveAgentId();
        if (activeAgentId) {
          const config = await resolveAgentConfig(activeAgentId);
          await initializeAgent(config, event.sender);
          agent = getCurrentAgent();
        } else {
          return { error: 'Agent not initialized. Please configure settings first.' };
        }
      } catch {
        return { error: 'Agent not initialized. Please configure settings first.' };
      }
    }

    if (!agent) {
      return { error: 'Agent initialization failed.' };
    }

    try {
      let session = getActiveSession();
      if (!session) {
        session = createSession();
      }

      agent.setHistory(session.messages);
      const response = await agent.chat(message, (update) => {
        event.sender.send('agent:update', update);
      });
      updateSessionMessages(session.id, agent.getHistory());
      return { content: response };
    } catch (error) {
      console.error('Agent chat error:', error);
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}

export { registerAgentHandlers };
