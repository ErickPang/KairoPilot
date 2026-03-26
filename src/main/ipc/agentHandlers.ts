import { ipcMain } from 'electron';
import { queryAuditLogs } from '../store/audit';
import { getActiveAgentId, setActiveAgentId } from '../store/config';
import { ensureActiveSession, updateSessionMessages } from '../store/chat';
import { getAgentRuntime, initializeAgent, pendingConfirmations, resolveAgentConfig } from './agentRuntime';
import { KAIRO_EVENT, KAIRO_INVOKE } from '../../shared/ipc';

function registerAgentHandlers() {
  ipcMain.handle(KAIRO_INVOKE.agentInit, async (event, configOrId) => {
    try {
      const config = await resolveAgentConfig(configOrId);

      if (typeof configOrId === 'string') {
        setActiveAgentId(configOrId);
        ensureActiveSession(configOrId);
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

  ipcMain.handle(KAIRO_INVOKE.agentConfirmResponse, async (_, { id, approved }) => {
    const resolve = pendingConfirmations.get(id);
    if (resolve) {
      resolve(approved);
      pendingConfirmations.delete(id);
    }
    return { success: true };
  });

  ipcMain.handle(KAIRO_INVOKE.auditGet, async (_, query) => {
    if (typeof query === 'number') {
      return queryAuditLogs({ page: 1, pageSize: query });
    }
    return queryAuditLogs(typeof query === 'object' && query ? query : {});
  });

  ipcMain.handle(KAIRO_INVOKE.agentChat, async (event, message) => {
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
      const session = ensureActiveSession(activeAgentId);

      if (!session) {
        return { error: 'Failed to resolve active session.' };
      }

      agent.setHistory(session.messages);
      const response = await agent.chat(message, (update) => {
        event.sender.send(KAIRO_EVENT.agentUpdate, update);
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
