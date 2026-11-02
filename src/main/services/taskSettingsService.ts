import {latestTaskPlan,updateTaskPlan} from '../store/taskPlans';
import {getTaskTemplate} from '../store/taskTemplates';
import fs from 'node:fs';
import path from 'node:path';
import type { SessionSummary, TaskExecutionSettings } from '../../shared/contracts';
import { createDefaultPolicyConfig } from '../../shared/contracts';
import { getDb } from '../store/chat';
import { getOwnedSessionSummary } from '../store/taskPages';
import { getWorkbenchConfig, strictTaskModel } from './workbenchConfigService';
import { assertTaskMutable } from './workbenchExecution';
import {intelligenceBudget} from '../../shared/intelligencePolicy';
import {clearSessionApprovalGrants} from '../store/approvalGrants';

export function requireTask(id: string) {
  const task = getOwnedSessionSummary(undefined,id);
  if (!task) throw new Error('Task not found in this workbench.');
  return task;
}
export function settingsForTask(task: SessionSummary): TaskExecutionSettings {
  if (task.executionSettings) return structuredClone(task.executionSettings);
  throw new Error('Task execution settings are missing. Create a new task.');
}
export function newTaskSettings(): TaskExecutionSettings {
  const config = getWorkbenchConfig();
  return {model:config.defaultModel,permissions:structuredClone(config.permissions)};
}
export function initializeIndependentDirectory(id: string) {
  const root = path.join(getWorkbenchConfig().managementRoot,'tasks',id);
  fs.mkdirSync(root,{recursive:true});
  getDb().prepare('UPDATE sessions SET execution_root=? WHERE id=? AND execution_root IS NULL').run(fs.realpathSync(root),id);
}
export function updateTaskSettings(id: string, value: {model?:string;executionProfile?:TaskExecutionSettings['permissions']['executionProfile'];delegation?:'off'|'auto'|'manual';intelligenceBudget?:TaskExecutionSettings['intelligenceBudget'];templateId?:string|null;workflow?:'direct'|'plan'}) {
  const task = requireTask(id); assertTaskMutable(id);
  const settings = settingsForTask(task);
  if(value.templateId!==undefined)settings.template=value.templateId===null?null:getTaskTemplate(value.templateId);
  if(value.delegation)settings.delegation=value.delegation;
  if(value.intelligenceBudget)settings.intelligenceBudget=intelligenceBudget(value.intelligenceBudget);
  if(value.workflow)settings.workflow=value.workflow;
  if (value.model !== undefined) { strictTaskModel(value.model); settings.model=value.model; }
  if (value.executionProfile) { settings.permissions={...structuredClone(getWorkbenchConfig().permissions),executionProfile:value.executionProfile,policy:createDefaultPolicyConfig(value.executionProfile)}; }
  getDb().prepare('UPDATE sessions SET execution_settings=? WHERE id=?').run(JSON.stringify(settings),id);
  if (JSON.stringify(settings.permissions)!==JSON.stringify(settingsForTask(task).permissions)) clearSessionApprovalGrants(id);
  if(JSON.stringify(settings)!==JSON.stringify(settingsForTask(task))) {
    const pending=latestTaskPlan(id);
    if(pending?.status==='pending')updateTaskPlan(pending.id,pending.revision,{status:'superseded'});
  }
  return requireTask(id);
}
