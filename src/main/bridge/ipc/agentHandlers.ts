import { ipcMain } from 'electron';
import { queryAuditLogs } from '../../store/audit';
import { getAgents, setActiveAgentId } from '../../store/config';
import { ensureActiveSession } from '../../store/chat';
import { skillsManager } from '../../core/skills/manager';
import { ensureAgentRuntime, resolveAgentConfig } from '../../assistant/agentRuntime';
import { KAIRO_INVOKE } from '../../../shared/ipc';
import { SkillSummary } from '../../../shared/contracts';
import {
  createRuntimeUpdateForwarder,
  mapRuntimeExecutionResult,
  mapUnknownError,
  persistAgentSessionHistory,
  resolveRuntimeForApproval,
  resolveRuntimeForRun,
  runActiveAgentChat
} from './agentHandlerService';

function registerAgentHandlers() {
  ipcMain.handle(KAIRO_INVOKE.agentInit, async (event, configOrId) => {
    try {
      const config = await resolveAgentConfig(configOrId);

      if (typeof configOrId === 'string') {
        setActiveAgentId(configOrId);
        ensureActiveSession(configOrId);
      }

      await ensureAgentRuntime(config, event.sender);
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
    let agent:
      | {
          getSessionHistory: () => import('../../core/llm/types').ChatMessage[];
          resumeRun: (approvalId: string, approved: boolean, onUpdate?: (update: import('../../core/agent/runEngine').RuntimeUpdate) => void) => Promise<import('../../core/agent/runEngine').RuntimeExecutionResult>;
        }
      | undefined;
    let sessionId: string | undefined;
    try {
      const resolved = await resolveRuntimeForApproval(id, event.sender);
      agent = resolved.agent;
      sessionId = resolved.approval?.sessionId;
      const result = await agent.resumeRun(id, approved, createRuntimeUpdateForwarder(event.sender, sessionId));
      return mapRuntimeExecutionResult(result);
    } catch (error) {
      return { success: false, error: mapUnknownError(error) };
    } finally {
      if (agent && sessionId) {
        persistAgentSessionHistory(agent, sessionId);
      }
    }
  });

  ipcMain.handle(KAIRO_INVOKE.agentPauseRun, async (event, args) => {
    try {
      const payload = typeof args === 'object' && args ? args : { runId: '' };
      const { agent } = await resolveRuntimeForRun(typeof payload.runId === 'string' ? payload.runId : '', event.sender);
      await agent.pauseRun(typeof payload.runId === 'string' ? payload.runId : '');
      return { success: true };
    } catch (error) {
      return { success: false, error: mapUnknownError(error) };
    }
  });

  ipcMain.handle(KAIRO_INVOKE.agentCancelRun, async (event, args) => {
    let agent:
      | {
          getSessionHistory: () => import('../../core/llm/types').ChatMessage[];
          cancelRun: (runId: string) => Promise<void>;
        }
      | undefined;
    let sessionId: string | undefined;
    try {
      const payload = typeof args === 'object' && args ? args : { runId: '' };
      const runId = typeof payload.runId === 'string' ? payload.runId : '';
      const resolved = await resolveRuntimeForRun(runId, event.sender);
      agent = resolved.agent;
      sessionId = resolved.run.sessionId;
      await agent.cancelRun(runId);
      return { success: true };
    } catch (error) {
      return { success: false, error: mapUnknownError(error) };
    } finally {
      if (agent && sessionId) {
        persistAgentSessionHistory(agent, sessionId);
      }
    }
  });

  ipcMain.handle(KAIRO_INVOKE.agentResumeRun, async (event, args) => {
    let agent:
      | {
          getSessionHistory: () => import('../../core/llm/types').ChatMessage[];
          resumeInterruptedRun: (runId: string, onUpdate?: (update: import('../../core/agent/runEngine').RuntimeUpdate) => void) => Promise<import('../../core/agent/runEngine').RuntimeExecutionResult>;
        }
      | undefined;
    let sessionId: string | undefined;
    try {
      const payload = typeof args === 'object' && args ? args : { runId: '' };
      const runId = typeof payload.runId === 'string' ? payload.runId : '';
      const resolved = await resolveRuntimeForRun(runId, event.sender);
      agent = resolved.agent;
      sessionId = resolved.run.sessionId;
      const result = await agent.resumeInterruptedRun(runId, createRuntimeUpdateForwarder(event.sender, sessionId));
      return mapRuntimeExecutionResult(result);
    } catch (error) {
      return { success: false, error: mapUnknownError(error) };
    } finally {
      if (agent && sessionId) {
        persistAgentSessionHistory(agent, sessionId);
      }
    }
  });

  ipcMain.handle(KAIRO_INVOKE.agentRetryStep, async (event, args) => {
    let agent:
      | {
          getSessionHistory: () => import('../../core/llm/types').ChatMessage[];
          retryStep: (runId: string, stepId: string, onUpdate?: (update: import('../../core/agent/runEngine').RuntimeUpdate) => void) => Promise<import('../../core/agent/runEngine').RuntimeExecutionResult>;
        }
      | undefined;
    let sessionId: string | undefined;
    try {
      const payload = typeof args === 'object' && args ? args : { runId: '', stepId: '' };
      const runId = typeof payload.runId === 'string' ? payload.runId : '';
      const stepId = typeof payload.stepId === 'string' ? payload.stepId : '';
      const resolved = await resolveRuntimeForRun(runId, event.sender);
      agent = resolved.agent;
      sessionId = resolved.run.sessionId;
      const result = await agent.retryStep(runId, stepId, createRuntimeUpdateForwarder(event.sender, sessionId));
      return mapRuntimeExecutionResult(result);
    } catch (error) {
      return { success: false, error: mapUnknownError(error) };
    } finally {
      if (agent && sessionId) {
        persistAgentSessionHistory(agent, sessionId);
      }
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
    try {
      return await runActiveAgentChat(message, event.sender);
    } catch (error) {
      console.error('Agent chat error:', error);
      return { success: false, error: mapUnknownError(error) };
    }
  });
}

export { registerAgentHandlers };
