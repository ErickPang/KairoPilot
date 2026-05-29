import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AgentConfig, LegacyAgentConfig } from '../../shared/contracts';
import { DEFAULT_CONFIG } from './configDefaults';
import { buildAgentWorkspacePath, normalizeWorkspaceName } from './configPaths';
import { getFirstProviderKey, splitAgentModel } from './configModelUtils';
import {
  buildAgentModel,
  getProviderDefaultModelId
} from './configModelPersistence';
import { getModelForAgent } from './configModels';
import { AGENT_FILE_NAMES, buildDefaultKairopilotTemplate, ensureAgentPromptFields } from './configPromptTemplates';
import { normalizeAgentPermissions } from './configPermissionUtils';
import { readKairoPilotConfig, saveKairoPilotConfig } from './configRepository';
import { ensureAgentWorkspaceAndPrompt } from './configWorkspace';

export function createAgentDraft(seed?: Partial<AgentConfig>): AgentConfig {
  const name = (seed?.name || 'New Agent').trim() || 'New Agent';
  const id = (seed?.id || '').trim() || Math.random().toString(36).slice(2, 12);
  const workspaceName = id === 'mainAgent'
    ? undefined
    : normalizeWorkspaceName(seed?.workspaceName ?? name);
  const workspace = buildAgentWorkspacePath(id, workspaceName);
  const draft: AgentConfig = {
    id,
    name,
    workspace,
    workspaceName,
    systemPrompt: '',
    identityPrompt: '',
    userPrompt: '',
    soulPrompt: '',
    model: seed?.model || '',
    permissions: normalizeAgentPermissions(seed)
  };
  ensureAgentPromptFields(draft);
  return draft;
}

export function getAgents(): AgentConfig[] {
  const config = readKairoPilotConfig();
  return config.agents.list.map(agent => {
    if (agent.workspace) {
      const promptFiles: Array<{ fileName: string; apply: (value: string) => void }> = [
        { fileName: AGENT_FILE_NAMES.kairopilot, apply: (value) => { agent.systemPrompt = value; } },
        { fileName: AGENT_FILE_NAMES.identity, apply: (value) => { agent.identityPrompt = value; } },
        { fileName: AGENT_FILE_NAMES.user, apply: (value) => { agent.userPrompt = value; } },
        { fileName: AGENT_FILE_NAMES.soul, apply: (value) => { agent.soulPrompt = value; } }
      ];
      for (const item of promptFiles) {
        const filePath = path.join(agent.workspace, item.fileName);
        if (!fs.existsSync(filePath)) {
          continue;
        }
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          if (content.trim()) {
            item.apply(content);
          }
        } catch (e) {
          console.error(`Failed to read ${item.fileName} for agent ${agent.id}:`, e);
        }
      }
    }
    ensureAgentPromptFields(agent);
    return agent;
  });
}

export function getAgent(id: string): AgentConfig | undefined {
  return getAgents().find(a => a.id === id);
}

export function deleteAgentWorkspace(agent: AgentConfig) {
  const workspacePath = typeof agent.workspace === 'string' ? agent.workspace.trim() : '';
  if (!workspacePath) {
    return false;
  }

  const resolvedWorkspacePath = path.resolve(workspacePath);
  const protectedPaths = new Set([
    path.resolve(os.homedir()),
    path.resolve(path.parse(resolvedWorkspacePath).root),
    path.resolve(path.join(os.homedir(), '.kairopilot'))
  ]);

  if (protectedPaths.has(resolvedWorkspacePath)) {
    return false;
  }

  const isSharedWithOtherAgents = getAgents().some((item) => (
    item.id !== agent.id
    && typeof item.workspace === 'string'
    && item.workspace.trim().length > 0
    && path.resolve(item.workspace) === resolvedWorkspacePath
  ));
  if (isSharedWithOtherAgents || !fs.existsSync(resolvedWorkspacePath)) {
    return false;
  }

  fs.rmSync(resolvedWorkspacePath, { recursive: true, force: true });
  return true;
}

export function saveAgent(agent: AgentConfig) {
  const config = readKairoPilotConfig();
  const nextAgent = { ...agent };
  const firstProviderKey = getFirstProviderKey(config);
  if (!firstProviderKey || !config.models.providers[firstProviderKey]) {
    nextAgent.model = '';
  } else {
    const parsedModel = splitAgentModel(nextAgent.model);
    const providerKey = parsedModel?.providerKey && config.models.providers[parsedModel.providerKey]
      ? parsedModel.providerKey
      : firstProviderKey;
    const provider = config.models.providers[providerKey];
    const nextModelId = parsedModel?.modelId && provider.model.some(item => item.id === parsedModel.modelId)
      ? parsedModel.modelId
      : getProviderDefaultModelId(provider);
    nextAgent.model = buildAgentModel(providerKey, nextModelId);
  }

  if (nextAgent.id === 'mainAgent') {
    nextAgent.workspace = path.join(os.homedir(), '.kairopilot', 'workspace');
    nextAgent.workspaceName = undefined;
  } else if (nextAgent.workspaceName !== undefined) {
    nextAgent.workspace = buildAgentWorkspacePath(nextAgent.id, nextAgent.workspaceName);
  }
  nextAgent.permissions = normalizeAgentPermissions(nextAgent);

  if (nextAgent.workspace) {
    try {
      ensureAgentPromptFields(nextAgent);
      ensureAgentWorkspaceAndPrompt(nextAgent);
      const promptFiles: Array<{ fileName: string; content: string }> = [
        { fileName: AGENT_FILE_NAMES.kairopilot, content: nextAgent.systemPrompt },
        { fileName: AGENT_FILE_NAMES.identity, content: nextAgent.identityPrompt },
        { fileName: AGENT_FILE_NAMES.user, content: nextAgent.userPrompt },
        { fileName: AGENT_FILE_NAMES.soul, content: nextAgent.soulPrompt }
      ];
      for (const item of promptFiles) {
        fs.writeFileSync(path.join(nextAgent.workspace, item.fileName), item.content, 'utf-8');
      }
    } catch (e) {
      console.error(`Failed to write workspace prompt files for agent ${nextAgent.id}:`, e);
    }
  }

  const index = config.agents.list.findIndex(a => a.id === nextAgent.id);
  if (index !== -1) {
    config.agents.list[index] = nextAgent;
  } else {
    config.agents.list.push(nextAgent);
  }
  saveKairoPilotConfig(config);
}

