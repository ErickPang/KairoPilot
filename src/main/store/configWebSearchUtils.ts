import type { KairoPilotConfig, WebSearchConfig, WebSearchProviderId } from '../../shared/contracts';
import { prepareConfigSecretForStorage, resolveConfigSecret } from './configSecrets';

type PartialWebSearchConfig = Omit<Partial<WebSearchConfig>, 'providers'> & {
  providers?: Partial<WebSearchConfig['providers']>;
};

const DEFAULT_WEB_SEARCH_TIMEOUT_MS = 10_000;
const DEFAULT_PREFERRED_PROVIDERS: WebSearchProviderId[] = ['searxng', 'tavily', 'bing', 'baidu', 'duckduckgo'];

function normalizePreferredProviders(value: unknown): WebSearchProviderId[] {
  const supportedProviders: WebSearchProviderId[] = ['searxng', 'tavily', 'bing', 'duckduckgo', 'baidu'];
  const supportedSet = new Set<WebSearchProviderId>(supportedProviders);
  const entries = Array.isArray(value) ? value : [];
  const normalized = entries
    .filter((item): item is WebSearchProviderId => typeof item === 'string' && supportedSet.has(item as WebSearchProviderId));

  const deduped = normalized.filter((item, index) => normalized.indexOf(item) === index);
  if (deduped.length === 0) {
    return [...DEFAULT_PREFERRED_PROVIDERS];
  }

  return [
    ...deduped,
    ...DEFAULT_PREFERRED_PROVIDERS.filter((item) => !deduped.includes(item))
  ];
}

function normalizeEnabledFlag(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeBaseUrl(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function createDefaultWebSearchConfig(): WebSearchConfig {
  return {
    timeoutMs: DEFAULT_WEB_SEARCH_TIMEOUT_MS,
    preferredProviders: [...DEFAULT_PREFERRED_PROVIDERS],
    providers: {
      searxng: {
        enabled: false,
        baseUrl: ''
      },
      tavily: {
        enabled: false,
        baseUrl: 'https://api.tavily.com',
        apiKey: ''
      },
      bing: {
        enabled: true
      },
      duckduckgo: {
        enabled: true
      },
      baidu: {
        enabled: true
      }
    }
  };
}

export function normalizeWebSearchConfig(config: PartialWebSearchConfig | undefined): WebSearchConfig {
  const defaults = createDefaultWebSearchConfig();
  const tavilyApiKey = resolveConfigSecret(
    normalizeBaseUrl(config?.providers?.tavily?.apiKey),
    config?.providers?.tavily?.apiKeyEncrypted
  );

  return {
    timeoutMs: typeof config?.timeoutMs === 'number' && Number.isFinite(config.timeoutMs)
      ? Math.max(2_000, Math.min(Math.round(config.timeoutMs), 30_000))
      : defaults.timeoutMs,
    preferredProviders: normalizePreferredProviders(config?.preferredProviders),
    providers: {
      searxng: {
        enabled: normalizeEnabledFlag(config?.providers?.searxng?.enabled, defaults.providers.searxng.enabled),
        baseUrl: normalizeBaseUrl(config?.providers?.searxng?.baseUrl)
      },
      tavily: {
        enabled: normalizeEnabledFlag(config?.providers?.tavily?.enabled, defaults.providers.tavily.enabled),
        baseUrl: normalizeBaseUrl(config?.providers?.tavily?.baseUrl) || defaults.providers.tavily.baseUrl,
        apiKey: tavilyApiKey,
        apiKeyEncrypted: config?.providers?.tavily?.apiKeyEncrypted,
        apiKeyStored: Boolean(tavilyApiKey)
      },
      bing: {
        enabled: normalizeEnabledFlag(config?.providers?.bing?.enabled, defaults.providers.bing.enabled)
      },
      duckduckgo: {
        enabled: normalizeEnabledFlag(config?.providers?.duckduckgo?.enabled, defaults.providers.duckduckgo.enabled)
      },
      baidu: {
        enabled: normalizeEnabledFlag(config?.providers?.baidu?.enabled, defaults.providers.baidu.enabled)
      }
    }
  };
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

export function sanitizeWebSearchForStorage(webSearch: WebSearchConfig): WebSearchConfig {
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

export function applyWebSearchConfig(config: KairoPilotConfig, value: PartialWebSearchConfig | undefined): KairoPilotConfig {
  return {
    ...config,
    webSearch: normalizeWebSearchConfig(value)
  };
}
