import { ipcMain } from 'electron';
import { queryAuditLogs } from '../../store/audit';
import { getActiveAgentId, getAgents, setActiveAgentId } from '../../store/config';
import { ensureActiveSession, getApprovalRecord, getRunById, updateSessionMessages } from '../../store/chat';
import { skillsManager } from '../../core/skills/manager';
import { ensureAgentRuntime, getAgentRuntime, initializeAgent, resolveAgentConfig } from '../../assistant/agentRuntime';
import { KAIRO_EVENT, KAIRO_INVOKE } from '../../../shared/ipc';
import { SkillSummary } from '../../../shared/contracts';

async function resolveRuntimeForRun(runId: string, sender: Electron.WebContents) {
  const run = getRunById(runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  let agent = getAgentRuntime(run.agentId);
  if (agent) {
    return { agent, run };
  }

  const config = await resolveAgentConfig(run.agentId);
  agent = await ensureAgentRuntime(config, sender);
  if (!agent) {
    throw new Error('Agent initialization failed.');
  }

  return { agent, run };
}

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

  ipcMain.handle(KAIRO_INVOKE.agentConfirmResponse, async (event, { id, approved }) => {
    const activeAgentId = getActiveAgentId();
    if (!activeAgentId) {
      return { success: false, error: 'Agent not initialized. Please configure settings first.' };
    }

    let agent = getAgentRuntime(activeAgentId);
    try {
      const config = await resolveAgentConfig(activeAgentId);
      agent = await ensureAgentRuntime(config, event.sender);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Agent not initialized. Please configure settings first.' };
    }

    if (!agent) {
      return { success: false, error: 'Agent initialization failed.' };
    }

    try {
      const approval = getApprovalRecord(id);
      const result = await agent.resumeRun(id, approved, (update) => {
        event.sender.send(KAIRO_EVENT.agentUpdate, update);
      });
      const sessionId = approval?.sessionId;
      if (sessionId) {
        updateSessionMessages(sessionId, agent.getHistory());
      }
      return {
        success: true,
        content: result.content,
        error: result.error,
        status: result.status,
        runId: result.runId,
        approvalId: result.approvalId
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(KAIRO_INVOKE.agentPauseRun, async (event, args) => {
    try {
      const payload = typeof args === 'object' && args ? args : { runId: '' };
      const { agent } = await resolveRuntimeForRun(typeof payload.runId === 'string' ? payload.runId : '', event.sender);
      await agent.pauseRun(typeof payload.runId === 'string' ? payload.runId : '');
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(KAIRO_INVOKE.agentCancelRun, async (event, args) => {
    try {
      const payload = typeof args === 'object' && args ? args : { runId: '' };
      const runId = typeof payload.runId === 'string' ? payload.runId : '';
      const { agent, run } = await resolveRuntimeForRun(runId, event.sender);
      await agent.cancelRun(runId);
      if (run.sessionId) {
        updateSessionMessages(run.sessionId, agent.getHistory());
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(KAIRO_INVOKE.agentResumeRun, async (event, args) => {
    try {
      const payload = typeof args === 'object' && args ? args : { runId: '' };
      const runId = typeof payload.runId === 'string' ? payload.runId : '';
      const { agent, run } = await resolveRuntimeForRun(runId, event.sender);
      const result = await agent.resumeInterruptedRun(runId, (update) => {
        event.sender.send(KAIRO_EVENT.agentUpdate, update);
      });
      if (run.sessionId) {
        updateSessionMessages(run.sessionId, agent.getHistory());
      }
      return {
        success: true,
        content: result.content,
        error: result.error,
        status: result.status,
        runId: result.runId,
        approvalId: result.approvalId
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(KAIRO_INVOKE.agentRetryStep, async (event, args) => {
    try {
      const payload = typeof args === 'object' && args ? args : { runId: '', stepId: '' };
      const runId = typeof payload.runId === 'string' ? payload.runId : '';
      const stepId = typeof payload.stepId === 'string' ? payload.stepId : '';
      const { agent, run } = await resolveRuntimeForRun(runId, event.sender);
      const result = await agent.retryStep(runId, stepId, (update) => {
        event.sender.send(KAIRO_EVENT.agentUpdate, update);
      });
      if (run.sessionId) {
        updateSessionMessages(run.sessionId, agent.getHistory());
      }
      return {
        success: true,
        content: result.content,
        error: result.error,
        status: result.status,
        runId: result.runId,
        approvalId: result.approvalId
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
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
    try {
      const config = await resolveAgentConfig(activeAgentId);
      agent = await ensureAgentRuntime(config, event.sender);
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Agent not initialized. Please configure settings first.' };
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
        if (update.type === 'approval-required') {
          event.sender.send(KAIRO_EVENT.agentAskConfirmation, {
            id: update.approvalId,
            tool: update.tool,
            args: update.args,
            sessionId: session.id,
            runId: update.runId,
            riskLevel: update.riskLevel,
            approvalMode: update.approvalMode,
            policyTags: update.policyTags,
            redacted: update.redacted
          });
        }
        event.sender.send(KAIRO_EVENT.agentUpdate, update);
      }, { sessionId: session.id, agentId: activeAgentId });
      updateSessionMessages(session.id, agent.getHistory());
      return {
        content: response.content,
        error: response.error,
        status: response.status,
        runId: response.runId,
        approvalId: response.approvalId
      };
    } catch (error) {
      console.error('Agent chat error:', error);
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}

export { registerAgentHandlers };
