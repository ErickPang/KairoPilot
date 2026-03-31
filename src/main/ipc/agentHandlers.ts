import { ipcMain } from 'electron';
import { queryAuditLogs } from '../store/audit';
import { getActiveAgentId, getAgents, setActiveAgentId } from '../store/config';
import { ensureActiveSession, updateSessionMessages } from '../store/chat';
import { skillsManager } from '../core/skills/manager';
import { getAgentRuntime, initializeAgent, pendingConfirmations, resolveAgentConfig } from './agentRuntime';
import { KAIRO_EVENT, KAIRO_INVOKE } from '../../shared/ipc';
import { SkillSummary } from '../../shared/contracts';

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

  ipcMain.handle(KAIRO_INVOKE.skillsGetAll, async () => {
    const agents = getAgents();
    const result: Record<string, SkillSummary[]> = {};
    result.public = await skillsManager.listPublicSkills();
    for (const agent of agents) {
      result[agent.id] = await skillsManager.listAgentSkills(agent.id);
    }
    return result;
  });

  ipcMain.handle(KAIRO_INVOKE.skillsGetStore, async () => {
    return skillsManager.getStoreSkills();
  });

  ipcMain.handle(KAIRO_INVOKE.skillsGetStoreByQuery, async (_, query) => {
    const payload = typeof query === 'object' && query ? query : { kind: 'curated' };
    return skillsManager.getStoreSkills(
      payload.kind === 'registry' && typeof payload.url === 'string'
        ? { kind: 'registry', url: payload.url }
        : { kind: 'curated' }
    );
  });

  ipcMain.handle(KAIRO_INVOKE.skillsGetRegistry, async () => {
    return skillsManager.getRegistrySources();
  });

  ipcMain.handle(KAIRO_INVOKE.skillsSetRegistry, async (_, entries) => {
    try {
      const payload = Array.isArray(entries) ? entries : [];
      await skillsManager.saveRegistrySources(payload);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(KAIRO_INVOKE.skillsPrepareInstall, async (_, args) => {
    try {
      const payload = typeof args === 'object' && args ? args : { id: '', scope: 'public' };
      return await skillsManager.prepareStoreSkillInstall({
        id: typeof payload.id === 'string' ? payload.id : '',
        scope: typeof payload.scope === 'string' ? payload.scope : 'public',
        marketplaceQuery: typeof payload.marketplaceQuery === 'object' && payload.marketplaceQuery
          ? payload.marketplaceQuery
          : undefined
      });
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Unknown error');
    }
  });

  ipcMain.handle(KAIRO_INVOKE.skillsInstall, async (_, args) => {
    try {
      const payload = typeof args === 'object' && args ? args : { requestId: '' };
      await skillsManager.installStoreSkill({
        requestId: typeof payload.requestId === 'string' ? payload.requestId : ''
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(KAIRO_INVOKE.skillsDiscardInstall, async (_, args) => {
    try {
      const payload = typeof args === 'object' && args ? args : { requestId: '' };
      await skillsManager.discardPreparedInstall({
        requestId: typeof payload.requestId === 'string' ? payload.requestId : ''
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(KAIRO_INVOKE.skillsImport, async (_, args) => {
    try {
      const payload = typeof args === 'object' && args ? args : { sourceFile: '', scope: 'public' };
      await skillsManager.importSkill({
        sourceFile: typeof payload.sourceFile === 'string' ? payload.sourceFile : '',
        scope: typeof payload.scope === 'string' ? payload.scope : 'public'
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
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
