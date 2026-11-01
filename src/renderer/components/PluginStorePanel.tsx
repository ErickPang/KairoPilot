import {CapabilityListItem} from './CapabilityListItem';
import {CirclePause} from 'lucide-react';
import './CapabilityLibrary.css';
import { WorkbenchDialog } from './WorkbenchDialog';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { IconPlugin, IconTrash, IconRefresh, IconSearch, IconSettings, IconPlus, IconCheck } from './Icons';
import './PluginStorePanel.css';
import { useTranslation } from '../hooks/useTranslation';
import type {
  AppConfirmationOptions,
  AppNotice,
  PluginCapabilityDeclaration,
  PluginInstallReview,
  PluginManifest,
  PluginRegistryEntry,
  PluginStoreEntry
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
  const [storePlugins, setStorePlugins] = useState<PluginStoreEntry[]>([]);
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [registryUrl, setRegistryUrl] = useState('');
  const [registryLoading, setRegistryLoading] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [review, setReview] = useState<PluginInstallReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [searchText,setSearchText]=useState('');
  const [sourceModalOpen,setSourceModalOpen]=useState(false);
  const [activeTab, setActiveTab] = useState<'installed' | 'store'>('installed');

  const handleInstallClick = (id: string) => {
    setSelectedPluginId(id);
    setInstallModalOpen(true);
  };

  const handleConfirmInstall = (scope: string) => {
    if (selectedPluginId) {
      void handlePrepareInstall(selectedPluginId, scope);
    }
    setInstallModalOpen(false);
    setSelectedPluginId(null);
  };

  const loadPlugins = useCallback(async () => {
    setLoading(true);
    onClearNotice();
    try {
      const [store, installed] = await Promise.all([
        window.kairo.invoke(KAIRO_INVOKE.pluginsGetStore),
        window.kairo.invoke(KAIRO_INVOKE.pluginsGetInstalled)
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

      setStorePlugins(store as unknown as PluginStoreEntry[]);
      setInstalledPlugins([...nativeTools, ...(installed as unknown as InstalledPlugin[])]);
    } catch (e) {
      onReportNotice(createErrorNotice(t('plugins.error.load', { error: e instanceof Error ? e.message : 'Unknown error' }), 'load_plugins'));
    } finally {
      setLoading(false);
    }
  }, [onClearNotice, onReportNotice, t]);

  useEffect(() => {
    void loadPlugins();
  }, [loadPlugins]);

  const handleLoadRegistry = async () => {
    const url = registryUrl.trim();
    if (!url) {
      return false;
    }
    setRegistryLoading(true);
    onClearNotice();
    try {
      const remotePlugins = await window.kairo.invoke(KAIRO_INVOKE.pluginsGetStoreByRegistry, url) as PluginStoreEntry[];
      setStorePlugins((currentValue) => {
        const merged = new Map(currentValue.map((plugin) => [plugin.id, plugin]));
        for (const plugin of remotePlugins) {
          merged.set(plugin.id, plugin);
        }
        return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
      });
      return true;
    } catch (e) {
      onReportNotice(createErrorNotice(t('plugins.error.load', { error: e instanceof Error ? e.message : 'Unknown error' }), 'load_plugin_registry'));
      return false;
    } finally {
      setRegistryLoading(false);
    }
  };

  const handlePrepareInstall = async (id: string, scope: string) => {
    const storePlugin = storePlugins.find((plugin) => plugin.id === id);
    setActionInProgress(`${id}-${scope}-review`);
    setReviewLoading(true);
    onClearNotice();
    try {
      const preparedReview = await window.kairo.invoke(KAIRO_INVOKE.pluginsPrepareInstall, {
        id,
        scope,
        registryUrl: storePlugin?.registryUrl
      }) as PluginInstallReview | { success?: false; error?: string };
      if ('success' in preparedReview && preparedReview.success === false) {
        throw new Error(preparedReview.error || 'Failed to review plugin');
      }
      setReview(preparedReview as PluginInstallReview);
    } catch (e) {
      onReportNotice(createErrorNotice(t('plugins.error.install', { error: e instanceof Error ? e.message : 'Unknown error' }), 'review_plugin_install'));
    } finally {
      setReviewLoading(false);
      setActionInProgress(null);
    }
  };

  const handlePrepareUpdate = async (plugin: InstalledPlugin) => {
    setActionInProgress(`${plugin.id}-${plugin.scope}-update`);
    setReviewLoading(true);
    onClearNotice();
    try {
      const preparedReview = await window.kairo.invoke(KAIRO_INVOKE.pluginsPrepareUpdate, {
        id: plugin.id,
        scope: plugin.scope,
        registryUrl: plugin.source?.type === 'registry' ? plugin.source.url : undefined
      }) as PluginInstallReview | { success?: false; error?: string };
      if ('success' in preparedReview && preparedReview.success === false) {
        throw new Error(preparedReview.error || 'Failed to review plugin update');
      }
      setReview(preparedReview as PluginInstallReview);
    } catch (e) {
      onReportNotice(createErrorNotice(t('plugins.error.update', { error: e instanceof Error ? e.message : 'Unknown error' }), 'review_plugin_update'));
    } finally {
      setReviewLoading(false);
      setActionInProgress(null);
    }
  };

  const handleImportPlugin = async () => {
    onClearNotice();
    try {
      const selectedFile = await window.kairo.invoke(KAIRO_INVOKE.systemSelectFile, {
        filters: [{ name: 'ZIP', extensions: ['zip'] }]
      });
      if (typeof selectedFile !== 'string' || !selectedFile.trim()) {
        return;
      }
      const preparedReview = await window.kairo.invoke(KAIRO_INVOKE.pluginsPrepareImport, {
        sourceFile: selectedFile,
        scope: 'public'
      }) as PluginInstallReview | { success?: false; error?: string };
      if ('success' in preparedReview && preparedReview.success === false) {
        throw new Error(preparedReview.error || 'Failed to review plugin import');
      }
      setReview(preparedReview as PluginInstallReview);
    } catch (e) {
      onReportNotice(createErrorNotice(t('plugins.error.import', { error: e instanceof Error ? e.message : 'Unknown error' }), 'import_plugin'));
    }
  };

  const handleConfirmReviewedInstall = async () => {
    if (!review) {
      return;
    }
    setReviewLoading(true);
    onClearNotice();
    try {
      const result = await window.kairo.invoke(KAIRO_INVOKE.pluginsInstallReviewed, { requestId: review.requestId }) as { success?: boolean; error?: string };
      if (!result.success) {
        throw new Error(result.error || 'Failed to install reviewed plugin');
      }
      setReview(null);
      await loadPlugins();
      setActiveTab('installed');
    } catch (e) {
      onReportNotice(createErrorNotice(t('plugins.error.install', { error: e instanceof Error ? e.message : 'Unknown error' }), 'install_reviewed_plugin'));
    } finally {
      setReviewLoading(false);
    }
  };

  const handleCancelReview = async () => {
    const requestId = review?.requestId;
    setReview(null);
    if (requestId) {
      await window.kairo.invoke(KAIRO_INVOKE.pluginsDiscardInstall, { requestId });
    }
  };

  const handleRollback = async (plugin: InstalledPlugin) => {
    setActionInProgress(`${plugin.id}-${plugin.scope}-rollback`);
    onClearNotice();
    try {
      const result = await window.kairo.invoke(KAIRO_INVOKE.pluginsRollback, {
        id: plugin.id,
        scope: plugin.scope
      }) as { success?: boolean; error?: string };
      if (!result.success) {
        throw new Error(result.error || 'Failed to rollback plugin');
      }
      await loadPlugins();
    } catch (e) {
      onReportNotice(createErrorNotice(t('plugins.error.rollback', { error: e instanceof Error ? e.message : 'Unknown error' }), 'rollback_plugin'));
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

  const handleSetEnabled = async (id: string, scope: string, enabled: boolean) => {
    setActionInProgress(`${id}-${scope}-enabled`);
    onClearNotice();
    try {
      const result = await window.kairo.invoke(KAIRO_INVOKE.pluginsSetEnabled, { id, scope, enabled }) as { success?: boolean; error?: string };
      if (result.success) {
        await loadPlugins();
      } else {
        onReportNotice(createErrorNotice(t('plugins.error.setEnabled', { error: result.error || 'Unknown error' }), 'set_plugin_enabled'));
      }
    } catch (e) {
      onReportNotice(createErrorNotice(t('plugins.error.setEnabled', { error: e instanceof Error ? e.message : 'Unknown error' }), 'set_plugin_enabled'));
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

  const sortedInstalledPlugins = useMemo(
    () =>
      [...installedPlugins]
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

  const filteredInstalledPlugins=useMemo(()=>{
    const query=searchText.trim().toLowerCase();
    return sortedInstalledPlugins.filter(plugin=>`${plugin.name} ${plugin.description} ${plugin.id}`.toLowerCase().includes(query));
  },[sortedInstalledPlugins,searchText]);

  const selectedPlugin = useMemo(
    () => storePlugins.find((plugin) => plugin.id === selectedPluginId) || null,
    [selectedPluginId, storePlugins]
  );

  return (
    <div className="config-panel capability-library plugin-library">
      <div className="config-header capability-header">
        <div className="capability-header-row">
          <div>
            <div className="config-title">{t('nav.plugins')}</div>
            <div className="config-subtitle">{t('plugins.subtitle')}</div>
          </div>
          <div className="capability-actions">
            {activeTab==='installed'&&<label className="capability-search"><IconSearch size={17}/><input type="search" aria-label={t('plugins.searchInstalled')} placeholder={t('plugins.searchInstalled')} value={searchText} onChange={event=>setSearchText(event.target.value)}/></label>}
            <button type="button" className="capability-icon-button" onClick={loadPlugins} disabled={loading} aria-label={t('common.refresh')} title={t('common.refresh')}><IconRefresh size={18} className={loading?'spinning':''}/></button>
            <button type="button" className="capability-icon-button" onClick={()=>setSourceModalOpen(true)} aria-label={t('plugins.registrySettings')} title={t('plugins.registrySettings')}><IconSettings size={18}/></button>
            <button type="button" className="btn btn-primary capability-add" onClick={()=>{void handleImportPlugin();}} disabled={reviewLoading}><IconPlus size={16}/>{t('common.add')}</button>
          </div>
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

      <div className="config-content capability-content plugin-panel-content">
        {loading && (
          <div className="plugin-panel-loading">
            {t('plugins.loading')}
          </div>
        )}

        {!loading && activeTab === 'installed' && (
          <div className="installed-plugins-container">
            {filteredInstalledPlugins.length === 0 ? (
              <div className="empty-state">{t(searchText.trim()?'plugins.noSearchResults':'plugins.noInstalled')}</div>
            ) : (
              <div className="capability-grid">
                {filteredInstalledPlugins.map(plugin => (
                  <InstalledPluginItem
                    key={`${plugin.id}-${plugin.scope}`}
                    plugin={plugin}
                    scopeLabel={getPluginScopeLabel(plugin.scope, t)}
                    onToggleEnabled={() => handleSetEnabled(plugin.id, plugin.scope, plugin.enabled === false)}
                    onUpdate={() => { void handlePrepareUpdate(plugin); }}
                    onRollback={() => { void handleRollback(plugin); }}
                    onUninstall={() => handleUninstall(plugin.id, plugin.scope)}
                    onRequestConfirmation={onRequestConfirmation}
                    isWorking={actionInProgress === `${plugin.id}-${plugin.scope}`}
                    isToggling={actionInProgress === `${plugin.id}-${plugin.scope}-enabled`}
                    isUpdating={actionInProgress === `${plugin.id}-${plugin.scope}-update`}
                    isRollingBack={actionInProgress === `${plugin.id}-${plugin.scope}-rollback`}
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
                        disabled={actionInProgress === plugin.id || reviewLoading}
                      >
                        {actionInProgress === `${plugin.id}-public-review` ? <IconRefresh size={14} className="spinning" /> : t('plugins.install')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {sourceModalOpen&&<WorkbenchDialog title={t('plugins.registrySettings')} kind="plugin-sources" onClose={()=>setSourceModalOpen(false)} busy={registryLoading} actions={<button type="button" className="btn btn-primary" disabled={registryLoading||!registryUrl.trim()} onClick={()=>{void handleLoadRegistry().then(success=>{if(success)setSourceModalOpen(false);});}}>{registryLoading?t('plugins.loading'):t('plugins.loadRegistry')}</button>}>
        <label className="form-group"><span>{t('plugins.registrySettings')}</span><input className="form-control" value={registryUrl} onChange={event=>setRegistryUrl(event.target.value)} placeholder={t('plugins.registryPlaceholder')}/></label>
      </WorkbenchDialog>}

      {installModalOpen && (
        <WorkbenchDialog kind="plugin-scope" title={t('plugins.installReview')} onClose={() => setInstallModalOpen(false)} busy={false} actions={<>
              <button type="button" className="btn" onClick={() => setInstallModalOpen(false)}>{t('common.cancel')}</button>
            </>}>
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

            </div>

        </WorkbenchDialog>
      )}

      {review && (
        <WorkbenchDialog kind="plugin-review" title={t('plugins.reviewTitle')} onClose={() => { void handleCancelReview(); }} busy={reviewLoading} actions={<>
              <button type="button" className="btn" onClick={() => { void handleCancelReview(); }} disabled={reviewLoading}>{t('common.cancel')}</button>
              <button type="button" className="btn btn-primary" onClick={() => { void handleConfirmReviewedInstall(); }} disabled={reviewLoading || review.recommendation === 'block'}>
                {reviewLoading ? t('plugins.installing') : t('plugins.confirmReviewedInstall')}
              </button>
            </>}>
            <div className="plugin-install-review">
              <div className="plugin-card-header">
                <div className="plugin-card-icon">🧩</div>
                <div className="plugin-card-copy">
                  <h4 className="plugin-card-title">{review.pluginName}</h4>
                  <div className="plugin-card-meta">v{review.version} • {t('plugins.by', { author: review.author })}</div>
                </div>
              </div>
              <p className="plugin-card-description">{review.summary}</p>
              <div className={`plugin-risk-badge risk-${review.recommendation === 'block' ? 'critical' : review.recommendation === 'caution' ? 'medium' : 'low'}`}>
                {t(`plugins.recommendation.${review.recommendation}`)}
              </div>
              {review.versionDiff && (
                <div className="plugin-detail-block">
                  <div className="plugin-detail-label">{t('plugins.versionDiff')}</div>
                  <div className="plugin-card-meta">
                    {review.versionDiff.fromVersion || '-'} → {review.versionDiff.toVersion}
                  </div>
                  <div className="plugin-card-meta">
                    {t('plugins.tools')}: +{review.versionDiff.toolChanges.added.length} / -{review.versionDiff.toolChanges.removed.length}
                  </div>
                </div>
              )}
              <div className="plugin-detail-block">
                <div className="plugin-detail-label">{t('plugins.reviewFindings')}</div>
                {review.findings.length === 0 ? (
                  <div className="plugin-card-meta">{t('plugins.noReviewFindings')}</div>
                ) : (
                  <div className="plugin-capability-list">
                    {review.findings.map((finding) => (
                      <div className="plugin-capability-item" key={finding.id}>
                        <span className={`plugin-capability-dot risk-${finding.severity === 'high' ? 'high' : finding.severity}`} />
                        <span>{finding.title}</span>
                        <span className="plugin-capability-permissions">{finding.detail}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

        </WorkbenchDialog>
      )}
    </div>
  );
});

function InstalledPluginItem({
  plugin,
  scopeLabel,
  onToggleEnabled,
  onUpdate,
  onRollback,
  onUninstall,
  onRequestConfirmation,
  isWorking,
  isToggling,
  isUpdating,
  isRollingBack,
  isNative
}: {
  plugin: InstalledPlugin;
  scopeLabel: string;
  onToggleEnabled: () => void;
  onUpdate: () => void;
  onRollback: () => void;
  onUninstall: () => void;
  onRequestConfirmation: (request: AppConfirmationOptions) => Promise<boolean>;
  isWorking: boolean;
  isToggling: boolean;
  isUpdating: boolean;
  isRollingBack: boolean;
  isNative?: boolean;
}) {
  const { t } = useTranslation();
  const enabled = plugin.enabled !== false;

  const [expanded,setExpanded]=useState(false);
  const busy=isWorking||isToggling||isUpdating||isRollingBack;
  return <>
    <CapabilityListItem id={plugin.id} kind="plugin" name={plugin.name} description={plugin.description} icon={<IconPlugin size={23}/>} status={enabled?<IconCheck size={20}/>:<CirclePause size={20}/>} statusLabel={t(enabled?'plugins.enabled':'plugins.disabled')} label={t('plugins.details')} onOpen={()=>setExpanded(true)}/>
    {expanded&&<WorkbenchDialog title={plugin.name} kind="plugin-details" onClose={()=>setExpanded(false)} busy={busy} actions={<>
      {!isNative&&<>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>{setExpanded(false);onUpdate();}}>{t('plugins.update')}</button>
        {plugin.previousVersion&&<button type="button" className="btn btn-secondary" disabled={busy} onClick={onRollback}>{t('plugins.rollback')}</button>}
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onToggleEnabled}>{t(enabled?'plugins.disable':'plugins.enable')}</button>
        <button type="button" className="btn btn-secondary btn-danger" disabled={busy} onClick={async()=>{
          setExpanded(false);
          const confirmed=await onRequestConfirmation({title:t('common.confirm'),message:`${t('common.confirm')} ${t('plugins.uninstall')}?`,confirmLabel:t('plugins.uninstall'),variant:'danger'});
          if(confirmed)onUninstall();
        }}><IconTrash size={14}/>{t('plugins.uninstall')}</button>
      </>}
      <button type="button" className="btn btn-primary" disabled={busy} onClick={()=>setExpanded(false)}>{t('common.close')}</button>
    </>}>
      <div className="capability-detail-meta"><span>{scopeLabel}</span><code>{plugin.id}</code><span>v{plugin.version}</span><span>{t('plugins.by',{author:plugin.author})}</span></div>
      <p className="plugin-card-description">{plugin.description}</p>
      <PluginCapabilitySummary plugin={plugin}/>
      <p className="plugin-card-meta">{t('plugins.installedAt')}: {new Date(plugin.installedAt).toLocaleString()}</p>
      <p className="plugin-card-meta">{t(enabled?'plugins.enabled':'plugins.disabled')}</p>
    </WorkbenchDialog>}
  </>;
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
              <span
                className="plugin-chip"
                key={tool.name}
                title={[
                  tool.description,
                  ...getRequiredPermissionLabels({ requiredPermissions: tool.requiredPermissions }, t)
                ].filter(Boolean).join(' · ')}
              >
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
  capability: Pick<PluginCapabilityDeclaration, 'requiredPermissions'>,
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

function getPluginScopeLabel(
  scope: string,
  t: ReturnType<typeof useTranslation>['t']
) {
  if (scope === 'public') {
    return t('plugins.publicScope');
  }
  if (scope.startsWith('agent:')) {
    return scope === 'agent:workbench' ? t('workbench.workbenchScope') : t('plugins.publicScope');
  }
  return scope;
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