export function deleteAgent(id: string) {
  if (id === 'mainAgent') {
    throw new Error('Main Agent cannot be deleted');
  }
  const config = readKairoPilotConfig();
  config.agents.list = config.agents.list.filter(a => a.id !== id);
  if (config.agents.activeAgentId === id && config.agents.list.length > 0) {
    config.agents.activeAgentId = config.agents.list[0].id;
  }
  saveKairoPilotConfig(config);
}

export function getActiveAgentId(): string {
  return readKairoPilotConfig().agents.activeAgentId;
}

export function setActiveAgentId(id: string) {
  const config = readKairoPilotConfig();
  if (config.agents.list.some(a => a.id === id)) {
    config.agents.activeAgentId = id;
    saveKairoPilotConfig(config);
  }
}

export function getAgentConfig(): LegacyAgentConfig {
  const config = readKairoPilotConfig();
  const agents = getAgents();
  const activeAgent = agents.find(a => a.id === config.agents.activeAgentId) || agents[0];
  const modelConfig = activeAgent ? getModelForAgent(activeAgent) : undefined;
  return {
    provider: modelConfig?.provider || 'openai',
    apiKey: modelConfig?.apiKey || '',
    baseUrl: modelConfig?.baseUrl || '',
    model: modelConfig?.model || 'gpt-4o',
    workspace: activeAgent?.workspace || '',
    systemPrompt: activeAgent?.systemPrompt || '',
    enableShell: activeAgent?.permissions.shell.enabled || false,
    enableNetwork: activeAgent?.permissions.network.enabled || false,
    enableFileSystemRead: activeAgent?.permissions.fileSystem.read || false,
    enableFileSystemWrite: activeAgent?.permissions.fileSystem.write || false,
    allowedPaths: activeAgent?.permissions.fileSystem.allowedPaths || [],
    allowedDomains: activeAgent?.permissions.network.allowedDomains || [],
    allowedCommands: activeAgent?.permissions.shell.allowedCommands || []
  };
}

export function saveAgentConfig(legacyConfig: LegacyAgentConfig) {
  const config = readKairoPilotConfig();
  const activeAgentIndex = config.agents.list.findIndex(a => a.id === config.agents.activeAgentId);
  if (activeAgentIndex === -1 && config.agents.list.length === 0) {
    saveKairoPilotConfig(DEFAULT_CONFIG);
    return;
  }

  const agent = config.agents.list[activeAgentIndex !== -1 ? activeAgentIndex : 0];
  const providerKey = splitAgentModel(agent.model)?.providerKey || getFirstProviderKey(config);
  const provider = providerKey ? config.models.providers[providerKey] : undefined;

  agent.workspace = legacyConfig.workspace;
  agent.systemPrompt = typeof legacyConfig.systemPrompt === 'string' && legacyConfig.systemPrompt.trim().length > 0
    ? legacyConfig.systemPrompt
    : buildDefaultKairopilotTemplate(agent);
  ensureAgentPromptFields(agent);
  if (agent.workspace) {
    try {
      ensureAgentWorkspaceAndPrompt(agent);
      fs.writeFileSync(path.join(agent.workspace, AGENT_FILE_NAMES.kairopilot), agent.systemPrompt, 'utf-8');
    } catch (e) {
      console.error(`Failed to write ${AGENT_FILE_NAMES.kairopilot} for agent ${agent.id}:`, e);
    }
  }
  agent.permissions = normalizeAgentPermissions({
    ...agent,
    permissions: legacyConfig.permissions,
    enableShell: legacyConfig.enableShell,
    enableNetwork: legacyConfig.enableNetwork,
    enableFileSystemRead: legacyConfig.enableFileSystemRead,
    enableFileSystemWrite: legacyConfig.enableFileSystemWrite,
    allowedPaths: legacyConfig.allowedPaths,
    allowedDomains: legacyConfig.allowedDomains,
    allowedCommands: legacyConfig.allowedCommands
  });
  agent.model = providerKey && provider ? buildAgentModel(providerKey, legacyConfig.model) : '';

  if (provider) {
    provider.provider = legacyConfig.provider;
    provider.apiKey = legacyConfig.apiKey.trim() || provider.apiKey;
    provider.baseUrl = legacyConfig.baseUrl;
    if (!provider.model.some(item => item.id === legacyConfig.model)) {
      provider.model.push({ id: legacyConfig.model, name: legacyConfig.model });
    }
  }

  saveKairoPilotConfig(config);
}
