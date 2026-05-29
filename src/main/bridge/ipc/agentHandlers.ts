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
  mapRuntimeHandlerFailure,
  persistAgentSessionHistory,
  resolveRuntimeForApproval,
  resolveRuntimeForRun,
  runActiveAgentChat
} from './agentHandlerService';
import { AgentInitInputSchema, parseIpcInput } from './configValidation';
import {
  SkillImportInputSchema,
  SkillMarketplaceQueryInputSchema,
  SkillPrepareInstallInputSchema,
  SkillRequestInputSchema,
  SkillsRegistryInputSchema,
  SkillUninstallInputSchema
} from './skillPluginValidation';
import {
  ApprovalResponseInputSchema,
  AuditLogQueryInputSchema,
  RetryStepInputSchema,
  RunIdInputSchema
} from './chatSystemValidation';
import { ipcFailure, ipcSuccess } from './ipcResult';

function registerAgentHandlers() {
  ipcMain.handle(KAIRO_INVOKE.agentInit, async (event, configOrId) => {
    try {
      const payload = parseIpcInput(AgentInitInputSchema, configOrId, 'agent init request');
      const config = await resolveAgentConfig(payload);

      if (typeof payload === 'string') {
        setActiveAgentId(payload);
        ensureActiveSession(payload);
      }

      await ensureAgentRuntime(config, event.sender);
      return ipcSuccess();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (!message.startsWith('Model not found for agent model:')) {
        console.error('Failed to init agent:', error);
      }
      return ipcFailure(message);
    }
  });

  ipcMain.handle(KAIRO_INVOKE.agentConfirmResponse, async (event, input) => {
    let agent:
      | {
          getSessionHistory: () => import('../../core/llm/types').ChatMessage[];
          resumeRun: (approvalId: string, approved: boolean, onUpdate?: (update: import('../../core/agent/runEngine').RuntimeUpdate) => void) => Promise<import('../../core/agent/runEngine').RuntimeExecutionResult>;
        }
      | undefined;
    let sessionId: string | undefined;
    try {
      const payload = parseIpcInput(ApprovalResponseInputSchema, input, 'approval response');
      const resolved = await resolveRuntimeForApproval(payload.id, event.sender);
      agent = resolved.agent;
      sessionId = resolved.approval?.sessionId;
      const result = await agent.resumeRun(payload.id, payload.approved, createRuntimeUpdateForwarder(event.sender, sessionId));
      return mapRuntimeExecutionResult(result);
    } catch (error) {
      return mapRuntimeHandlerFailure(error);
    } finally {
      if (agent && sessionId) {
        persistAgentSessionHistory(agent, sessionId);
      }
    }
  });

  ipcMain.handle(KAIRO_INVOKE.agentPauseRun, async (event, args) => {
    try {
      const payload = parseIpcInput(RunIdInputSchema, args, 'run pause request');
      const { agent } = await resolveRuntimeForRun(payload.runId, event.sender);
      await agent.pauseRun(payload.runId);
      return ipcSuccess();
    } catch (error) {
      return mapRuntimeHandlerFailure(error);
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
      const payload = parseIpcInput(RunIdInputSchema, args, 'run cancel request');
      const runId = payload.runId;
      const resolved = await resolveRuntimeForRun(runId, event.sender);
      agent = resolved.agent;
      sessionId = resolved.run.sessionId;
      await agent.cancelRun(runId);
      return ipcSuccess();
    } catch (error) {
      return mapRuntimeHandlerFailure(error);
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
      const payload = parseIpcInput(RunIdInputSchema, args, 'run resume request');
      const runId = payload.runId;
      const resolved = await resolveRuntimeForRun(runId, event.sender);
      agent = resolved.agent;
      sessionId = resolved.run.sessionId;
      const result = await agent.resumeInterruptedRun(runId, createRuntimeUpdateForwarder(event.sender, sessionId));
      return mapRuntimeExecutionResult(result);
    } catch (error) {
      return mapRuntimeHandlerFailure(error);
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
      const payload = parseIpcInput(RetryStepInputSchema, args, 'run retry request');
      const { runId, stepId } = payload;
      const resolved = await resolveRuntimeForRun(runId, event.sender);
      agent = resolved.agent;
      sessionId = resolved.run.sessionId;
      const result = await agent.retryStep(runId, stepId, createRuntimeUpdateForwarder(event.sender, sessionId));
      return mapRuntimeExecutionResult(result);
    } catch (error) {
      return mapRuntimeHandlerFailure(error);
    } finally {
      if (agent && sessionId) {
        persistAgentSessionHistory(agent, sessionId);
      }
    }
  });

  ipcMain.handle(KAIRO_INVOKE.auditGet, async (_, query) => {
    const payload = parseIpcInput(AuditLogQueryInputSchema, query, 'audit log query');
    return queryAuditLogs(payload);
  });

  ipcMain.handle(KAIRO_INVOKE.skillsGetAll, async () => {
    const agents = getAgents();
    const result: Record<string, SkillSummary[]> = {};
    result.public = await skillsManager.listPublicSkills();
    const agentSkillEntries = await Promise.all(agents.map(async (agent) => ([
      agent.id,
      await skillsManager.listAgentSkills(agent.id)
    ] as const)));
    for (const [agentId, agentSkills] of agentSkillEntries) {
      result[agentId] = agentSkills;
    }
    return result;
  });

  ipcMain.handle(KAIRO_INVOKE.skillsGetStore, async () => {
    return skillsManager.getStoreSkills();
  });

  ipcMain.handle(KAIRO_INVOKE.skillsGetStoreByQuery, async (_, query) => {
    const payload = typeof query === 'undefined'
      ? { kind: 'curated' as const }
      : parseIpcInput(SkillMarketplaceQueryInputSchema, query, 'skill marketplace query');
    return skillsManager.getStoreSkills(
      payload.kind === 'registry'
        ? { kind: 'registry', url: payload.url }
        : { kind: 'curated' }
    );
  });

  ipcMain.handle(KAIRO_INVOKE.skillsGetRegistry, async () => {
    return skillsManager.getRegistrySources();
  });

  ipcMain.handle(KAIRO_INVOKE.skillsSetRegistry, async (_, entries) => {
    try {
      const payload = parseIpcInput(SkillsRegistryInputSchema, entries, 'skills registry');
      await skillsManager.saveRegistrySources(payload);
      return ipcSuccess();
    } catch (error) {
      return ipcFailure(error);
    }
  });

  ipcMain.handle(KAIRO_INVOKE.skillsPrepareInstall, async (_, args) => {
    try {
      const payload = parseIpcInput(SkillPrepareInstallInputSchema, args, 'skill install review request');
      return await skillsManager.prepareStoreSkillInstall({
        id: payload.id,
        scope: payload.scope,
        marketplaceQuery: payload.marketplaceQuery
      });
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Unknown error');
    }
  });

  ipcMain.handle(KAIRO_INVOKE.skillsInstall, async (_, args) => {
    try {
      const payload = parseIpcInput(SkillRequestInputSchema, args, 'skill install request');
      await skillsManager.installStoreSkill({
        requestId: payload.requestId
      });
      return ipcSuccess();
    } catch (error) {
      return ipcFailure(error);
    }
  });

  ipcMain.handle(KAIRO_INVOKE.skillsDiscardInstall, async (_, args) => {
    try {
      const payload = parseIpcInput(SkillRequestInputSchema, args, 'skill discard request');
      await skillsManager.discardPreparedInstall({
        requestId: payload.requestId
      });
      return ipcSuccess();
    } catch (error) {
      return ipcFailure(error);
    }
  });

  ipcMain.handle(KAIRO_INVOKE.skillsImport, async (_, args) => {
    try {
      const payload = parseIpcInput(SkillImportInputSchema, args, 'skill import request');
      await skillsManager.importSkill({
        sourceFile: payload.sourceFile,
        scope: payload.scope
      });
      return ipcSuccess();
    } catch (error) {
      return ipcFailure(error);
    }
  });

  ipcMain.handle(KAIRO_INVOKE.skillsUninstall, async (_, args) => {
    try {
      const payload = parseIpcInput(SkillUninstallInputSchema, args, 'skill uninstall request');
      await skillsManager.uninstallSkill({
        id: payload.id,
        scope: payload.scope
      });
      return ipcSuccess();
    } catch (error) {
      return ipcFailure(error);
    }
  });

  ipcMain.handle(KAIRO_INVOKE.agentChat, async (event, message) => {
    try {
      return await runActiveAgentChat(message, event.sender);
    } catch (error) {
      console.error('Agent chat error:', error);
      return mapRuntimeHandlerFailure(error);
    }
  });
}

export { registerAgentHandlers };
