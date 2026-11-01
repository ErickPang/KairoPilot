import { normalizeWorkbenchConfig } from './configWorkbench';
import {
  type AppearanceConfig,
  type KairoPilotConfig,
  type ProviderConfig,
  type WebSearchConfig
} from '../../shared/contracts';
import { DEFAULT_CONFIG } from './configDefaults';
import { normalizeProvider } from './configModelUtils';
import {
  redactProviderConfig,
  sanitizeProviderForStorage
} from './configModelPersistence';
import { prepareConfigSecretForStorage } from './configSecrets';
import { normalizeWebSearchConfig } from './configWebSearchUtils';

export const CURRENT_CONFIG_VERSION = DEFAULT_CONFIG.version;

export function normalizeConfig(rawConfig: unknown): KairoPilotConfig {
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
  const appearanceTheme = config?.appearance?.theme;
  const normalizedAppearance: AppearanceConfig = {
    ...(config?.appearance?.clipboardSuggestions === true ? {clipboardSuggestions: true} : {}),
    theme: appearanceTheme === 'system' || appearanceTheme === 'light' || appearanceTheme === 'dark' || appearanceTheme === 'slate' || appearanceTheme === 'warm'
      ? appearanceTheme
      : DEFAULT_CONFIG.appearance.theme
  };

  const normalized: KairoPilotConfig = {
    version: typeof config?.version === 'string' ? config.version : DEFAULT_CONFIG.version,
    models: {
      providers
    },
    plugins: {
      registry: Array.isArray(config?.plugins?.registry) ? config.plugins.registry : []
    },
    skills: {
      registry: Array.isArray(config?.skills?.registry) ? config.skills.registry : []
    },
    appearance: normalizedAppearance,
    webSearch: normalizeWebSearchConfig(config?.webSearch)
  };

  normalized.workbench = normalizeWorkbenchConfig(config || {});
  return normalized;
}

export function redactWebSearchConfig(webSearch: WebSearchConfig): WebSearchConfig {
  return {
    ...webSearch,
    providers: {
      ...webSearch.providers,
      tavily: {
        ...webSearch.providers.tavily,
        apiKey: '',
        apiKeyEncrypted: undefined,
        apiKeyStored: Boolean(webSearch.providers.tavily.apiKey)
      }
    }
  };
}

export function redactKairoPilotConfigSecrets(config: KairoPilotConfig): KairoPilotConfig {
  return {
    ...config,
    models: {
      providers: Object.fromEntries(
        Object.entries(config.models.providers).map(([providerKey, provider]) => [
          providerKey,
          redactProviderConfig(provider)
        ])
      )
    },
    webSearch: redactWebSearchConfig(config.webSearch)
  };
}

function sanitizeWebSearchForStorage(webSearch: WebSearchConfig): WebSearchConfig {
  const tavilySecret = prepareConfigSecretForStorage(
    webSearch.providers.tavily.apiKey,
    webSearch.providers.tavily.apiKeyEncrypted
  );
  return {
    ...webSearch,
    providers: {
      ...webSearch.providers,
      tavily: {
        ...webSearch.providers.tavily,
        apiKey: tavilySecret.plainValue,
        apiKeyEncrypted: tavilySecret.encryptedValue,
        apiKeyStored: undefined
      }
    }
  };
}

export function sanitizeConfigForStorage(config: KairoPilotConfig): KairoPilotConfig {
  return {
    ...config,
    models: {
      providers: Object.fromEntries(
        Object.entries(config.models.providers).map(([providerKey, provider]) => [
          providerKey,
          sanitizeProviderForStorage(provider)
        ])
      )
    },
    webSearch: sanitizeWebSearchForStorage(config.webSearch)
  };
}
