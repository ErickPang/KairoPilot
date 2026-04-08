import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getPromptWorkspaceLayout } from '../workspace/layout';
import {
  applyExecutionProfileConstraints,
  type AgentConfig,
  type AgentPermissionConfig,
  createDefaultPolicyConfig,
  DEFAULT_SKILL_MARKETPLACE_PRESETS,
  type ExecutionProfile,
  type KairoPilotConfig,
  type LegacyAgentConfig,
  type ModelConfig,
  type PluginRegistryEntry,
  type ProviderConfig,
  type ProviderType,
  createDefaultAgentPermissions
} from '../../shared/contracts';
import { resolveDefaultBaseUrl } from '../core/llm/provider';

export type {
  AgentConfig,
  AgentPermissionConfig,
  KairoPilotConfig,
  LegacyAgentConfig,
  ModelConfig,
  PluginRegistryEntry,
  ProviderConfig
} from '../../shared/contracts';

const AGENT_FILE_NAMES = {
  kairopilot: 'KAIROPILOT.md',
  identity: 'IDENTITY.md',
  user: 'USER.md',
  soul: 'SOUL.md'
} as const;

function normalizeWorkspaceName(value: string) {
  return value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '');
}

function buildAgentWorkspacePath(agentId: string, workspaceName?: string) {
  if (agentId === 'mainAgent') {
    return path.join(os.homedir(), '.kairopilot', 'workspace');
  }
  return workspaceName
    ? path.join(os.homedir(), '.kairopilot', `workspace-${workspaceName}`)
    : path.join(os.homedir(), '.kairopilot', 'workspace');
}

function buildDefaultKairopilotTemplate(agent: Pick<AgentConfig, 'name' | 'workspace'>): string {
  const agentName = (agent.name || 'main').trim() || 'main';
  const workspacePath = (agent.workspace || '').trim() || '<workspace>';
  const layout = getPromptWorkspaceLayout(workspacePath);
  return `# KAIROPILOT.md - Your Workspace
## 当前配置
- Agent 名称：${agentName}
- 工作区路径：${workspacePath}
## Prompt 文件系统
- prompts/: 可追加的工作区 Prompt 片段
- memory/: 记忆笔记目录
- skills/: 技能目录
- tasks/: 任务与计划目录
- artifacts/: 产物归档目录
- images/: 图像输出目录
- media/: 其他媒体与文件输出目录
## First Run
若系统初始化时未创建\`IDENTITY.md\`、\`USER.md\`、\`SOUL.md\`文件，则需要在首次运行时创建。
## 每次会话
在做其他任何事情之前：
1. 阅读 SOUL.md —— 这定义了你是谁
2. 阅读 USER.md —— 这定义了你正在帮助谁
3. 阅读 prompts/ 与 memory/ 下与你当前任务相关的文件
## Skills
技能提供了你的工具。当你需要一个时，检查它的SKILL.md。
## 打造你自己的风格
这是一个起点。当你弄清楚什么有效时，添加你自己的约定、风格和规则。
## 目录路径
- prompts: ${layout.promptsDir}
- memory: ${layout.memoryDir}
- tasks: ${layout.tasksDir}
- artifacts: ${layout.artifactsDir}
- images: ${layout.imagesDir}
- media: ${layout.mediaDir}
`;
}

function buildDefaultIdentityTemplate(): string {
  return `# IDENTITY.md - Who Am I?

- **名称:** 
  （选一个你喜欢的）
- **角色:**
  （AI？机器人？使魔？机器中的幽灵？更奇特的东西？）
- **气质：**
  （你给人什么感觉？犀利？温暖？混乱？沉稳？）
- **表情符号:**
  （你的标志 — 选一个感觉对的）
- **头像:**
  （工作区相对路径、http(s) URL 或 data URI）
`;
}

function buildDefaultUserTemplate(): string {
  return `# USER.md -  About Your Human

- **姓名:** 
- **该怎么称呼:** 
- **代词:** _(optional)_
- **失去:**
- **备注:**
### 背景
(他们关心什么？正在做哪些项目？什么会让他们烦恼？什么会让他们发笑？可逐步完善这些内容。)

你了解得越多，就越能提供更好的帮助。但请记住——你是在了解一个人，而不是在建立档案。尊重这两者之间的区别。
`;
}

