import { useState, useEffect } from 'react';
import { IconPlugin, IconTrash, IconRefresh } from './Icons';
import './PluginStorePanel.css';
import { useTranslation } from '../hooks/useTranslation';

interface PluginManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  icon?: string;
}

interface InstalledPlugin extends PluginManifest {
  installedAt: number;
  filePath: string;
  scope: string; // 'public' | 'agent:{agentId}'
}

export function PluginStorePanel() {
  const { t } = useTranslation();
  const [storePlugins, setStorePlugins] = useState<PluginManifest[]>([]);
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const loadPlugins = async () => {
    setLoading(true);
    setError(null);
    try {
      const [store, installed] = await Promise.all([
        window.ipcRenderer.invoke('plugins:getStore'),
        window.ipcRenderer.invoke('plugins:getInstalled')
      ]);
      setStorePlugins(store);
      setInstalledPlugins(installed);
    } catch (e: any) {
      setError(e.message || 'Failed to load plugins');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPlugins();
  }, []);

  const handleInstall = async (id: string, scope: string = 'public') => {
    setActionInProgress(id);
    try {
      const result = await window.ipcRenderer.invoke('plugins:install', { id, scope });
      if (result.success) {
        await loadPlugins();
        setActiveTab('installed');
      } else {
        setError(result.error || 'Failed to install plugin');
      }
    } catch (e: any) {
      setError(e.message || 'Failed to install plugin');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleUninstall = async (id: string, scope: string) => {
    setActionInProgress(`${id}-${scope}`);
    try {
      const result = await window.ipcRenderer.invoke('plugins:uninstall', { id, scope });
      if (result.success) {
        await loadPlugins();
      } else {
        setError(result.error || 'Failed to uninstall plugin');
      }
    } catch (e: any) {
      setError(e.message || 'Failed to uninstall plugin');
    } finally {
      setActionInProgress(null);
    }
  };

  const uninstalledPlugins = storePlugins;

  const publicSkills = installedPlugins.filter(p => p.scope === 'public');
  
  // Group non-public plugins by agent
  const agentPlugins = installedPlugins.reduce((acc, plugin) => {
    if (plugin.scope.startsWith('agent:')) {
      const agentId = plugin.scope.split(':')[1];
      if (!acc[agentId]) acc[agentId] = [];
      acc[agentId].push(plugin);
    }
    return acc;
  }, {} as Record<string, InstalledPlugin[]>);

  return (
    <div className="config-panel">
      <div className="config-header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
          <div>
            <div className="config-title">
              <div style={{ 
                width: '32px', height: '32px', borderRadius: 'var(--radius-md)', 
                background: 'var(--primary)', display: 'flex', alignItems: 'center', 
                justifyContent: 'center', color: 'var(--primary-fg)', marginRight: '0.75rem' 
              }}>
                <IconPlugin size={20} />
              </div>
              {t('nav.skills')}
            </div>
            <div className="config-subtitle">{t('skills.marketplace')}</div>
          </div>
          <button onClick={loadPlugins} className="btn btn-secondary" disabled={loading}>
            <IconRefresh size={16} className={loading ? 'spinning' : ''} />
          </button>
        </div>

        <div className="plugin-tabs">
          <button 
            className={`plugin-tab ${activeTab === 'installed' ? 'active' : ''}`}
            onClick={() => setActiveTab('installed')}
          >
            {t('skills.installed')}
          </button>
          <button 
            className={`plugin-tab ${activeTab === 'store' ? 'active' : ''}`}
            onClick={() => setActiveTab('store')}
          >
            {t('skills.marketplace')}
          </button>
        </div>
      </div>

      <div className="config-content" style={{ overflowY: 'auto' }}>
        {error && (
          <div style={{ 
            padding: '1rem', background: 'var(--danger-bg, #fee2e2)', 
            color: 'var(--danger, #dc2626)', borderRadius: 'var(--radius-md)', marginBottom: '1rem' 
          }}>
            {error}
          </div>
        )}

        {loading && (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted-fg)' }}>
            {t('skills.loading')}
          </div>
        )}

        {!loading && activeTab === 'installed' && (
          <div className="installed-skills-container">
            <h3 className="skill-category-title">{t('skills.publicSkills')} (~/.kairopilot/skills)</h3>
            {publicSkills.length === 0 ? (
              <div className="empty-state">{t('skills.noPublicSkills')}</div>
            ) : (
              <div className="skill-list">
                {publicSkills.map(plugin => (
                  <InstalledSkillItem 
                    key={`${plugin.id}-${plugin.scope}`} 
                    plugin={plugin} 
                    onUninstall={() => handleUninstall(plugin.id, plugin.scope)}
                    isWorking={actionInProgress === `${plugin.id}-${plugin.scope}`}
                  />
                ))}
              </div>
            )}

            {Object.entries(agentPlugins).map(([agentId, plugins]) => (
              <div key={agentId}>
                <h3 className="skill-category-title" style={{ marginTop: '2rem' }}>{t('skills.agentSkills')}: {agentId}</h3>
                <div className="skill-list">
                  {plugins.length === 0 ? (
                    <div className="empty-state">{t('skills.noAgentSkills')}</div>
                  ) : (
                    plugins.map(plugin => (
                      <InstalledSkillItem 
                        key={`${plugin.id}-${plugin.scope}`} 
                        plugin={plugin} 
                        onUninstall={() => handleUninstall(plugin.id, plugin.scope)}
                        isWorking={actionInProgress === `${plugin.id}-${plugin.scope}`}
                      />
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && activeTab === 'store' && (
          <div>
            {uninstalledPlugins.length === 0 ? (
              <div className="empty-state">{t('skills.allInstalled')}</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
                {uninstalledPlugins.map(plugin => (
                  <div key={plugin.id} className="config-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', height: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                      <div style={{ 
                        fontSize: '2rem', width: '48px', height: '48px', 
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'var(--sidebar-bg)', borderRadius: 'var(--radius-md)'
                      }}>
                        {plugin.icon || '🧩'}
                      </div>
                      <div style={{ flex: 1 }}>
                        <h4 style={{ margin: '0 0 0.25rem 0' }}>{plugin.name}</h4>
                        <div style={{ fontSize: '0.8rem', color: 'var(--muted-fg)' }}>
                          v{plugin.version} • {t('skills.by', { author: plugin.author })}
                        </div>
                      </div>
                    </div>
                    
                    <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--foreground)', flex: 1 }}>
                      {plugin.description}
                    </p>

                    <div className="skill-card-actions">
                      <button 
                        className="btn btn-primary"
                        onClick={() => handleInstallClick(plugin.id)}
                        disabled={actionInProgress === plugin.id}
                      >
                        {actionInProgress === plugin.id ? <IconRefresh size={14} className="spinning" /> : t('skills.install')}
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
            <h3 style={{ marginBottom: '1rem', color: 'var(--foreground)' }}>{t('skills.installScope')}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button 
                className="btn btn-secondary" 
                onClick={() => handleConfirmInstall('public')}
                style={{ justifyContent: 'flex-start', padding: '0.75rem', backgroundColor: 'var(--background)' }}
              >
                {t('skills.publicScope')}
              </button>
              <button 
                className="btn btn-secondary" 
                onClick={() => handleConfirmInstall('agent:mainAgent')}
                style={{ justifyContent: 'flex-start', padding: '0.75rem', backgroundColor: 'var(--background)' }}
              >
                {t('skills.agentScope', { agent: 'mainAgent' })}
              </button>
              <button 
                className="btn btn-secondary" 
                onClick={() => handleConfirmInstall('agent:wechat')}
                style={{ justifyContent: 'flex-start', padding: '0.75rem', backgroundColor: 'var(--background)' }}
              >
                {t('skills.agentScope', { agent: 'wechat' })}
              </button>
            </div>
            <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setInstallModalOpen(false)}>{t('common.cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InstalledSkillItem({ plugin, onUninstall, isWorking }: { plugin: InstalledPlugin, onUninstall: () => void, isWorking: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();
  
  return (
    <div className="skill-list-item" onClick={() => setExpanded(!expanded)}>
      <div className="skill-item-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontSize: '1.5rem' }}>{plugin.icon || '🧩'}</span>
          <div>
            <div style={{ fontWeight: 500, color: 'var(--foreground)' }}>{plugin.name}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--muted-fg)' }}>v{plugin.version}</div>
          </div>
        </div>
        <button 
          className="btn btn-secondary btn-sm btn-danger"
          onClick={(e) => {
            e.stopPropagation();
            if(confirm(t('common.confirm') + ' ' + t('skills.uninstall') + '?')) {
              onUninstall();
            }
          }}
          disabled={isWorking}
        >
          {isWorking ? <IconRefresh size={14} className="spinning" /> : <IconTrash size={14} />}
          <span style={{ marginLeft: '4px' }}>{t('skills.uninstall')}</span>
        </button>
      </div>
      {expanded && (
        <div className="skill-item-details" onClick={(e) => e.stopPropagation()}>
          <p>{plugin.description}</p>
          <div className="skill-meta">
            <span><strong>{t('skills.author')}:</strong> {plugin.author}</span>
            <span><strong>{t('skills.installedAt')}:</strong> {new Date(plugin.installedAt).toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}
