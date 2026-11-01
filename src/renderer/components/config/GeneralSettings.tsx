import { memo, useEffect, useState } from 'react';
import { Select } from '../Select';
import { IconArrowDown, IconArrowUp, IconRefresh } from '../Icons';
import { useTranslation } from '../../hooks/useTranslation';
import { KAIRO_INVOKE } from '../../../shared/ipc';
import type { AppearanceConfig, AppearanceTheme, WebSearchConfig } from '../../types';
import { applyAppearanceTheme, emitAppearanceThemeChanged } from '../../theme';

const DEFAULT_WEB_SEARCH_CONFIG: WebSearchConfig = {
  timeoutMs: 10000,
  preferredProviders: ['searxng', 'tavily', 'bing', 'duckduckgo', 'baidu'],
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

const DEFAULT_APPEARANCE_CONFIG: AppearanceConfig = {
  theme: 'system'
};

const PROVIDER_ORDER = ['searxng', 'tavily', 'bing', 'duckduckgo', 'baidu'] as const;
const PRIMARY_PROVIDER_IDS = ['searxng', 'tavily'] as const;
const FALLBACK_PROVIDER_IDS = ['bing', 'duckduckgo', 'baidu'] as const;
const PROVIDER_TEXT = {
  searxng: {
    name: 'settings.webSearchProvider.searxng',
    help: 'settings.webSearchProviderHelp.searxng'
  },
  tavily: {
    name: 'settings.webSearchProvider.tavily',
    help: 'settings.webSearchProviderHelp.tavily'
  },
  bing: {
    name: 'settings.webSearchProvider.bing',
    help: 'settings.webSearchProviderHelp.bing'
  },
  duckduckgo: {
    name: 'settings.webSearchProvider.duckduckgo',
    help: 'settings.webSearchProviderHelp.duckduckgo'
  },
  baidu: {
    name: 'settings.webSearchProvider.baidu',
    help: 'settings.webSearchProviderHelp.baidu'
  }
} as const;

type ProviderId = typeof PROVIDER_ORDER[number];
type ProviderStatus = 'ready' | 'disabled' | 'needs_base_url' | 'needs_api_key';
type ProviderSnapshot = WebSearchConfig['providers'];

const PROVIDER_STATUS_TEXT = {
  ready: 'settings.webSearchStatus.ready',
  disabled: 'settings.webSearchStatus.disabled',
  needs_base_url: 'settings.webSearchStatus.needs_base_url',
  needs_api_key: 'settings.webSearchStatus.needs_api_key'
} as const;

function ensureProviderOrder(value: WebSearchConfig['preferredProviders']) {
  const normalized = value.filter((item, index) => value.indexOf(item) === index);
  return [
    ...normalized,
    ...PROVIDER_ORDER.filter((item) => !normalized.includes(item))
  ] as WebSearchConfig['preferredProviders'];
}

function moveProvider(
  providers: WebSearchConfig['preferredProviders'],
  providerId: ProviderId,
  direction: 'up' | 'down'
) {
  const nextProviders = [...ensureProviderOrder(providers)];
  const currentIndex = nextProviders.indexOf(providerId);
  if (currentIndex === -1) {
    return nextProviders;
  }

  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= nextProviders.length) {
    return nextProviders;
  }

  [nextProviders[currentIndex], nextProviders[targetIndex]] = [nextProviders[targetIndex], nextProviders[currentIndex]];
  return nextProviders;
}

function getProviderStatus(config: WebSearchConfig, providerId: ProviderId): ProviderStatus {
  if (providerId === 'searxng') {
    if (!config.providers.searxng.enabled) {
      return 'disabled';
    }
    if (!config.providers.searxng.baseUrl.trim()) {
      return 'needs_base_url';
    }
    return 'ready';
  }

  if (providerId === 'tavily') {
    if (!config.providers.tavily.enabled) {
      return 'disabled';
    }
    if (!config.providers.tavily.baseUrl.trim()) {
      return 'needs_base_url';
    }
    if (!config.providers.tavily.apiKey.trim() && !config.providers.tavily.apiKeyStored) {
      return 'needs_api_key';
    }
    return 'ready';
  }

  return config.providers[providerId].enabled ? 'ready' : 'disabled';
}

