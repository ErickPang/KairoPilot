import {
  type AppearanceConfig,
  type KairoPilotConfig,
  type ProviderConfig,
  type WebSearchConfig
} from '../../shared/contracts';
import { DEFAULT_AGENT, DEFAULT_CONFIG } from './configDefaults';
import { getFirstProviderKey, normalizeProvider, splitAgentModel } from './configModelUtils';
import {
  buildAgentModel,
  getProviderDefaultModelId,
  redactProviderConfig,
  sanitizeProviderForStorage
} from './configModelPersistence';
import { ensureAgentPromptFields } from './configPromptTemplates';
import { normalizeAgentPermissions } from './configPermissionUtils';
import { prepareConfigSecretForStorage } from './configSecrets';
import { normalizeWebSearchConfig } from './configWebSearchUtils';

export const CURRENT_CONFIG_VERSION = DEFAULT_CONFIG.version;

type VersionedConfigMigration = {
  version: string;
  migrate: (config: Partial<KairoPilotConfig>) => Partial<KairoPilotConfig>;
};

const CONFIG_MIGRATIONS: VersionedConfigMigration[] = [
  {
    version: CURRENT_CONFIG_VERSION,
    migrate: (config) => config
  }
];

function parseVersion(value: string) {
  const parts = value.split('.').map((part) => Number(part));
  if (parts.length === 0 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    return null;
  }
  return parts;
}

function compareVersions(left: string, right: string) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  if (!leftParts || !rightParts) {
    return null;
  }

  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }
  }
  return 0;
}

export function applyConfigMigrations(rawConfig: unknown): unknown {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    return rawConfig;
  }

  let config = { ...(rawConfig as Partial<KairoPilotConfig>) };
  const version = typeof config.version === 'string' ? config.version : '';
  const comparison = version ? compareVersions(version, CURRENT_CONFIG_VERSION) : null;
  if (version && comparison !== null && comparison >= 0) {
    return config;
  }

  for (const migration of CONFIG_MIGRATIONS) {
    const currentVersion = typeof config.version === 'string' ? config.version : '';
    const migrationComparison = currentVersion ? compareVersions(currentVersion, migration.version) : null;
    if (!currentVersion || migrationComparison === null || migrationComparison < 0) {
      config = {
        ...migration.migrate(config),
        version: migration.version
      };
    }
  }

  return config;
}

export function normalizeConfig(rawConfig: unknown): KairoPilotConfig {
  const config = applyConfigMigrations(rawConfig) as Partial<KairoPilotConfig>;
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

  const appearanceTheme = config?.appearance?.theme;
  const normalizedAppearance: AppearanceConfig = {
    theme: appearanceTheme === 'system' || appearanceTheme === 'light' || appearanceTheme === 'dark' || appearanceTheme === 'slate' || appearanceTheme === 'warm'
      ? appearanceTheme
      : DEFAULT_CONFIG.appearance.theme
  };

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
    appearance: normalizedAppearance,
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
    const rest = { ...(agent as typeof agent & { providerKey?: string; modelId?: string }) };
    delete rest.providerKey;
    delete rest.modelId;
    const isLegacyMainAgentName = rest.id === 'mainAgent' && (
      !rest.name ||
      rest.name === 'Main Agent' ||
      rest.name === 'main Agent' ||
      rest.name === '主 Agent'
    );
    const normalizedAgent = {
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
