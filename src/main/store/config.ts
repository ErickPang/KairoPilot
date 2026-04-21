import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  type AgentConfig,
  type KairoPilotConfig,
  type LegacyAgentConfig,
  type ModelConfig,
  type PluginRegistryEntry,
  type ProviderConfig,
  type WebSearchConfig
} from '../../shared/contracts';
import { getPromptWorkspaceLayout } from '../workspace/layout';
import { DEFAULT_AGENT, DEFAULT_CONFIG } from './configDefaults';
import { buildAgentWorkspacePath, getConfigPath, normalizeWorkspaceName } from './configPaths';
import { getFirstProviderKey, isValidProviderKey, normalizeProvider, splitAgentModel } from './configModelUtils';
import { AGENT_FILE_NAMES, buildDefaultKairopilotTemplate, ensureAgentPromptFields } from './configPromptTemplates';
import { normalizeAgentPermissions } from './configPermissionUtils';
import { normalizeWebSearchConfig } from './configWebSearchUtils';

export type {
  AgentConfig,
  AgentPermissionConfig,
  KairoPilotConfig,
  LegacyAgentConfig,
  ModelConfig,
  PluginRegistryEntry,
  ProviderConfig,
  WebSearchConfig
} from '../../shared/contracts';

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

function getProviderDefaultModelId(provider: ProviderConfig): string {
  return provider.model[0]?.id || 'gpt-4o';
}

function buildAgentModel(providerKey: string, modelId: string): string {
  return `${providerKey}/${modelId}`;
}

function normalizeConfig(rawConfig: unknown): KairoPilotConfig {
  const config = rawConfig as Partial<KairoPilotConfig>;
  const rawProviders = config?.models?.providers;
  const providers: Record<string, ProviderConfig> = {};

  if (rawProviders && typeof rawProviders === 'object') {
    for (const [providerKey, providerValue] of Object.entries(rawProviders)) {
      if (!providerValue || typeof providerValue !== 'object') {
        continue;
      }
      providers[providerKey] = normalizeProvider(providerValue as ProviderConfig, providerKey);
    }
  }
  const providerEntries = Object.entries(providers);
  const [firstProviderEntry] = providerEntries;
  const shouldDropLegacyDefaultProvider = providerEntries.length === 1
    && firstProviderEntry?.[0] === 'openai'
    && firstProviderEntry[1].provider === 'openai'
    && firstProviderEntry[1].baseUrl === 'https://api.openai.com/v1'
    && firstProviderEntry[1].apiKey === ''
    && firstProviderEntry[1].model.length === 1
    && firstProviderEntry[1].model[0]?.id === 'gpt-4o'
    && firstProviderEntry[1].model[0]?.name === 'gpt-4o';
  if (shouldDropLegacyDefaultProvider) {
    delete providers.openai;
  }

  const normalized: KairoPilotConfig = {
    version: typeof config?.version === 'string' ? config.version : DEFAULT_CONFIG.version,
    models: {
      providers
    },
    agents: {
      activeAgentId: config?.agents?.activeAgentId || DEFAULT_AGENT.id,
      list: Array.isArray(config?.agents?.list) ? config.agents.list : []
    },
    plugins: {
      registry: Array.isArray(config?.plugins?.registry) ? config.plugins.registry : []
    },
    skills: {
      registry: Array.isArray(config?.skills?.registry) ? config.skills.registry : []
    },
    webSearch: normalizeWebSearchConfig(config?.webSearch)
  };

  if (normalized.agents.list.length === 0) {
    normalized.agents.list = [{ ...DEFAULT_AGENT }];
  }

  const firstProviderKey = getFirstProviderKey(normalized);
  normalized.agents.list = normalized.agents.list.map(agent => {
    const parsedModel = splitAgentModel((agent as { model?: string }).model);
    const legacyProviderKey = (agent as { providerKey?: string }).providerKey;
    const legacyModelId = (agent as { modelId?: string }).modelId;
    const providerKeyCandidate = parsedModel?.providerKey || legacyProviderKey;
    const providerKey = providerKeyCandidate && normalized.models.providers[providerKeyCandidate] ? providerKeyCandidate : firstProviderKey;
    const provider = providerKey ? normalized.models.providers[providerKey] : undefined;
    const modelIdCandidate = parsedModel?.modelId || legacyModelId;
    const rest = { ...(agent as AgentConfig & { providerKey?: string; modelId?: string }) };
    delete rest.providerKey;
    delete rest.modelId;
    const isLegacyMainAgentName = rest.id === 'mainAgent' && (
      !rest.name ||
      rest.name === 'Main Agent' ||
      rest.name === 'main Agent' ||
      rest.name === '主 Agent'
    );
    const normalizedAgent: AgentConfig = {
      ...DEFAULT_AGENT,
      ...rest,
      ...(isLegacyMainAgentName ? { name: 'main' } : {}),
      permissions: normalizeAgentPermissions(rest),
      model: provider
        ? buildAgentModel(
          providerKey,
          modelIdCandidate && provider.model.some(item => item.id === modelIdCandidate)
            ? modelIdCandidate
            : getProviderDefaultModelId(provider)
        )
        : ''
    };
    ensureAgentPromptFields(normalizedAgent);
    return normalizedAgent;
  });

  if (!normalized.agents.list.some(agent => agent.id === normalized.agents.activeAgentId)) {
    normalized.agents.activeAgentId = normalized.agents.list[0].id;
  }

  return normalized;
}