function hasEnabledWebSearch(config: WebSearchConfig) {
  return PROVIDER_ORDER.some((providerId) => config.providers[providerId].enabled);
}

function createDisabledProviderSnapshot(providers: ProviderSnapshot): ProviderSnapshot {
  return {
    searxng: {
      ...providers.searxng,
      enabled: false
    },
    tavily: {
      ...providers.tavily,
      enabled: false
    },
    bing: {
      enabled: false
    },
    duckduckgo: {
      enabled: false
    },
    baidu: {
      enabled: false
    }
  };
}

function createEnabledProviderSnapshot(current: ProviderSnapshot, previous: ProviderSnapshot | null): ProviderSnapshot {
  const snapshot = previous ?? current;

  return {
    searxng: {
      ...snapshot.searxng,
      enabled: snapshot.searxng.enabled && snapshot.searxng.baseUrl.trim().length > 0
    },
    tavily: {
      ...snapshot.tavily,
      enabled: snapshot.tavily.enabled
        && snapshot.tavily.baseUrl.trim().length > 0
        && (snapshot.tavily.apiKey.trim().length > 0 || Boolean(snapshot.tavily.apiKeyStored))
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
  };
}

export const GeneralSettings = memo(function GeneralSettings() {
  const { t, locale, setLocale } = useTranslation();
  const [appearanceConfig, setAppearanceConfig] = useState<AppearanceConfig>(DEFAULT_APPEARANCE_CONFIG);
  const [webSearchConfig, setWebSearchConfig] = useState<WebSearchConfig>(DEFAULT_WEB_SEARCH_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [lastEnabledProviders, setLastEnabledProviders] = useState<ProviderSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadWebSearchConfig = async () => {
      try {
        const [appearance, webSearch] = await Promise.all([
          window.kairo.invoke(KAIRO_INVOKE.configGetAppearance),
          window.kairo.invoke(KAIRO_INVOKE.configGetWebSearch)
        ]);
        if (!cancelled) {
          if (appearance) {
            setAppearanceConfig(appearance);
          }
          if (webSearch) {
            setWebSearchConfig(webSearch);
          }
        }
      } catch (error) {
        console.error('Failed to load web search settings:', error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadWebSearchConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleThemeChange = async (theme: AppearanceTheme) => {
    const nextAppearance: AppearanceConfig = { ...appearanceConfig, theme };
    setAppearanceConfig(nextAppearance);
    applyAppearanceTheme(theme);
    emitAppearanceThemeChanged(theme);
    try {
      await window.kairo.invoke(KAIRO_INVOKE.configSaveAppearance, nextAppearance);
    } catch (error) {
      console.error('Failed to save appearance settings:', error);
    }
  };

  const handleClipboardChange = async (enabled: boolean) => {
    const previous = appearanceConfig;
    const next = { ...appearanceConfig, clipboardSuggestions: enabled };
    setAppearanceConfig(next);
    try {
      await window.kairo.invoke(KAIRO_INVOKE.configSaveAppearance, next);
    } catch (error) {
      setAppearanceConfig(previous);
      console.error('Failed to save clipboard preference:', error);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setSaveStatus('idle');
      const result = await window.kairo.invoke(KAIRO_INVOKE.configSaveWebSearch, webSearchConfig);
      setSaveStatus(result.success ? 'success' : 'error');
      if (result.success && webSearchConfig.providers.tavily.apiKey.trim()) {
        setWebSearchConfig((current) => ({
          ...current,
          providers: {
            ...current.providers,
            tavily: {
              ...current.providers.tavily,
              apiKey: '',
              apiKeyStored: true
            }
          }
        }));
      }
    } catch (error) {
      console.error('Failed to save web search settings:', error);
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  };

  const orderedProviders = ensureProviderOrder(webSearchConfig.preferredProviders);
  const searchEnabled = hasEnabledWebSearch(webSearchConfig);
  const readyProviders = orderedProviders.filter((providerId) => getProviderStatus(webSearchConfig, providerId) === 'ready');
  const readyCount = readyProviders.length;
  const connectedApiCount = PRIMARY_PROVIDER_IDS.filter((providerId) => getProviderStatus(webSearchConfig, providerId) === 'ready').length;
  const fallbackReadyCount = FALLBACK_PROVIDER_IDS.filter((providerId) => getProviderStatus(webSearchConfig, providerId) === 'ready').length;
  const readyProviderPreview = readyProviders
    .slice(0, 3)
    .map((providerId) => t(PROVIDER_TEXT[providerId].name))
    .join(' · ');
  const webSearchStatusKey = !searchEnabled
    ? 'settings.webSearchStatus.disabled'
    : readyCount > 0
      ? 'settings.webSearchStatus.ready'
      : 'settings.webSearchStatus.needs_setup';

  return (
    <div className="settings-shell">
      <section className="settings-panel settings-panel--span-2 settings-panel--allow-overflow">
        <div className="settings-panel-body">
          <div className="form-group form-group-tight">
            <label>{t('settings.theme')}</label>
            <Select
              aria-label={t('settings.theme')} value={appearanceConfig.theme}
              onChange={(value) => {
                void handleThemeChange(value as AppearanceTheme);
              }}
              className="select-fill"
              options={[
                {
                  value: 'system',
                  label: t('settings.theme.system'),
                  description: t('settings.themeHelp.system')
                },
                {
                  value: 'light',
                  label: t('settings.theme.light'),
                  description: t('settings.themeHelp.light')
                },
                {
                  value: 'dark',
                  label: t('settings.theme.dark'),
                  description: t('settings.themeHelp.dark')
                },
                {
                  value: 'slate',
                  label: t('settings.theme.slate'),
                  description: t('settings.themeHelp.slate')
                },
                {
                  value: 'warm',
                  label: t('settings.theme.warm'),
                  description: t('settings.themeHelp.warm')
                }
              ]}
            />
            <div className="form-help">{t('settings.preferencesThemeHelp')}</div>
          </div>

          <div className="form-group form-group-tight">
            <label>{t('general.language')}</label>
            <Select
              aria-label={t('general.language')} value={locale}
              onChange={(value) => setLocale(value as 'zh' | 'en')}
              className="select-fill"
              options={[
                { value: 'zh', label: t('general.language.zh') },
                { value: 'en', label: t('general.language.en') }
              ]}
            />
            <div className="form-help">{t('settings.preferencesLanguageHelp')}</div>
          </div>
          <label className="settings-toggle-card">
            <div className="settings-toggle-copy">
              <div className="settings-toggle-title">{t('settings.clipboardSuggestions')}</div>
              <div className="settings-toggle-help">{t('settings.clipboardSuggestionsHelp')}</div>
            </div>
            <input data-clipboard-suggestions className="settings-toggle-input" type="checkbox" disabled={loading} checked={appearanceConfig.clipboardSuggestions === true} onChange={event => void handleClipboardChange(event.target.checked)} />
          </label>
        </div>
      </section>

      <section className="settings-panel settings-panel--span-2">
        <div className="settings-panel-body">
          <label className={`settings-toggle-card settings-toggle-card--featured ${searchEnabled ? 'is-enabled' : ''}`}>
            <div className="settings-toggle-copy">
              <div className="settings-toggle-header">
                <span className="settings-toggle-title">{t('settings.webSearch')}</span>
                <span className={`shell-status-badge ${searchEnabled && readyCount > 0 ? 'enabled' : 'disabled'}`}>
                  {t(webSearchStatusKey)}
                </span>
              </div>
              <div className="settings-toggle-help">
                {searchEnabled ? t('settings.webSearchEnabledHelp') : t('settings.webSearchDisabledHelp')}
              </div>
            </div>
            <input
              className="settings-toggle-input"
              type="checkbox"
              checked={searchEnabled}
              disabled={loading || saving}
              onChange={(event) => {
                const enabled = event.target.checked;
                if (!enabled) {
                  setLastEnabledProviders(webSearchConfig.providers);
                }
                setWebSearchConfig((current) => ({
                  ...current,
                  providers: enabled
                    ? createEnabledProviderSnapshot(current.providers, lastEnabledProviders)
                    : createDisabledProviderSnapshot(current.providers)
                }));
                setSaveStatus('idle');
              }}
            />
          </label>

          <div className="settings-stat-grid">
            <div className="settings-stat-card">
              <span className="settings-summary-label">{t('settings.webSearchReadyNow')}</span>
              <strong className="settings-summary-value">{readyCount}</strong>
              <div className="settings-stat-meta">
                {readyProviderPreview || t('settings.webSearchSourcePreviewNone')}
              </div>
            </div>
            <div className="settings-stat-card">
              <span className="settings-summary-label">{t('settings.webSearchBuiltInBackups')}</span>
              <strong className="settings-summary-value">{fallbackReadyCount}</strong>
              <div className="settings-stat-meta">{t('settings.webSearchBuiltInBackupsHelp')}</div>
            </div>
            <div className="settings-stat-card">
              <span className="settings-summary-label">{t('settings.webSearchConnectedApis')}</span>
              <strong className="settings-summary-value">{connectedApiCount}</strong>
              <div className="settings-stat-meta">{t('settings.webSearchConnectedApisHelp')}</div>
            </div>
          </div>

          <div className="settings-inline-note">
            {searchEnabled ? t('settings.webSearchRecommendationOn') : t('settings.webSearchRecommendationOff')}
          </div>

          <div className={`settings-linked-advanced ${showAdvanced ? 'is-open' : ''}`}>
            <div className="settings-advanced-bar">
              <div className="settings-advanced-copy">
                <div className="settings-advanced-title">{t('settings.webSearchAdvancedTitle')}</div>
                <div className="settings-advanced-help">{t('settings.webSearchAdvancedDescription')}</div>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowAdvanced((current) => !current)}
              >
                {showAdvanced ? t('settings.webSearchHideAdvanced') : t('settings.webSearchShowAdvanced')}
              </button>
            </div>

            {showAdvanced && (
              <div className="settings-advanced-content">
                <div className="settings-advanced-grid">
                  <div className="settings-provider-stack">
                    <div className="settings-provider-block">
                      <div className="settings-provider-block-header">
                        <div className="settings-provider-block-title">{t('settings.searchStrategyTitle')}</div>
                        <div className="settings-provider-block-help">{t('settings.searchStrategyDescription')}</div>
                      </div>
                      <div className="form-group form-group-tight">
                        <label>{t('settings.webSearchTimeout')}</label>
                        <input
                          className="form-control"
                          type="number"
                          min={2000}
                          max={30000}
                          step={1000}
                          value={webSearchConfig.timeoutMs}
                          disabled={loading || saving}
                          onChange={(event) => {
                            const nextValue = Number(event.target.value);
                            setWebSearchConfig((current) => ({
                              ...current,
                              timeoutMs: Number.isFinite(nextValue) ? nextValue : current.timeoutMs
                            }));
                            setSaveStatus('idle');
                          }}
                        />
                      </div>
                    </div>

                    <div className="settings-provider-block">
                      <div className="settings-provider-block-header">
                        <div className="settings-provider-block-title">{t('settings.providerConfigTitle')}</div>
                        <div className="settings-provider-block-help">{t('settings.providerConfigDescription')}</div>
                      </div>
                      <div className="settings-toggle-list">
                        {PRIMARY_PROVIDER_IDS.map((providerId) => {
                          const status = getProviderStatus(webSearchConfig, providerId);
                          const checked = webSearchConfig.providers[providerId].enabled;
                          const labelKey = providerId === 'searxng'
                            ? 'settings.webSearchSearxngEnabled'
                            : 'settings.webSearchTavilyEnabled';
                          return (
                            <label
                              key={providerId}
                              className={`settings-toggle-card ${checked ? 'is-enabled' : ''}`}
                            >
                              <div className="settings-toggle-copy">
                                <div className="settings-toggle-header">
                                  <span className="settings-toggle-title">{t(PROVIDER_TEXT[providerId].name)}</span>
                                  <span className={`shell-status-badge ${status === 'ready' ? 'enabled' : 'disabled'}`}>
                                    {t(PROVIDER_STATUS_TEXT[status])}
                                  </span>
                                </div>
                                <div className="settings-toggle-help">{t(labelKey)}</div>
                              </div>
                              <input
                                className="settings-toggle-input"
                                type="checkbox"
                                checked={checked}
                                disabled={loading || saving}
                                onChange={(event) => {
                                  const enabled = event.target.checked;
                                  setWebSearchConfig((current) => ({
                                    ...current,
                                    providers: {
                                      ...current.providers,
                                      [providerId]: {
                                        ...current.providers[providerId],
                                        enabled
                                      }
                                    }
                                  }));
                                  setSaveStatus('idle');
                                }}
                              />
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    <div className="settings-provider-stack">
                      <div className="settings-provider-block">
                        <div className="settings-provider-block-header">
                          <div className="settings-provider-block-title">{t('settings.webSearchProvider.searxng')}</div>
                          <div className="settings-provider-block-help">{t('settings.webSearchProviderHelp.searxng')}</div>
                        </div>
                        <div className="form-group form-group-tight">
                          <label>{t('settings.webSearchSearxngBaseUrl')}</label>
                          <input
                            className="form-control"
                            type="text"
                            value={webSearchConfig.providers.searxng.baseUrl}
                            disabled={loading || saving}
                            placeholder="https://your-searxng.example.com"
                            onChange={(event) => {
                              const baseUrl = event.target.value;
                              setWebSearchConfig((current) => ({
                                ...current,
                                providers: {
                                  ...current.providers,
                                  searxng: {
                                    ...current.providers.searxng,
                                    baseUrl
                                  }
                                }
                              }));
                              setSaveStatus('idle');
                            }}
                          />
                          <div className="form-help">{t('settings.webSearchSearxngBaseUrlHelp')}</div>
                        </div>
                      </div>

                      <div className="settings-provider-block">
                        <div className="settings-provider-block-header">
                          <div className="settings-provider-block-title">{t('settings.webSearchProvider.tavily')}</div>
                          <div className="settings-provider-block-help">{t('settings.webSearchProviderHelp.tavily')}</div>
                        </div>
                        <div className="form-group">
                          <label>{t('settings.webSearchTavilyBaseUrl')}</label>
                          <input
                            className="form-control"
                            type="text"
                            value={webSearchConfig.providers.tavily.baseUrl}
                            disabled={loading || saving}
                            placeholder="https://api.tavily.com"
                            onChange={(event) => {
                              const baseUrl = event.target.value;
                              setWebSearchConfig((current) => ({
                                ...current,
                                providers: {
                                  ...current.providers,
                                  tavily: {
                                    ...current.providers.tavily,
                                    baseUrl
                                  }
                                }
                              }));
                              setSaveStatus('idle');
                            }}
                          />
                          <div className="form-help">{t('settings.webSearchTavilyBaseUrlHelp')}</div>
                        </div>

                        <div className="form-group form-group-tight">
                          <label>{t('settings.webSearchTavilyApiKey')}</label>
                          <input
                            className="form-control"
                            type="password"
                            value={webSearchConfig.providers.tavily.apiKey}
                            disabled={loading || saving}
                            placeholder={webSearchConfig.providers.tavily.apiKeyStored ? '••••••••' : 'tvly-...'}
                            onChange={(event) => {
                              const apiKey = event.target.value;
                              setWebSearchConfig((current) => ({
                                ...current,
                                providers: {
                                  ...current.providers,
                                  tavily: {
                                    ...current.providers.tavily,
                                    apiKey
                                  }
                                }
                              }));
                              setSaveStatus('idle');
                            }}
                          />
                          <div className="form-help">{t('settings.webSearchTavilyApiKeyHelp')}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="settings-provider-stack">
                    <div className="settings-provider-block">
                      <div className="settings-provider-block-header">
                        <div className="settings-provider-block-title">{t('settings.fallbackTitle')}</div>
                        <div className="settings-provider-block-help">{t('settings.fallbackDescription')}</div>
                      </div>
                      <div className="settings-toggle-list">
                        {FALLBACK_PROVIDER_IDS.map((providerId) => {
                          const status = getProviderStatus(webSearchConfig, providerId);
                          const checked = webSearchConfig.providers[providerId].enabled;
                          return (
                            <label
                              key={providerId}
                              className={`settings-toggle-card ${checked ? 'is-enabled' : ''}`}
                            >
                              <div className="settings-toggle-copy">
                                <div className="settings-toggle-header">
                                  <span className="settings-toggle-title">{t(PROVIDER_TEXT[providerId].name)}</span>
                                  <span className={`shell-status-badge ${status === 'ready' ? 'enabled' : 'disabled'}`}>
                                    {t(PROVIDER_STATUS_TEXT[status])}
                                  </span>
                                </div>
                                <div className="settings-toggle-help">{t(PROVIDER_TEXT[providerId].help)}</div>
                              </div>
                              <input
                                className="settings-toggle-input"
                                type="checkbox"
                                checked={checked}
                                disabled={loading || saving}
                                onChange={(event) => {
                                  const enabled = event.target.checked;
                                  setWebSearchConfig((current) => ({
                                    ...current,
                                    providers: {
                                      ...current.providers,
                                      [providerId]: {
                                        ...current.providers[providerId],
                                        enabled
                                      }
                                    }
                                  }));
                                  setSaveStatus('idle');
                                }}
                              />
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    <div className="settings-provider-block">
                      <div className="settings-provider-block-header">
                        <div className="settings-provider-block-title">{t('settings.priorityTitle')}</div>
                        <div className="settings-provider-block-help">{t('settings.priorityDescription')}</div>
                      </div>
                      <div className="web-search-provider-order">
                        {orderedProviders.map((providerId, index) => {
                          const status = getProviderStatus(webSearchConfig, providerId);
                          const isReady = status === 'ready';
                          return (
                            <div key={providerId} className="web-search-provider-row">
                              <div className="web-search-provider-rank">{index + 1}</div>
                              <div className="web-search-provider-meta">
                                <div className="web-search-provider-title-row">
                                  <span className="web-search-provider-name">{t(PROVIDER_TEXT[providerId].name)}</span>
                                  <span className={`shell-status-badge ${isReady ? 'enabled' : 'disabled'}`}>
                                    {t(PROVIDER_STATUS_TEXT[status])}
                                  </span>
                                </div>
                                <div className="form-help form-help-tight">
                                  {t(PROVIDER_TEXT[providerId].help)}
                                </div>
                              </div>
                              <div className="web-search-provider-actions">
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-icon"
                                  onClick={() => {
                                    setWebSearchConfig((current) => ({
                                      ...current,
                                      preferredProviders: moveProvider(current.preferredProviders, providerId, 'up')
                                    }));
                                    setSaveStatus('idle');
                                  }}
                                  disabled={loading || saving || index === 0}
                                  title={t('settings.webSearchMoveUp')}
                                >
                                  <IconArrowUp size={16} />
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-icon"
                                  onClick={() => {
                                    setWebSearchConfig((current) => ({
                                      ...current,
                                      preferredProviders: moveProvider(current.preferredProviders, providerId, 'down')
                                    }));
                                    setSaveStatus('idle');
                                  }}
                                  disabled={loading || saving || index === orderedProviders.length - 1}
                                  title={t('settings.webSearchMoveDown')}
                                >
                                  <IconArrowDown size={16} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="form-help">{t('settings.webSearchPreferredProvidersHelp')}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="settings-save-strip">
            <div className="settings-save-strip-copy">
              <div className="settings-save-strip-title">{t('settings.webSearchSaveHintTitle')}</div>
              <div className="settings-save-strip-help">{t('settings.webSearchSaveHintDescription')}</div>
            </div>
            <div className="settings-save-strip-actions">
              {saveStatus === 'success' && (
                <div className="settings-save-state success">{t('settings.webSearchSaveSuccess')}</div>
              )}
              {saveStatus === 'error' && (
                <div className="settings-save-state error">{t('settings.webSearchSaveError')}</div>
              )}
              <button className={`btn btn-primary ${saving ? 'is-loading' : ''}`} onClick={() => void handleSave()} disabled={loading || saving}>
                {saving && <IconRefresh size={14} className="spinning" />}
                {saving ? t('common.loading') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
});
