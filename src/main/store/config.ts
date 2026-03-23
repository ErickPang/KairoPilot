import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';

export type ProviderType = 'openai' | 'ollama' | 'anthropic' | 'deepseek' | 'zhipu' | 'kimi' | 'qianwen' | 'custom';

export interface ModelOption {
  id: string;
  name: string;
}

export interface ProviderConfig {
  provider: ProviderType;
  baseUrl: string;
  apiKey: string;
  model: ModelOption[];
}

export interface ModelConfig {
  id: string;
  name: string;
  provider: ProviderType;
  baseUrl: string;
  apiKey: string;
  model: string;
  availableModels?: ModelOption[];
}

export interface AgentConfig {
  id: string;
  name: string;
  workspace: string;
  workspaceName?: string;
  systemPrompt: string;
  model: string;
  allowedPaths: string[];
  allowedCommands: string[];
  enableShell: boolean;
}

export interface PluginRegistryEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  icon?: string;
  installedAt: number;
  filePath: string;
  scope: string;
}

export interface SkillsRegistryEntry {
  [key: string]: unknown;
}

export interface KairoPilotConfig {
  version: string;
  models: {
    providers: Record<string, ProviderConfig>;
  };
  agents: {
    activeAgentId: string;
    list: AgentConfig[];
  };
  plugins: {
    registry: PluginRegistryEntry[];
  };
  skills: {
    registry: SkillsRegistryEntry[];
  };
}

export interface LegacyAgentConfig {
  provider: ProviderType;
  apiKey: string;
  baseUrl: string;
  model: string;
  workspace: string;
  systemPrompt: string;
  enableShell: boolean;
  allowedPaths?: string[];
  allowedCommands?: string[];
}

const DEFAULT_AGENT: AgentConfig = {
  id: 'mainAgent',
  name: 'main',
  workspace: path.join(os.homedir(), '.kairopilot', 'workspace'),
  systemPrompt: 'You are a helpful AI assistant capable of reading and writing files.',
  model: '',
  allowedPaths: [path.join(os.homedir(), '.kairopilot', 'workspace')],
  allowedCommands: ['ls', 'cd', 'pwd', 'mkdir', 'rm', 'touch', 'cat', 'grep', 'echo', 'npm', 'node', 'git', 'python', 'python3', 'open', 'curl'],
  enableShell: false
};

const DEFAULT_CONFIG: KairoPilotConfig = {
  version: '3.0.0',
  models: {
    providers: {}
  },
  agents: {
    activeAgentId: DEFAULT_AGENT.id,
    list: [DEFAULT_AGENT]
  },
  plugins: {
    registry: []
  },
  skills: {
    registry: []
  }
};

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'kairopilot.json');
}

const PROVIDER_TYPES: ProviderType[] = ['openai', 'ollama', 'anthropic', 'deepseek', 'zhipu', 'kimi', 'qianwen', 'custom'];

function resolveProviderType(value: unknown, providerKey: string): ProviderType {
  if (typeof value === 'string' && PROVIDER_TYPES.includes(value as ProviderType)) {
    return value as ProviderType;
  }
  const normalizedKey = providerKey.toLowerCase();
  if (PROVIDER_TYPES.includes(normalizedKey as ProviderType)) {
    return normalizedKey as ProviderType;
  }
  return 'custom';
}

function isValidProviderKey(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value);
}

