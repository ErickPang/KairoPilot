import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

import os from 'os';

// --- New Configuration Structure ---

export interface ModelConfig {
  id: string;
  name: string; // User-friendly name (e.g., "My GPT-4o", "Local Llama 3")
  provider: 'openai' | 'ollama' | 'anthropic' | 'deepseek' | 'zhipu' | 'kimi' | 'qianwen' | 'custom';
  baseUrl: string;
  apiKey: string;
  model: string; // The actual model identifier string (e.g., "gpt-4o", "llama3")
}

export interface AgentConfig {
  id: string;
  name: string; // e.g., "Main Agent", "Coding Assistant"
  workspace: string;
  workspaceName?: string;
  systemPrompt: string;
  modelConfigId: string; // References ModelConfig.id
  allowedPaths: string[];
  allowedCommands: string[];
  enableShell: boolean;
}

export interface KairoPilotConfig {
  version: string;
  models: ModelConfig[];
  agents: AgentConfig[];
  activeAgentId: string;
  pluginRegistry: PluginRegistryEntry[];
  skillsRegistry: SkillsRegistryEntry[];
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

// --- Default Values ---

const DEFAULT_MODEL: ModelConfig = {
  id: 'default-model',
  name: 'Default OpenAI',
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o'
};

const DEFAULT_AGENT: AgentConfig = {
  id: 'mainAgent',
  name: 'Main Agent',
  workspace: path.join(os.homedir(), '.kairopilot', 'workspace'), // Default workspace
  systemPrompt: 'You are a helpful AI assistant capable of reading and writing files.',
  modelConfigId: 'default-model',
  allowedPaths: [path.join(os.homedir(), '.kairopilot', 'workspace')],
  allowedCommands: ['ls', 'cd', 'pwd', 'mkdir', 'rm', 'touch', 'cat', 'grep', 'echo', 'npm', 'node', 'git', 'python', 'python3', 'open', 'curl'],
  enableShell: false
};

const DEFAULT_CONFIG: KairoPilotConfig = {
  version: '2.0.0',
  models: [DEFAULT_MODEL],
  agents: [DEFAULT_AGENT],
  activeAgentId: 'mainAgent',
  pluginRegistry: [],
  skillsRegistry: []
};

// --- Legacy Types for Migration ---
interface LegacyLLMConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}
interface LegacyAgentSectionConfig {
  workspace: string;
  systemPrompt: string;
  allowedPaths: string[];
  allowedCommands: string[];
  enableShell: boolean;
}
interface LegacyConfig {
  version: string;
  llm: LegacyLLMConfig;
  agent: LegacyAgentSectionConfig;
}

// --- Storage Logic ---

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'kairopilot.json');
}

function getLegacyRegistryPath(fileName: string): string {
  return path.join(app.getPath('userData'), fileName);
}

function isPluginRegistryEntry(value: unknown): value is PluginRegistryEntry {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string'
    && typeof item.name === 'string'
    && typeof item.description === 'string'
    && typeof item.version === 'string'
    && typeof item.author === 'string'
    && typeof item.installedAt === 'number'
    && typeof item.filePath === 'string'
    && typeof item.scope === 'string';
}

