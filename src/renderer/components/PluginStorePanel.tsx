import { useState, useEffect } from 'react';
import { IconPlugin, IconTrash, IconRefresh } from './Icons';
import './PluginStorePanel.css';
import { useTranslation } from '../hooks/useTranslation';
import { AgentConfig } from '../../main/store/config';

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
  const [agents, setAgents] = useState<AgentConfig[]>([]);
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
      const [store, installed, fetchedAgents] = await Promise.all([
        window.ipcRenderer.invoke('plugins:getStore'),
        window.ipcRenderer.invoke('plugins:getInstalled'),
        window.ipcRenderer.invoke('config:get-agents')
      ]);
      
      // Inject native tools as installed plugins
      const nativeTools: InstalledPlugin[] = [
        { id: 'web_search', name: 'Web Search', description: 'Search the internet for real-time information.', version: '1.0.0', author: 'KairoPilot', installedAt: Date.now(), filePath: 'built-in', scope: 'public', icon: '🔍' },
        { id: 'web_fetch', name: 'Web Fetch', description: 'Fetch and read content from specific URLs.', version: '1.0.0', author: 'KairoPilot', installedAt: Date.now(), filePath: 'built-in', scope: 'public', icon: '🌐' }
      ];
      
      setStorePlugins(store as unknown as PluginManifest[]);
      setInstalledPlugins([...nativeTools, ...(installed as unknown as InstalledPlugin[])]);
      setAgents(fetchedAgents as AgentConfig[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch plugins');
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to install plugin');
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to install plugin');
    } finally {
      setActionInProgress(null);
    }
  };

  const uninstalledPlugins = storePlugins.filter(p => !installedPlugins.find(ip => ip.id === p.id));

  const publicPlugins = installedPlugins.filter(p => p.scope === 'public');

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
              {t('nav.plugins')}
            </div>
            <div className="config-subtitle">{t('plugins.subtitle')}</div>
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
            {t('plugins.installedTab')}
          </button>
          <button 
            className={`plugin-tab ${activeTab === 'store' ? 'active' : ''}`}
            onClick={() => setActiveTab('store')}
          >
            {t('plugins.uninstalledTab')}
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
            <h3 className="skill-category-title">{t('plugins.installedTitle')}</h3>
            {publicPlugins.length === 0 ? (
              <div className="empty-state">{t('plugins.noInstalled')}</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
                {publicPlugins.map(plugin => (
                  <InstalledSkillItem 
                    key={`${plugin.id}-${plugin.scope}`} 
                    plugin={plugin} 
                    onUninstall={() => handleUninstall(plugin.id, plugin.scope)}
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
              <div className="empty-state" style={{ marginTop: '4rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🛒</div>
                <h3 style={{ margin: '0 0 0.5rem 0' }}>{t('plugins.marketplace')}</h3>
                <p style={{ margin: 0, color: 'var(--muted-fg)' }}>{t('skills.allInstalled')}</p>
              </div>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '300px', overflowY: 'auto' }}>
              <button 
                className="btn btn-secondary" 
                onClick={() => handleConfirmInstall('public')}
                style={{ justifyContent: 'flex-start', padding: '0.75rem', backgroundColor: 'var(--background)' }}
              >
                {t('skills.publicScope')}
              </button>
              {agents.map(agent => (
                <button 
                  key={agent.id}
                  className="btn btn-secondary" 
                  onClick={() => handleConfirmInstall(`agent:${agent.id}`)}
                  style={{ justifyContent: 'flex-start', padding: '0.75rem', backgroundColor: 'var(--background)' }}
                >
                  {t('skills.agentScope', { agent: agent.name })}
                </button>
              ))}
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

function InstalledSkillItem({ plugin, onUninstall, isWorking, isNative }: { plugin: InstalledPlugin, onUninstall: () => void, isWorking: boolean, isNative?: boolean }) {
  const { t } = useTranslation();
  
  return (
    <div className="config-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', height: '100%' }}>
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

      <div style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', marginTop: '0.5rem' }}>
        <strong>{t('skills.installedAt')}:</strong> {new Date(plugin.installedAt).toLocaleString()}
      </div>

      <div className="skill-card-actions" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
        <button 
          className="btn btn-secondary btn-sm btn-danger"
          onClick={(e) => {
            e.stopPropagation();
            if(confirm(t('common.confirm') + ' ' + t('skills.uninstall') + '?')) {
              onUninstall();
            }
          }}
          disabled={isWorking || isNative}
          style={{ opacity: isNative ? 0.5 : 1, cursor: isNative ? 'not-allowed' : 'pointer' }}
        >
          {isWorking ? <IconRefresh size={14} className="spinning" /> : <IconTrash size={14} />}
          <span style={{ marginLeft: '4px' }}>{isNative ? t('skills.installed') : t('skills.uninstall')}</span>
        </button>
      </div>
    </div>
  );
}