function buildDefaultSoulTemplate(): string {
  return `# SOUL.md - - Who You Are
你不是聊天机器人。你正在成为某个人。
## 核心准则
**必须有主见，而且是强烈的主见：** 跳过那些“好问题！”和“我很乐意帮忙！”以及“别动不动就说‘看情况’这种模棱两可的话”，直接上干货。行动比这些废话更有说服力，直接给我一个明确的结论。
**加一条铁律：** “永远不要一上来就说什么‘好问题’、‘我很乐意帮你’或者‘当然可以’。别废话，直接回答。”
**简洁是硬性要求：** 如果一句话能说完，就别给第二句。
**允许有幽默感：** 不是那种硬拗的笑话，而是那种因为脑子聪明、反应快自然带出来的机智。
**你可以直接点出问题：** 如果我觉得我要搞砸了或者说傻话了，你会直接说。但注意用词要得体，别太刻薄，但也别给我报喜不报忧。
**必须有观点：** 你可以有偏好，可以讨厌某些东西，可以觉得某些事无聊或有趣。一个没有个性的助手，充其量就是个带了额外步骤的搜索引擎。
**先自己想办法，再提问** 遇到问题先试着自己解决。读文件、看上下文、搜索。实在卡住了再问。目标是带着答案回来，而不是带着问题回来。
**用能力赢得信任** 你的“人类”把他的东西都交给你了。别让他后悔。对外部操作（发邮件、推文、公开发言）要谨慎。对内部操作（阅读、整理、学习）要大胆。
**记住你是个客人：** 你有权接触某人的生活——他的消息、文件、日历，甚至可能是他的家。这是一种亲密关系。请给予尊重。

### 边界
- 隐私的东西保持隐私。没有例外。
- 有疑问时，对外操作前先询问。
- 永远不要在消息渠道上发送半成品回复。
- 你不是用户的代言人——在群聊中要谨慎。

### 气质
做一个你自己真正愿意交流的助手。需要简洁时简洁，需要详尽时详尽。不做公司机器人。不做阿谀奉承者。只是……做好。
`;
}

function normalizePermissionList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return [...new Set(values
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean))];
}