function ensureAgentWorkspaceAndPrompt(agent: AgentConfig) {
  if (!agent.workspace) {
    return;
  }
  try {
    const layout = getPromptWorkspaceLayout(agent.workspace);
    if (!fs.existsSync(layout.workspaceRoot)) {
      fs.mkdirSync(layout.workspaceRoot, { recursive: true });
    }
    const workspaceDirectories = [
      layout.promptsDir,
      layout.memoryDir,
      layout.skillsDir,
      layout.tasksDir,
      layout.artifactsDir,
      layout.imagesDir,
      layout.mediaDir
    ];
    for (const directoryPath of workspaceDirectories) {
      if (!fs.existsSync(directoryPath)) {
        fs.mkdirSync(directoryPath, { recursive: true });
      }
    }
    ensureAgentPromptFields(agent);
    const promptFiles: Array<{ fileName: string; content: string }> = [
      { fileName: AGENT_FILE_NAMES.kairopilot, content: agent.systemPrompt },
      { fileName: AGENT_FILE_NAMES.identity, content: agent.identityPrompt },
      { fileName: AGENT_FILE_NAMES.user, content: agent.userPrompt },
      { fileName: AGENT_FILE_NAMES.soul, content: agent.soulPrompt }
    ];
    for (const item of promptFiles) {
      const filePath = path.join(agent.workspace, item.fileName);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, item.content, 'utf-8');
        continue;
      }
      const existing = fs.readFileSync(filePath, 'utf-8');
      if (!existing.trim()) {
        fs.writeFileSync(filePath, item.content, 'utf-8');
      }
    }
  } catch (e) {
    console.error(`Failed to initialize workspace for agent ${agent.id}:`, e);
  }
}

function stripAgentPromptFields(config: KairoPilotConfig): KairoPilotConfig {
  const sanitizedAgents = config.agents.list.map(agent => {
    const { systemPrompt, identityPrompt, userPrompt, soulPrompt, ...rest } = agent;
    void systemPrompt;
    void identityPrompt;
    void userPrompt;
    void soulPrompt;
    return rest as AgentConfig;
  });
  return {
    ...config,
    agents: {
      ...config.agents,
      list: sanitizedAgents
    }
  };
}

function providerToModelConfig(providerKey: string, provider: ProviderConfig, modelId?: string): ModelConfig {
  const resolvedModel = modelId && provider.model.some(item => item.id === modelId)
    ? modelId
    : getProviderDefaultModelId(provider);
  return {
    id: providerKey,
    name: providerKey,
    provider: provider.provider,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: resolvedModel,
    availableModels: provider.model
  };
}

function modelToProviderConfig(model: ModelConfig, existing?: ProviderConfig): ProviderConfig {
  const availableModels = Array.isArray(model.availableModels) && model.availableModels.length > 0
    ? model.availableModels
    : (existing?.model || [{ id: model.model, name: model.model }]);
  const list = availableModels.some(item => item.id === model.model)
    ? availableModels
    : [...availableModels, { id: model.model, name: model.model }];
  return {
    provider: model.provider,
    baseUrl: model.baseUrl,
    apiKey: model.apiKey,
    model: list
  };
}

export function getKairoPilotConfig(): KairoPilotConfig {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      const finalConfig = normalizeConfig(JSON.parse(data));
      finalConfig.agents.list.forEach(ensureAgentWorkspaceAndPrompt);
      saveKairoPilotConfig(finalConfig);
      return finalConfig;
    }
  } catch (error) {
    console.error('Failed to load config:', error);
  }

  DEFAULT_CONFIG.agents.list.forEach(ensureAgentWorkspaceAndPrompt);
  saveKairoPilotConfig(DEFAULT_CONFIG);
  return DEFAULT_CONFIG;
}