function readLegacyJsonArray(fileName: string): unknown[] {
  const legacyPath = getLegacyRegistryPath(fileName);
  if (!fs.existsSync(legacyPath)) return [];
  try {
    const data = fs.readFileSync(legacyPath, 'utf-8');
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function removeLegacyRegistry(fileName: string) {
  const legacyPath = getLegacyRegistryPath(fileName);
  if (!fs.existsSync(legacyPath)) return;
  try {
    fs.unlinkSync(legacyPath);
  } catch (error) {
    console.warn(`Failed to remove legacy registry ${fileName}:`, error);
  }
}

function normalizeConfig(rawConfig: unknown): KairoPilotConfig {
  const merged = {
    ...DEFAULT_CONFIG,
    ...(rawConfig as Partial<KairoPilotConfig>)
  } as KairoPilotConfig;

  if (!Array.isArray(merged.pluginRegistry)) {
    merged.pluginRegistry = [];
  }
  if (!Array.isArray(merged.skillsRegistry)) {
    merged.skillsRegistry = [];
  }

  if (merged.pluginRegistry.length === 0) {
    const legacyPlugins = readLegacyJsonArray('plugins_registry.json').filter(isPluginRegistryEntry);
    if (legacyPlugins.length > 0) {
      merged.pluginRegistry = legacyPlugins;
      removeLegacyRegistry('plugins_registry.json');
    }
  }

  if (merged.skillsRegistry.length === 0) {
    const legacySkills = readLegacyJsonArray('skills_registry.json') as SkillsRegistryEntry[];
    if (legacySkills.length > 0) {
      merged.skillsRegistry = legacySkills;
      removeLegacyRegistry('skills_registry.json');
    }
  }

  return merged;
}

function ensureAgentWorkspaceAndPrompt(agent: AgentConfig) {
  if (agent.workspace) {
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
}

export function getKairoPilotConfig(): KairoPilotConfig {
  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      const rawConfig = JSON.parse(data);

      // Check if migration is needed (version check or structure check)
      if (!rawConfig.models || !Array.isArray(rawConfig.models)) {
        console.log('Migrating legacy config to new structure...');
        const migrated = migrateLegacyConfig(rawConfig);
        migrated.agents.forEach(ensureAgentWorkspaceAndPrompt);
        return migrated;
      }

      const finalConfig = normalizeConfig(rawConfig);
      finalConfig.agents.forEach(ensureAgentWorkspaceAndPrompt);
      saveKairoPilotConfig(finalConfig);
      return finalConfig;
    }
  } catch (error) {
    console.error('Failed to load config:', error);
  }
  
  // Return default if file doesn't exist or error
  DEFAULT_CONFIG.agents.forEach(ensureAgentWorkspaceAndPrompt);
  saveKairoPilotConfig(DEFAULT_CONFIG);
  return DEFAULT_CONFIG;
}

function migrateLegacyConfig(legacy: LegacyConfig): KairoPilotConfig {
  const modelId = uuidv4();

  const newModel: ModelConfig = {
    id: modelId,
    name: 'Migrated Model',
    provider: (legacy.llm?.provider as ModelConfig['provider']) || 'openai',
    baseUrl: legacy.llm?.baseUrl || 'https://api.openai.com/v1',
    apiKey: legacy.llm?.apiKey || '',
    model: legacy.llm?.model || 'gpt-4o'
  };

  const newAgent: AgentConfig = {
    id: 'mainAgent',
    name: 'Main Agent',
    workspace: legacy.agent?.workspace || path.join(os.homedir(), '.kairopilot', 'workspace'),
    systemPrompt: legacy.agent?.systemPrompt || DEFAULT_AGENT.systemPrompt,
    modelConfigId: modelId,
    allowedPaths: legacy.agent?.allowedPaths || [path.join(os.homedir(), '.kairopilot', 'workspace')],
    allowedCommands: legacy.agent?.allowedCommands || DEFAULT_AGENT.allowedCommands,
    enableShell: legacy.agent?.enableShell || false
  };

  const newConfig: KairoPilotConfig = {
    version: '2.0.0',
    models: [newModel],
    agents: [newAgent],
    activeAgentId: 'mainAgent',
    pluginRegistry: [],
    skillsRegistry: []
  };

  saveKairoPilotConfig(newConfig);
  return newConfig;
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
  return getKairoPilotConfig().pluginRegistry;
}

export function savePluginRegistry(registry: PluginRegistryEntry[]) {
  const config = getKairoPilotConfig();
  config.pluginRegistry = registry;
  saveKairoPilotConfig(config);
}

// --- CRUD Operations ---

export function getModels(): ModelConfig[] {
  return getKairoPilotConfig().models;
}

export function getModel(id: string): ModelConfig | undefined {
  return getModels().find(m => m.id === id);
}

export function saveModel(model: ModelConfig) {
  const config = getKairoPilotConfig();
  const index = config.models.findIndex(m => m.id === model.id);
  if (index !== -1) {
    config.models[index] = model;
  } else {
    config.models.push(model);
  }
  saveKairoPilotConfig(config);
}

export function deleteModel(id: string) {
  const config = getKairoPilotConfig();
  // Prevent deleting if it's the only model or used by active agent?
  // For MVP, just allow delete but warn or fallback if referenced.
  config.models = config.models.filter(m => m.id !== id);
  saveKairoPilotConfig(config);
}

export function getAgents(): AgentConfig[] {
  const config = getKairoPilotConfig();
  
  // Sync systemPrompt with KAIROPILOT.md for each agent
  return config.agents.map(agent => {
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
  
  if (agent.id === 'mainAgent') {
    agent.workspace = path.join(os.homedir(), '.kairopilot', 'workspace');
    agent.workspaceName = undefined;
  } else if (agent.workspaceName !== undefined) {
    if (agent.workspaceName === '') {
      agent.workspace = path.join(os.homedir(), '.kairopilot', 'workspace');
    } else {
      agent.workspace = path.join(os.homedir(), '.kairopilot', `workspace-${agent.workspaceName}`);
    }
  }

  // Write systemPrompt to KAIROPILOT.md
  if (agent.workspace) {
    try {
      if (!fs.existsSync(agent.workspace)) {
        fs.mkdirSync(agent.workspace, { recursive: true });
      }
      const kairopilotMdPath = path.join(agent.workspace, 'KAIROPILOT.md');
      fs.writeFileSync(kairopilotMdPath, agent.systemPrompt, 'utf-8');
    } catch (e) {
      console.error(`Failed to write KAIROPILOT.md for agent ${agent.id}:`, e);
    }
  }

  const index = config.agents.findIndex(a => a.id === agent.id);
  if (index !== -1) {
    config.agents[index] = agent;
  } else {
    config.agents.push(agent);
  }
  saveKairoPilotConfig(config);
}

export function deleteAgent(id: string) {
  if (id === 'mainAgent') {
    throw new Error('Main Agent cannot be deleted');
  }
  const config = getKairoPilotConfig();
  config.agents = config.agents.filter(a => a.id !== id);
  // If active agent deleted, switch to another
  if (config.activeAgentId === id && config.agents.length > 0) {
    config.activeAgentId = config.agents[0].id;
  }
  saveKairoPilotConfig(config);
}

export function getActiveAgentId(): string {
  return getKairoPilotConfig().activeAgentId;
}

export function setActiveAgentId(id: string) {
  const config = getKairoPilotConfig();
  if (config.agents.some(a => a.id === id)) {
    config.activeAgentId = id;
    saveKairoPilotConfig(config);
  }
}

// --- Backward Compatibility (Deprecated) ---
// These are kept to minimize immediate breakage, but their logic is adapted.

export interface LegacyAgentConfig {
  provider: 'openai' | 'ollama' | 'anthropic' | 'deepseek' | 'zhipu' | 'kimi' | 'qianwen' | 'custom';
  apiKey: string;
  baseUrl: string;
  model: string;
  workspace: string;
  systemPrompt: string;
  enableShell: boolean;
  allowedPaths?: string[];
  allowedCommands?: string[];
}

export function getAgentConfig(): LegacyAgentConfig {
  const config = getKairoPilotConfig();
  const activeAgent = config.agents.find(a => a.id === config.activeAgentId) || config.agents[0];
  const modelConfig = config.models.find(m => m.id === activeAgent?.modelConfigId) || config.models[0];
  
  // Return a flattened view for legacy compatibility
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

// Saving via legacy method only updates the *active* agent and its model
export function saveAgentConfig(legacyConfig: LegacyAgentConfig) {
  const config = getKairoPilotConfig();
  const activeAgentIndex = config.agents.findIndex(a => a.id === config.activeAgentId);
  
  if (activeAgentIndex === -1 && config.agents.length === 0) {
    // Should not happen, but create default
    saveKairoPilotConfig(DEFAULT_CONFIG);
    return;
  }
  
  const agent = config.agents[activeAgentIndex !== -1 ? activeAgentIndex : 0];
  
  // Update Agent properties
  agent.workspace = legacyConfig.workspace;
  agent.systemPrompt = legacyConfig.systemPrompt;
  agent.enableShell = legacyConfig.enableShell;
  agent.allowedPaths = legacyConfig.allowedPaths || agent.allowedPaths;
  agent.allowedCommands = legacyConfig.allowedCommands || agent.allowedCommands;
  
  // Update Model properties (find the linked model)
  const modelIndex = config.models.findIndex(m => m.id === agent.modelConfigId);
  if (modelIndex !== -1) {
    config.models[modelIndex].provider = legacyConfig.provider;
    config.models[modelIndex].apiKey = legacyConfig.apiKey;
    config.models[modelIndex].baseUrl = legacyConfig.baseUrl;
    config.models[modelIndex].model = legacyConfig.model;
  }
  
  saveKairoPilotConfig(config);
}
