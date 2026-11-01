export type {
  AgentConfig,
  AgentPermissionConfig,
  AppearanceConfig,
  KairoPilotConfig,
  ModelConfig,
  PluginRegistryEntry,
  ProviderConfig,
  WebSearchConfig
} from '../../shared/contracts';

export {
  ensureKairoPilotConfigWorkspaces,
  initializeKairoPilotConfig,
  loadKairoPilotConfigFromDisk,
  normalizeConfig,
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
  getModelForBinding,
  getModels,
  getRedactedModels,
  saveModel
} from './configModels';