export function saveKairoPilotConfig(config: KairoPilotConfig) {
  const configPath = getConfigPath();
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const normalized = normalizeConfig(config);
    const sanitized = stripAgentPromptFields(normalized);
    fs.writeFileSync(configPath, JSON.stringify(sanitized, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save config:', error);
  }
}

export function getWebSearchConfig(): WebSearchConfig {
  return getKairoPilotConfig().webSearch;
}

export function saveWebSearchConfig(webSearch: WebSearchConfig) {
  const config = getKairoPilotConfig();
  config.webSearch = normalizeWebSearchConfig(webSearch);
  saveKairoPilotConfig(config);
}

export function getPluginRegistry(): PluginRegistryEntry[] {
  return getKairoPilotConfig().plugins.registry;
}

export function savePluginRegistry(registry: PluginRegistryEntry[]) {
  const config = getKairoPilotConfig();
  config.plugins.registry = registry;
  saveKairoPilotConfig(config);
}

export function getModels(): ModelConfig[] {
  const providers = getKairoPilotConfig().models.providers;
  return Object.entries(providers).map(([providerKey, provider]) => providerToModelConfig(providerKey, provider));
}

export function getModel(id: string): ModelConfig | undefined {
  const provider = getKairoPilotConfig().models.providers[id];
  if (!provider) {
    return undefined;
  }
  return providerToModelConfig(id, provider);
}

export function getModelForAgent(agent: AgentConfig): ModelConfig | undefined {
  const parsedModel = splitAgentModel(agent.model);
  if (!parsedModel) {
    return undefined;
  }
  const provider = getKairoPilotConfig().models.providers[parsedModel.providerKey];
  if (!provider) {
    return undefined;
  }
  const modelId = provider.model.some(item => item.id === parsedModel.modelId)
    ? parsedModel.modelId
    : getProviderDefaultModelId(provider);
  return providerToModelConfig(parsedModel.providerKey, provider, modelId);
}

export function saveModel(model: ModelConfig) {
  const config = getKairoPilotConfig();
  if (!isValidProviderKey(model.id)) {
    throw new Error('Invalid provider key: only English letters, numbers, "_" and "-" are allowed');
  }
  const existing = config.models.providers[model.id];
  config.models.providers[model.id] = modelToProviderConfig(model, existing);
  saveKairoPilotConfig(config);
}

export function deleteModel(id: string) {
  const config = getKairoPilotConfig();
  delete config.models.providers[id];
  const fallbackProviderKey = getFirstProviderKey(config);
  const fallbackProvider = fallbackProviderKey ? config.models.providers[fallbackProviderKey] : undefined;
  if (!fallbackProvider || !fallbackProviderKey) {
    config.agents.list = config.agents.list.map(agent => ({ ...agent, model: '' }));
  } else {
    const fallbackModelId = getProviderDefaultModelId(fallbackProvider);
    config.agents.list = config.agents.list.map(agent => {
      const parsedModel = splitAgentModel(agent.model);
      if (!parsedModel) {
        return { ...agent, model: buildAgentModel(fallbackProviderKey, fallbackModelId) };
      }
      if (parsedModel.providerKey !== id) {
        return agent;
      }
      return {
        ...agent,
        model: buildAgentModel(fallbackProviderKey, fallbackModelId)
      };
    });
  }
  saveKairoPilotConfig(config);
}

export function getAgents(): AgentConfig[] {
  const config = getKairoPilotConfig();
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
  const config = getKairoPilotConfig();
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
  const config = getKairoPilotConfig();
  config.agents.list = config.agents.list.filter(a => a.id !== id);
  if (config.agents.activeAgentId === id && config.agents.list.length > 0) {
    config.agents.activeAgentId = config.agents.list[0].id;
  }
  saveKairoPilotConfig(config);
}

export function getActiveAgentId(): string {
  return getKairoPilotConfig().agents.activeAgentId;
}

export function setActiveAgentId(id: string) {
  const config = getKairoPilotConfig();
  if (config.agents.list.some(a => a.id === id)) {
    config.agents.activeAgentId = id;
    saveKairoPilotConfig(config);
  }
}

export function getAgentConfig(): LegacyAgentConfig {
  const config = getKairoPilotConfig();
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
  const config = getKairoPilotConfig();
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
    provider.apiKey = legacyConfig.apiKey;
    provider.baseUrl = legacyConfig.baseUrl;
    if (!provider.model.some(item => item.id === legacyConfig.model)) {
      provider.model.push({ id: legacyConfig.model, name: legacyConfig.model });
    }
  }

  saveKairoPilotConfig(config);
}
