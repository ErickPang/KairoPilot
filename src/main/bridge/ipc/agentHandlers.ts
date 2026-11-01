import { ipcMain } from 'electron';
import { queryAuditLogs } from '../../store/audit';
import { createActiveAgentSession,getActiveAgentSession } from '../../services/chatService';
import { skillsManager } from '../../core/skills/manager';
import { KAIRO_INVOKE } from '../../../shared/ipc';
import {
  createRuntimeUpdateForwarder,
  mapRuntimeHandlerFailure,
  runStoredAgentAction,
  runApprovalResponse,
  controlStoredRun,
  runActiveAgentChat
} from './agentHandlerService';
import { parseIpcInput } from './configValidation';
import {
  SkillImportInputSchema,
  SkillMarketplaceQueryInputSchema,
  SkillPrepareInstallInputSchema,
  SkillRequestInputSchema,
  SkillRollbackInputSchema,
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
  ipcMain.handle(KAIRO_INVOKE.workbenchInit, async () => {
    if (!getActiveAgentSession()) createActiveAgentSession('New Chat');
    return ipcSuccess();
  });

  ipcMain.handle(KAIRO_INVOKE.agentConfirmResponse, async (event, input) => {
    try {
      const payload = parseIpcInput(ApprovalResponseInputSchema, input, 'approval response');
      return await runApprovalResponse(payload.id, payload.approved, event.sender);
    } catch (error) { return mapRuntimeHandlerFailure(error); }
  });

  ipcMain.handle(KAIRO_INVOKE.agentPauseRun, async (event, input) => {
    try {
      const { runId } = parseIpcInput(RunIdInputSchema, input, 'run pause request');
      await controlStoredRun(runId, 'pause', event.sender);
      return ipcSuccess();
    } catch (error) { return mapRuntimeHandlerFailure(error); }
  });

  ipcMain.handle(KAIRO_INVOKE.agentCancelRun, async (event, input) => {
    try {
      const { runId } = parseIpcInput(RunIdInputSchema, input, 'run cancel request');
      await controlStoredRun(runId, 'cancel', event.sender);
      return ipcSuccess();
    } catch (error) { return mapRuntimeHandlerFailure(error); }
  });

  ipcMain.handle(KAIRO_INVOKE.agentResumeRun, async (event, input) => {
    try {
      const { runId } = parseIpcInput(RunIdInputSchema, input, 'run resume request');
      return await runStoredAgentAction(runId, event.sender, (agent) => agent.resumeInterruptedRun(runId, createRuntimeUpdateForwarder(event.sender)));
    } catch (error) { return mapRuntimeHandlerFailure(error); }
  });

  ipcMain.handle(KAIRO_INVOKE.agentRetryStep, async (event, input) => {
    try {
      const { runId, stepId } = parseIpcInput(RetryStepInputSchema, input, 'run retry request');
      return await runStoredAgentAction(runId, event.sender, (agent) => agent.retryStep(runId, stepId, createRuntimeUpdateForwarder(event.sender)));
    } catch (error) { return mapRuntimeHandlerFailure(error); }
  });

  ipcMain.handle(KAIRO_INVOKE.auditGet, async (_, query) => {
    const payload = parseIpcInput(AuditLogQueryInputSchema, query, 'audit log query');
    return queryAuditLogs(payload);
  });

  ipcMain.handle(KAIRO_INVOKE.skillsGetAll, async () => {
    return { public: await skillsManager.listPublicSkills(), workbench: await skillsManager.listAgentSkills('workbench') };
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

  ipcMain.handle(KAIRO_INVOKE.skillsRollback, async (_, args) => {
    try {
      const payload = parseIpcInput(SkillRollbackInputSchema, args, 'skill rollback request');
      await skillsManager.rollbackSkill({
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