function normalizeProvider(provider: Partial<ProviderConfig> & { model?: unknown }, fallbackProviderKey: string): ProviderConfig {
  const rawModel = provider.model;
  const rawModelObject = rawModel && typeof rawModel === 'object' ? rawModel as { list?: unknown[] } : undefined;
  const rawModelList = Array.isArray(rawModel)
    ? rawModel
    : (Array.isArray(rawModelObject?.list) ? rawModelObject.list : []);
  const modelList = rawModelList
    .filter(item => item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string')
    .map(item => ({
      id: String((item as { id: string }).id),
      name: String((item as { name?: string }).name || (item as { id: string }).id)
    }));
  const finalModelList = modelList.length > 0 ? modelList : [{ id: 'gpt-4o', name: 'gpt-4o' }];
  return {
    provider: resolveProviderType(provider.provider, fallbackProviderKey),
    baseUrl: provider.baseUrl || 'https://api.openai.com/v1',
    apiKey: provider.apiKey || '',
    model: finalModelList
  };
}

function getFirstProviderKey(config: KairoPilotConfig): string {
  const keys = Object.keys(config.models.providers);
  return keys[0] || '';
}

function splitAgentModel(value: string | undefined): { providerKey: string; modelId: string } | null {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const index = value.indexOf('/');
  if (index <= 0 || index >= value.length - 1) {
    return null;
  }
  return {
    providerKey: value.slice(0, index),
    modelId: value.slice(index + 1)
  };
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
    }
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
    return {
      ...rest,
      ...(isLegacyMainAgentName ? { name: 'main' } : {}),
      model: provider
        ? buildAgentModel(
          providerKey,
          modelIdCandidate && provider.model.some(item => item.id === modelIdCandidate)
            ? modelIdCandidate
            : getProviderDefaultModelId(provider)
        )
        : ''
    };
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
    if (!fs.existsSync(agent.workspace)) {
      fs.mkdirSync(agent.workspace, { recursive: true });
    }
    const kairopilotMdPath = path.join(agent.workspace, 'KAIROPILOT.md');
    if (!fs.existsSync(kairopilotMdPath)) {
      fs.writeFileSync(kairopilotMdPath, agent.systemPrompt || '', 'utf-8');
    }
  } catch (e) {
    console.error(`Failed to initialize workspace for agent ${agent.id}:`, e);
  }
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
    fs.writeFileSync(configPath, JSON.stringify(normalized, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save config:', error);
  }
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
      const kairopilotMdPath = path.join(agent.workspace, 'KAIROPILOT.md');
      if (fs.existsSync(kairopilotMdPath)) {
        try {
          const content = fs.readFileSync(kairopilotMdPath, 'utf-8');
          agent.systemPrompt = content;
        } catch (e) {
          console.error(`Failed to read KAIROPILOT.md for agent ${agent.id}:`, e);
        }
      }
    }
    return agent;
  });
}

export function getAgent(id: string): AgentConfig | undefined {
  return getAgents().find(a => a.id === id);
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
    nextAgent.workspace = nextAgent.workspaceName === ''
      ? path.join(os.homedir(), '.kairopilot', 'workspace')
      : path.join(os.homedir(), '.kairopilot', `workspace-${nextAgent.workspaceName}`);
  }

  if (nextAgent.workspace) {
    try {
      if (!fs.existsSync(nextAgent.workspace)) {
        fs.mkdirSync(nextAgent.workspace, { recursive: true });
      }
      const kairopilotMdPath = path.join(nextAgent.workspace, 'KAIROPILOT.md');
      fs.writeFileSync(kairopilotMdPath, nextAgent.systemPrompt, 'utf-8');
    } catch (e) {
      console.error(`Failed to write KAIROPILOT.md for agent ${nextAgent.id}:`, e);
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
  const activeAgent = config.agents.list.find(a => a.id === config.agents.activeAgentId) || config.agents.list[0];
  const modelConfig = activeAgent ? getModelForAgent(activeAgent) : undefined;
  return {
    provider: modelConfig?.provider || 'openai',
    apiKey: modelConfig?.apiKey || '',
    baseUrl: modelConfig?.baseUrl || '',
    model: modelConfig?.model || 'gpt-4o',
    workspace: activeAgent?.workspace || '',
    systemPrompt: activeAgent?.systemPrompt || '',
    enableShell: activeAgent?.enableShell || false,
    allowedPaths: activeAgent?.allowedPaths || [],
    allowedCommands: activeAgent?.allowedCommands || []
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
  agent.systemPrompt = legacyConfig.systemPrompt;
  agent.enableShell = legacyConfig.enableShell;
  agent.allowedPaths = legacyConfig.allowedPaths || agent.allowedPaths;
  agent.allowedCommands = legacyConfig.allowedCommands || agent.allowedCommands;
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
