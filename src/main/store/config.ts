export type {
  AgentConfig,
  AgentPermissionConfig,
  AppearanceConfig,
  KairoPilotConfig,
  LegacyAgentConfig,
  ModelConfig,
  PluginRegistryEntry,
  ProviderConfig,
  WebSearchConfig
} from '../../shared/contracts';

export {
  ensureKairoPilotConfigWorkspaces,
  getKairoPilotConfig,
  initializeKairoPilotConfig,
  loadKairoPilotConfigFromDisk,
  normalizeConfig,
  persistKairoPilotConfigMigrations,
  readKairoPilotConfig,
  redactKairoPilotConfigSecrets,
  saveKairoPilotConfig,
  type KairoPilotConfigLoadResult
} from './configRepository';

export {
  getAppearanceConfig,
  getPluginRegistry,
  getRedactedWebSearchConfig,
  getWebSearchConfig,
  saveAppearanceConfig,
  savePluginRegistry,
  saveWebSearchConfig
} from './configSections';

export {
  deleteModel,
  getModel,
  getModelForAgent,
  getModels,
  getRedactedModels,
  saveModel
} from './configModels';

export {
  createAgentDraft,
  deleteAgent,
  deleteAgentWorkspace,
  getActiveAgentId,
  getAgent,
  getAgentConfig,
  getAgents,
  saveAgent,
  saveAgentConfig,
  setActiveAgentId
} from './configAgents';