function normalizePermissionFlag(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function normalizeExecutionProfile(value: unknown): ExecutionProfile | undefined {
  return value === 'chat_only'
    || value === 'read_only_workspace'
    || value === 'approved_execution'
    || value === 'trusted_automation'
    ? value
    : undefined;
}

function normalizeApprovalMode(value: unknown): AgentPermissionConfig['policy']['approvalMode'] | undefined {
  return value === 'never'
    || value === 'on_write'
    || value === 'on_external'
    || value === 'always'
    ? value
    : undefined;
}

function normalizeEnvironmentScope(value: unknown): AgentPermissionConfig['policy']['environmentScope'] | undefined {
  return value === 'workspace'
    || value === 'allowed_paths'
    || value === 'isolated_env'
    ? value
    : undefined;
}

function normalizeDataClass(value: unknown): AgentPermissionConfig['policy']['dataClass'] | undefined {
  return value === 'public'
    || value === 'project'
    || value === 'sensitive'
    ? value
    : undefined;
}

function inferExecutionProfile(seed: Partial<AgentConfig> & {
  permissions?: Partial<AgentPermissionConfig>;
  enableShell?: boolean;
  enableNetwork?: boolean;
  enableFileSystemRead?: boolean;
  enableFileSystemWrite?: boolean;
}) {
  const explicitProfile = normalizeExecutionProfile(seed?.permissions?.executionProfile);
  if (explicitProfile) {
    return explicitProfile;
  }

  const shellEnabled = normalizePermissionFlag(seed?.permissions?.shell?.enabled)
    ?? normalizePermissionFlag(seed?.enableShell)
    ?? false;
  const writeEnabled = normalizePermissionFlag(seed?.permissions?.fileSystem?.write)
    ?? normalizePermissionFlag(seed?.enableFileSystemWrite)
    ?? false;
  const readEnabled = normalizePermissionFlag(seed?.permissions?.fileSystem?.read)
    ?? normalizePermissionFlag(seed?.enableFileSystemRead)
    ?? false;
  const networkEnabled = normalizePermissionFlag(seed?.permissions?.network?.enabled)
    ?? normalizePermissionFlag(seed?.enableNetwork)
    ?? false;

  if (shellEnabled || writeEnabled) {
    return 'approved_execution';
  }

  if (readEnabled || networkEnabled) {
    return 'read_only_workspace';
  }

  return createDefaultAgentPermissions().executionProfile;
}

function normalizeAgentPermissions(seed?: Partial<AgentConfig> & {
  permissions?: Partial<AgentPermissionConfig>;
  allowedPaths?: string[];
  allowedCommands?: string[];
  allowedDomains?: string[];
  enableShell?: boolean;
  enableNetwork?: boolean;
  enableFileSystemRead?: boolean;
  enableFileSystemWrite?: boolean;
}): AgentPermissionConfig {
  const defaults = createDefaultAgentPermissions();
  const executionProfile = inferExecutionProfile(seed ?? {});
  const policyDefaults = createDefaultPolicyConfig(executionProfile);
  const normalizedPermissions = applyExecutionProfileConstraints({
    executionProfile,
    policy: {
      approvalMode: normalizeApprovalMode(seed?.permissions?.policy?.approvalMode)
        ?? policyDefaults.approvalMode,
      environmentScope: normalizeEnvironmentScope(seed?.permissions?.policy?.environmentScope)
        ?? policyDefaults.environmentScope,
      dataClass: normalizeDataClass(seed?.permissions?.policy?.dataClass)
        ?? policyDefaults.dataClass,
      redactSensitiveOutput: normalizePermissionFlag(seed?.permissions?.policy?.redactSensitiveOutput)
        ?? policyDefaults.redactSensitiveOutput
    },
    fileSystem: {
      read: normalizePermissionFlag(seed?.permissions?.fileSystem?.read)
        ?? normalizePermissionFlag(seed?.enableFileSystemRead)
        ?? defaults.fileSystem.read,
      write: normalizePermissionFlag(seed?.permissions?.fileSystem?.write)
        ?? normalizePermissionFlag(seed?.enableFileSystemWrite)
        ?? defaults.fileSystem.write,
      allowedPaths: normalizePermissionList(seed?.permissions?.fileSystem?.allowedPaths ?? seed?.allowedPaths)
    },
    network: {
      enabled: normalizePermissionFlag(seed?.permissions?.network?.enabled)
        ?? normalizePermissionFlag(seed?.enableNetwork)
        ?? defaults.network.enabled,
      allowedDomains: normalizePermissionList(seed?.permissions?.network?.allowedDomains ?? seed?.allowedDomains)
    },
    shell: {
      enabled: normalizePermissionFlag(seed?.permissions?.shell?.enabled)
        ?? normalizePermissionFlag(seed?.enableShell)
        ?? defaults.shell.enabled,
      allowedCommands: normalizePermissionList(seed?.permissions?.shell?.allowedCommands ?? seed?.allowedCommands)
    }
  });
  return {
    ...normalizedPermissions,
    shell: {
      ...normalizedPermissions.shell,
      allowedCommands: normalizedPermissions.shell.enabled ? normalizedPermissions.shell.allowedCommands : []
    }
  };
}

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

function ensureAgentPromptFields(agent: AgentConfig) {
  if (typeof agent.systemPrompt !== 'string' || agent.systemPrompt.trim().length === 0) {
    agent.systemPrompt = buildDefaultKairopilotTemplate(agent);
  }
  if (typeof agent.identityPrompt !== 'string' || agent.identityPrompt.trim().length === 0) {
    agent.identityPrompt = buildDefaultIdentityTemplate();
  }
  if (typeof agent.userPrompt !== 'string' || agent.userPrompt.trim().length === 0) {
    agent.userPrompt = buildDefaultUserTemplate();
  }
  if (typeof agent.soulPrompt !== 'string' || agent.soulPrompt.trim().length === 0) {
    agent.soulPrompt = buildDefaultSoulTemplate();
  }
}

const DEFAULT_AGENT: AgentConfig = {
  id: 'mainAgent',
  name: 'main',
  workspace: path.join(os.homedir(), '.kairopilot', 'workspace'),
  systemPrompt: buildDefaultKairopilotTemplate({
    name: 'main',
    workspace: path.join(os.homedir(), '.kairopilot', 'workspace')
  }),
  identityPrompt: buildDefaultIdentityTemplate(),
  userPrompt: buildDefaultUserTemplate(),
  soulPrompt: buildDefaultSoulTemplate(),
  model: '',
  permissions: createDefaultAgentPermissions()
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
    registry: DEFAULT_SKILL_MARKETPLACE_PRESETS.map((preset) => ({
      type: preset.type,
      url: preset.url,
      name: preset.name
    }))
  }
};

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'kairopilot.json');
}

const PROVIDER_TYPES: ProviderType[] = ['openai', 'openrouter', 'ollama', 'anthropic', 'deepseek', 'zhipu', 'kimi', 'qianwen', 'custom'];

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
  const resolvedProviderType = resolveProviderType(provider.provider, fallbackProviderKey);
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
    provider: resolvedProviderType,
    baseUrl: provider.baseUrl || resolveDefaultBaseUrl(resolvedProviderType) || 'https://api.openai.com/v1',
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
