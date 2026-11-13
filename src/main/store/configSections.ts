import type {
  AppearanceConfig,
  PluginRegistryEntry,
  WebSearchConfig
} from '../../shared/contracts';
import { DEFAULT_CONFIG } from './configDefaults';
import { normalizeWebSearchConfig } from './configWebSearchUtils';
import { prepareConfigSecret } from './configSecrets';
import {
  readKairoPilotConfig,
  redactWebSearchConfig,
  saveKairoPilotConfig
} from './configRepository';

export function getWebSearchConfig(): WebSearchConfig {
  return readKairoPilotConfig().webSearch;
}

export function getRedactedWebSearchConfig(): WebSearchConfig {
  return redactWebSearchConfig(getWebSearchConfig());
}

export function getAppearanceConfig(): AppearanceConfig {
  return readKairoPilotConfig().appearance;
}

export function saveAppearanceConfig(appearance: AppearanceConfig) {
  const config = readKairoPilotConfig();
  const nextTheme = appearance?.theme;
  config.appearance = {
    ...(appearance?.clipboardSuggestions === true ? {clipboardSuggestions: true} : {}),
    theme: nextTheme === 'system' || nextTheme === 'light' || nextTheme === 'dark' || nextTheme === 'slate' || nextTheme === 'warm'
      ? nextTheme
      : DEFAULT_CONFIG.appearance.theme
  };
  saveKairoPilotConfig(config);
}

export async function saveWebSearchConfig(webSearch: WebSearchConfig) {
  await prepareConfigSecret(webSearch.providers?.tavily?.apiKey);
  const config = readKairoPilotConfig();
  const normalizedWebSearch = normalizeWebSearchConfig(webSearch);
  if (!normalizedWebSearch.providers.tavily.apiKey.trim() && config.webSearch.providers.tavily.apiKey.trim()) {
    normalizedWebSearch.providers.tavily.apiKey = config.webSearch.providers.tavily.apiKey;
    normalizedWebSearch.providers.tavily.apiKeyEncrypted = config.webSearch.providers.tavily.apiKeyEncrypted;
  }
  config.webSearch = normalizedWebSearch;
  saveKairoPilotConfig(config);
}

export function getPluginRegistry(): PluginRegistryEntry[] {
  return readKairoPilotConfig().plugins.registry;
}

export function savePluginRegistry(registry: PluginRegistryEntry[]) {
  const config = readKairoPilotConfig();
  config.plugins.registry = registry;
  saveKairoPilotConfig(config);
}
