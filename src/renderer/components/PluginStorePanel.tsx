import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { IconPlugin, IconTrash, IconRefresh } from './Icons';
import './PluginStorePanel.css';
import { useTranslation } from '../hooks/useTranslation';
import type {
  AgentConfig,
  AppConfirmationOptions,
  AppNotice,
  PluginCapabilityDeclaration,
  PluginManifest,
  PluginRegistryEntry
} from '../types';
import { KAIRO_INVOKE } from '../../shared/ipc';
import { createErrorNotice } from '../hooks/errorUtils';

type InstalledPlugin = PluginRegistryEntry;

interface PluginStorePanelProps {
  onClearNotice: () => void;
  onReportNotice: (notice: AppNotice) => void;
  onRequestConfirmation: (request: AppConfirmationOptions) => Promise<boolean>;
}

export const PluginStorePanel = memo(function PluginStorePanel({ onClearNotice, onReportNotice, onRequestConfirmation }: PluginStorePanelProps) {
  const { t } = useTranslation();
  const [storePlugins, setStorePlugins] = useState<PluginManifest[]>([]);
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>([]);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'installed' | 'store'>('installed');

  const handleInstallClick = (id: string) => {
    setSelectedPluginId(id);
    setInstallModalOpen(true);
  };

  const handleConfirmInstall = (scope: string) => {
    if (selectedPluginId) {
      handleInstall(selectedPluginId, scope);
    }
    setInstallModalOpen(false);
    setSelectedPluginId(null);
  };

  const loadPlugins = useCallback(async () => {
    setLoading(true);
    onClearNotice();
    try {
      const [store, installed, fetchedAgents] = await Promise.all([
        window.kairo.invoke(KAIRO_INVOKE.pluginsGetStore),
        window.kairo.invoke(KAIRO_INVOKE.pluginsGetInstalled),
        window.kairo.invoke(KAIRO_INVOKE.configGetAgents)
      ]);
      
      // Inject native tools as installed plugins
      const nativeTools: InstalledPlugin[] = [
        {
          id: 'web_search',
          name: 'Web Search',
          description: 'Search the internet for real-time information.',
          version: '1.0.0',
          author: 'KairoPilot',
          installedAt: Date.now(),
          filePath: 'built-in',
          scope: 'public',
          icon: '🔍',
          riskLevel: 'medium',
          tools: [
            { name: 'web_search', description: 'Searches configured web providers.' }
          ],
          capabilities: [
            {
              id: 'network',
              label: 'Network access',
              description: 'Sends search requests to configured providers.',
              riskLevel: 'medium',
              requiredPermissions: {
                network: {
                  enabled: true
                }
              }
            }
          ]
        },
        {
          id: 'fetch_webpage',
          name: 'Fetch Webpage',
          description: 'Fetch and read content from specific URLs.',
          version: '1.0.0',
          author: 'KairoPilot',
          installedAt: Date.now(),
          filePath: 'built-in',
          scope: 'public',
          icon: '🌐',
          riskLevel: 'medium',
          tools: [
            { name: 'fetch_webpage', description: 'Fetches and extracts webpage content.' }
          ],
          capabilities: [
            {
              id: 'network',
              label: 'Network access',
              description: 'Requests user-supplied URLs.',
              riskLevel: 'medium',
              requiredPermissions: {
                network: {
                  enabled: true
                }
              }
            }
          ]
        }
      ];
      
      setStorePlugins(store as unknown as PluginManifest[]);
      setInstalledPlugins([...nativeTools, ...(installed as unknown as InstalledPlugin[])]);
      setAgents(fetchedAgents as AgentConfig[]);
    } catch (e) {
      onReportNotice(createErrorNotice(t('plugins.error.load', { error: e instanceof Error ? e.message : 'Unknown error' }), 'load_plugins'));
    } finally {
      setLoading(false);
    }
  }, [onClearNotice, onReportNotice, t]);

  useEffect(() => {
    void loadPlugins();
  }, [loadPlugins]);

  const handleInstall = async (id: string, scope: string = 'public') => {
    setActionInProgress(id);
    onClearNotice();
    try {
      const result = await window.kairo.invoke(KAIRO_INVOKE.pluginsInstall, { id, scope });
      if (result.success) {
        await loadPlugins();
        setActiveTab('installed');
      } else {
        onReportNotice(createErrorNotice(t('plugins.error.install', { error: result.error || 'Unknown error' }), 'install_plugin'));
      }
    } catch (e) {
      onReportNotice(createErrorNotice(t('plugins.error.install', { error: e instanceof Error ? e.message : 'Unknown error' }), 'install_plugin'));
    } finally {
      setActionInProgress(null);
    }
  };

  const handleUninstall = async (id: string, scope: string) => {
    setActionInProgress(`${id}-${scope}`);
    onClearNotice();
    try {
      const result = await window.kairo.invoke(KAIRO_INVOKE.pluginsUninstall, { id, scope });
      if (result.success) {
        await loadPlugins();
      } else {
        onReportNotice(createErrorNotice(t('plugins.error.uninstall', { error: result.error || 'Unknown error' }), 'uninstall_plugin'));
      }
    } catch (e) {
      onReportNotice(createErrorNotice(t('plugins.error.uninstall', { error: e instanceof Error ? e.message : 'Unknown error' }), 'uninstall_plugin'));
    } finally {
      setActionInProgress(null);
    }
  };

  const uninstalledPlugins = useMemo(
    () =>
      storePlugins
        .filter((plugin) => !installedPlugins.find((installedPlugin) => installedPlugin.id === plugin.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [installedPlugins, storePlugins]
  );

  const publicPlugins = useMemo(
    () =>
      installedPlugins
        .filter((plugin) => plugin.scope === 'public')
        .sort((a, b) => {
          if (a.filePath === 'built-in' && b.filePath !== 'built-in') {
            return -1;
          }
          if (a.filePath !== 'built-in' && b.filePath === 'built-in') {
            return 1;
          }
          if (b.installedAt !== a.installedAt) {
            return b.installedAt - a.installedAt;
          }
          return a.name.localeCompare(b.name);
        }),
    [installedPlugins]
  );

  const sortedAgents = useMemo(
    () => [...agents].sort((a, b) => a.name.localeCompare(b.name)),
    [agents]
  );
  const selectedPlugin = useMemo(
    () => storePlugins.find((plugin) => plugin.id === selectedPluginId) || null,
    [selectedPluginId, storePlugins]
  );

  return (
    <div className="config-panel">
      <div className="config-header plugin-panel-header">
        <div className="plugin-panel-header-row">
          <div>
            <div className="config-title">
              <div className="plugin-panel-title-icon">
                <IconPlugin size={20} />
              </div>
              {t('nav.plugins')}
            </div>
            <div className="config-subtitle">{t('plugins.subtitle')}</div>
          </div>
          <button type="button" onClick={loadPlugins} className={`btn btn-secondary ${loading ? 'is-loading' : ''}`} disabled={loading} title={t('common.refresh')}>
            <IconRefresh size={16} className={loading ? 'spinning' : ''} />
          </button>
        </div>

        <div className="store-tabs">
          <button 
            className={`store-tab ${activeTab === 'installed' ? 'active' : ''}`}
            onClick={() => setActiveTab('installed')}
          >
            {t('plugins.installedTab')}
          </button>
          <button 
            className={`store-tab ${activeTab === 'store' ? 'active' : ''}`}
            onClick={() => setActiveTab('store')}
          >
            {t('plugins.uninstalledTab')}
          </button>
        </div>
      </div>

      <div className="config-content plugin-panel-content">
        {loading && (
          <div className="plugin-panel-loading">
            {t('plugins.loading')}
          </div>
        )}

        {!loading && activeTab === 'installed' && (
          <div className="installed-plugins-container">
            <h3 className="store-section-title">{t('plugins.installedTitle')}</h3>
            {publicPlugins.length === 0 ? (
              <div className="empty-state">{t('plugins.noInstalled')}</div>
            ) : (
              <div className="plugin-grid">
                {publicPlugins.map(plugin => (
                  <InstalledPluginItem 
                    key={`${plugin.id}-${plugin.scope}`} 
                    plugin={plugin} 
                    onUninstall={() => handleUninstall(plugin.id, plugin.scope)}
                    onRequestConfirmation={onRequestConfirmation}
                    isWorking={actionInProgress === `${plugin.id}-${plugin.scope}`}
                    isNative={plugin.filePath === 'built-in'}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {!loading && activeTab === 'store' && (
          <div>
            {uninstalledPlugins.length === 0 ? (
              <div className="empty-state plugin-empty-state">
                <div className="plugin-empty-icon">🛒</div>
                <h3 className="plugin-empty-title">{t('plugins.marketplace')}</h3>
                <p className="plugin-empty-description">{t('plugins.allInstalled')}</p>
              </div>
            ) : (
              <div className="plugin-grid">
                {uninstalledPlugins.map(plugin => (
                  <div key={plugin.id} className="config-card plugin-card">
                    <div className="plugin-card-header">
                      <div className="plugin-card-icon">
                        {plugin.icon || '🧩'}
                      </div>
                      <div className="plugin-card-copy">
                        <h4 className="plugin-card-title">{plugin.name}</h4>
                        <div className="plugin-card-meta">
                          v{plugin.version} • {t('plugins.by', { author: plugin.author })}
                        </div>
                      </div>
                    </div>
                    
                    <p className="plugin-card-description">
                      {plugin.description}
                    </p>
                    <PluginCapabilitySummary plugin={plugin} />

                    <div className="store-card-actions">
                      <button 
                        className="btn btn-primary"
                        onClick={() => handleInstallClick(plugin.id)}
                        disabled={actionInProgress === plugin.id}
                      >
                        {actionInProgress === plugin.id ? <IconRefresh size={14} className="spinning" /> : t('plugins.install')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {installModalOpen && (
        <div className="modal-overlay" onClick={() => setInstallModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 className="plugin-modal-title">{t('plugins.installReview')}</h3>
            {selectedPlugin && (
              <div className="plugin-install-review">
                <div className="plugin-card-header">
                  <div className="plugin-card-icon">
                    {selectedPlugin.icon || '🧩'}
                  </div>
                  <div className="plugin-card-copy">
                    <h4 className="plugin-card-title">{selectedPlugin.name}</h4>
                    <div className="plugin-card-meta">
                      v{selectedPlugin.version} • {t('plugins.by', { author: selectedPlugin.author })}
                    </div>
                  </div>
                </div>
                <p className="plugin-card-description">
                  {selectedPlugin.description}
                </p>
                <PluginCapabilitySummary plugin={selectedPlugin} />
              </div>
            )}
            <div className="plugin-modal-section-label">{t('plugins.installScope')}</div>
            <div className="plugin-modal-scope-list">
              <button
                type="button"
                className="btn btn-secondary plugin-modal-scope-btn"
                onClick={() => handleConfirmInstall('public')}
              >
                {t('plugins.publicScope')}
              </button>
              {sortedAgents.map(agent => (
                <button
                  type="button"
                  key={agent.id}
                  className="btn btn-secondary plugin-modal-scope-btn"
                  onClick={() => handleConfirmInstall(`agent:${agent.id}`)}
                >
                  {t('plugins.agentScope', { agent: agent.name })}
                </button>
              ))}
            </div>
            <div className="plugin-modal-actions">
              <button type="button" className="btn" onClick={() => setInstallModalOpen(false)}>{t('common.cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

function InstalledPluginItem({
  plugin,
  onUninstall,
  onRequestConfirmation,
  isWorking,
  isNative
}: {
  plugin: InstalledPlugin;
  onUninstall: () => void;
  onRequestConfirmation: (request: AppConfirmationOptions) => Promise<boolean>;
  isWorking: boolean;
  isNative?: boolean;
}) {
  const { t } = useTranslation();
  
  return (
    <div className="config-card plugin-card">
      <div className="plugin-card-header">
        <div className="plugin-card-icon">
          {plugin.icon || '🧩'}
        </div>
        <div className="plugin-card-copy">
          <h4 className="plugin-card-title">{plugin.name}</h4>
          <div className="plugin-card-meta">
            v{plugin.version} • {t('plugins.by', { author: plugin.author })}
          </div>
        </div>
      </div>
      
      <p className="plugin-card-description">
        {plugin.description}
      </p>
      <PluginCapabilitySummary plugin={plugin} />

      <div className="plugin-card-meta">
        <strong>{t('plugins.installedAt')}:</strong> {new Date(plugin.installedAt).toLocaleString()}
      </div>

      <div className="store-card-actions">
        <button 
          type="button"
          className={`btn btn-secondary btn-sm btn-danger plugin-uninstall-btn ${isNative ? 'is-native' : ''} ${isWorking ? 'is-loading' : ''}`}
          onClick={async (e) => {
            e.stopPropagation();
            const confirmed = await onRequestConfirmation({
              title: t('common.confirm'),
              message: `${t('common.confirm')} ${t('plugins.uninstall')}?`,
              confirmLabel: t('plugins.uninstall'),
              variant: 'danger'
            });
            if (confirmed) {
              onUninstall();
            }
          }}
          disabled={isWorking || isNative}
        >
          {isWorking ? <IconRefresh size={14} className="spinning" /> : <IconTrash size={14} />}
          <span className="btn-text-inline">{isNative ? t('plugins.installed') : t('plugins.uninstall')}</span>
        </button>
      </div>
    </div>
  );
}

function PluginCapabilitySummary({ plugin }: { plugin: PluginManifest }) {
  const { t } = useTranslation();
  const tools = plugin.tools || [];
  const capabilities = plugin.capabilities || [];
  const riskLevel = plugin.riskLevel || 'low';

  return (
    <div className="plugin-capability-summary">
      <div className={`plugin-risk-badge risk-${riskLevel}`}>
        {t('plugins.risk')}: {t(getRiskTranslationKey(riskLevel))}
      </div>
      {tools.length > 0 && (
        <div className="plugin-detail-block">
          <div className="plugin-detail-label">{t('plugins.tools')}</div>
          <div className="plugin-chip-list">
            {tools.map((tool) => (
              <span className="plugin-chip" key={tool.name} title={tool.description}>
                {tool.name}
              </span>
            ))}
          </div>
        </div>
      )}
      {capabilities.length > 0 && (
        <div className="plugin-detail-block">
          <div className="plugin-detail-label">{t('plugins.capabilities')}</div>
          <div className="plugin-capability-list">
            {capabilities.map((capability) => (
              <PluginCapabilityItem capability={capability} key={capability.id} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PluginCapabilityItem({ capability }: { capability: PluginCapabilityDeclaration }) {
  const { t } = useTranslation();
  const permissionLabels = getRequiredPermissionLabels(capability, t);

  return (
    <div className="plugin-capability-item" title={capability.description}>
      <span className={`plugin-capability-dot risk-${capability.riskLevel}`} />
      <span>{capability.label}</span>
      <span className="plugin-capability-risk">{t(getRiskTranslationKey(capability.riskLevel))}</span>
      {permissionLabels.length > 0 && (
        <span className="plugin-capability-permissions">
          {permissionLabels.join(' · ')}
        </span>
      )}
    </div>
  );
}

function getRequiredPermissionLabels(
  capability: PluginCapabilityDeclaration,
  t: ReturnType<typeof useTranslation>['t']
) {
  const required = capability.requiredPermissions;
  if (!required) {
    return [];
  }

  const labels: string[] = [];
  if (required.fileSystem?.read) {
    labels.push(t('plugins.permission.fileRead'));
  }
  if (required.fileSystem?.write) {
    labels.push(t('plugins.permission.fileWrite'));
  }
  if (required.network?.enabled || (required.network?.domains?.length ?? 0) > 0) {
    const domains = required.network?.domains?.join(', ');
    labels.push(domains
      ? t('plugins.permission.networkDomains', { domains })
      : t('plugins.permission.network'));
  }
  if (required.shell?.enabled || (required.shell?.commands?.length ?? 0) > 0) {
    const commands = required.shell?.commands?.join(', ');
    labels.push(commands
      ? t('plugins.permission.shellCommands', { commands })
      : t('plugins.permission.shell'));
  }

  return labels;
}

function getRiskTranslationKey(riskLevel: PluginCapabilityDeclaration['riskLevel']) {
  switch (riskLevel) {
    case 'critical':
      return 'plugins.risk.critical';
    case 'high':
      return 'plugins.risk.high';
    case 'medium':
      return 'plugins.risk.medium';
    default:
      return 'plugins.risk.low';
  }
}
