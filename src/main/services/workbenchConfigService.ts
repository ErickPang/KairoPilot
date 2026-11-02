import fs from 'node:fs';
import path from 'node:path';
import type { AgentConfig, TaskExecutionSettings, WorkbenchConfig,WorkbenchSettingsInput } from '../../shared/contracts';
import { applyExecutionProfileConstraints } from '../../shared/contracts';
import { readKairoPilotConfig, saveKairoPilotConfig } from '../store/configRepository';
import { providerToModelConfig } from '../store/configModelPersistence';
import { splitAgentModel } from '../store/configModelUtils';
import { WORKBENCH_OWNER } from '../store/configWorkbench';
import {readAgentsDirectory,writeAgentsFile,instructionHash} from '../core/instructions/agents';
import { assertWorkbenchIdle } from './workbenchExecution';
import { clearSessionApprovalGrants } from '../store/approvalGrants';

export function getWorkbenchConfig(): WorkbenchConfig {
 const config=readKairoPilotConfig().workbench!;const source=readAgentsDirectory(config.instructionRoot||config.managementRoot,'global');
 const instructions=source?.content||'';
 return {...config,instructions,instructionsHash:instructionHash(instructions),instructionPath:source?.path||path.join(config.instructionRoot||config.managementRoot,'AGENTS.md')};
}
export function strictTaskModel(binding: string) {
  const parsed = splitAgentModel(binding);
  const provider = parsed ? readKairoPilotConfig().models.providers[parsed.providerKey] : undefined;
  if (!parsed || !provider || !provider.model.some(item => item.id === parsed.modelId)) throw new Error('Task model is unavailable. Select a configured model.');
  return providerToModelConfig(parsed.providerKey,provider,parsed.modelId);
}
export function workbenchAgent(settings?: TaskExecutionSettings, sessionId?: string): AgentConfig {
  const config = getWorkbenchConfig();
  const policy = settings?.permissions || config.permissions;
  const permissions = applyExecutionProfileConstraints(structuredClone(policy));
  permissions.fileSystem.read &&= config.permissions.fileSystem.read;
  permissions.fileSystem.write &&= config.permissions.fileSystem.write;
  permissions.network.enabled &&= config.permissions.network.enabled;
  permissions.shell.enabled &&= config.permissions.shell.enabled;
  permissions.shell.allowedCommands = permissions.shell.allowedCommands.filter(item => config.permissions.shell.allowedCommands.includes(item));
  permissions.network.allowedDomains = permissions.network.allowedDomains.includes('*') ? [...config.permissions.network.allowedDomains] : permissions.network.allowedDomains.filter(item => config.permissions.network.allowedDomains.includes('*') || config.permissions.network.allowedDomains.includes(item));
  if (permissions.network.allowedDomains.length === 0) permissions.network.enabled = false;
  const globalMode=config.permissions.policy.approvalMode;
  const taskMode=permissions.policy.approvalMode;
  permissions.policy.approvalMode = globalMode==='never' ? taskMode : taskMode==='never' ? globalMode : taskMode===globalMode ? taskMode : 'always';
  permissions.policy.redactSensitiveOutput ||= config.permissions.policy.redactSensitiveOutput;
  const classes=['public','project','sensitive'] as const;
  permissions.policy.dataClass=classes[Math.max(classes.indexOf(permissions.policy.dataClass),classes.indexOf(config.permissions.policy.dataClass))];
  const root = config.managementRoot;
  const instructionRoot=config.instructionRoot||config.managementRoot;
  const source=readAgentsDirectory(instructionRoot,'global');
  return {id:sessionId?`task:${sessionId}`:WORKBENCH_OWNER,name:'KairoPilot',workspace:root,model:settings?.model??config.defaultModel,permissions,instructionRoot,systemPrompt:source?.content||'',instructionSources:source?[{path:source.path,hash:source.hash,scope:source.scope}]:[]};
}
export function saveWorkbenchConfig(value: WorkbenchSettingsInput) {
  assertWorkbenchIdle();
  if (value.defaultModel) strictTaskModel(value.defaultModel);
  const config = readKairoPilotConfig(); const current = config.workbench!;
  const {instructions,...settings}=value;
  const globalRoot=current.instructionRoot||current.managementRoot;
  const source=readAgentsDirectory(globalRoot,'global');
   const name=source?.path.endsWith('AGENTS.override.md')?'AGENTS.override.md':'AGENTS.md';
  const file=path.join(globalRoot,name);const previous=fs.existsSync(file)?fs.readFileSync(file,'utf8'):undefined;
  try {
    writeAgentsFile(globalRoot,instructions,name);
    config.workbench={...current,...settings,instructions:'',version:2};saveKairoPilotConfig(config);
    if (JSON.stringify(current.permissions)!==JSON.stringify(config.workbench.permissions)) clearSessionApprovalGrants();

  }catch(error){if(previous!==undefined)writeAgentsFile(globalRoot,previous,name);else if(fs.existsSync(file))fs.unlinkSync(file);throw error;}
}
