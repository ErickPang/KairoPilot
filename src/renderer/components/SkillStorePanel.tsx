import { useState, useEffect } from 'react';
import { IconPlugin, IconRefresh } from './Icons';
import './PluginStorePanel.css'; // Reusing plugin styles for now
import { useTranslation } from '../hooks/useTranslation';
import { AgentConfig } from '../../main/store/config';

interface AgentSkill {
  id: string;
  name: string;
  description: string;
  content: string;
  source: 'public' | 'agent';
}

export function SkillStorePanel() {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<Record<string, AgentSkill[]>>({});
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'installed' | 'store'>('installed');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [fetchedSkills, fetchedAgents] = await Promise.all([
        window.ipcRenderer.invoke('skills:getAll'),
        window.ipcRenderer.invoke('config:get-agents')
      ]);
      setSkills(fetchedSkills as Record<string, AgentSkill[]>);
      setAgents(fetchedAgents as AgentConfig[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch skills');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const getCategoryTitle = (agentId: string) => {
    if (agentId === 'public') return t('skills.publicCategory');
    const agent = agents.find(a => a.id === agentId);
    return agent ? t('skills.agentCategory', { agent: agent.name }) : t('skills.agentCategory', { agent: agentId });
  };

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
              {t('skills.title')}
            </div>
            <div className="config-subtitle">{t('skills.subtitle')}</div>
          </div>
          <button onClick={loadData} className="btn btn-secondary" disabled={loading}>
            <IconRefresh size={16} className={loading ? 'spinning' : ''} />
          </button>
        </div>

        <div className="skill-tabs" style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', borderBottom: '1px solid var(--border)' }}>
          <button 
            className={`tab-btn ${activeTab === 'installed' ? 'active' : ''}`}
            onClick={() => setActiveTab('installed')}
            style={{ padding: '0.5rem 1rem', background: 'none', border: 'none', borderBottom: activeTab === 'installed' ? '2px solid var(--primary)' : '2px solid transparent', color: activeTab === 'installed' ? 'var(--foreground)' : 'var(--muted-fg)', cursor: 'pointer', fontWeight: 500 }}
          >
            {t('skills.installed')}
          </button>
          <button 
            className={`tab-btn ${activeTab === 'store' ? 'active' : ''}`}
            onClick={() => setActiveTab('store')}
            style={{ padding: '0.5rem 1rem', background: 'none', border: 'none', borderBottom: activeTab === 'store' ? '2px solid var(--primary)' : '2px solid transparent', color: activeTab === 'store' ? 'var(--foreground)' : 'var(--muted-fg)', cursor: 'pointer', fontWeight: 500 }}
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
            {/* Show Public Skills First */}
            <h3 className="skill-category-title">{getCategoryTitle('public')}</h3>
            {(!skills['public'] || skills['public'].length === 0) ? (
              <div className="empty-state">{t('skills.noPublic')}</div>
            ) : (
              <div className="skill-list">
                {skills['public'].map(skill => (
                  <SkillItem key={skill.id} skill={skill} />
                ))}
              </div>
            )}

            {/* Show Agent Skills */}
            {Object.entries(skills).filter(([key]) => key !== 'public').map(([agentId, agentSkills]) => (
              <div key={agentId}>
                <h3 className="skill-category-title" style={{ marginTop: '2rem' }}>
                  {getCategoryTitle(agentId)}
                </h3>
                <div className="skill-list">
                  {agentSkills.length === 0 ? (
                    <div className="empty-state">{t('skills.noAgent')}</div>
                  ) : (
                    agentSkills.map(skill => (
                      <SkillItem key={skill.id} skill={skill} />
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && activeTab === 'store' && (
          <div className="store-skills-container">
            <div className="empty-state" style={{ marginTop: '4rem' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🛒</div>
              <h3>{t('skills.marketplace')}</h3>
              <p style={{ color: 'var(--muted-fg)', marginTop: '0.5rem' }}>{t('skills.comingSoon')}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SkillItem({ skill }: { skill: AgentSkill }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();
  
  return (
    <div className="skill-list-item" onClick={() => setExpanded(!expanded)}>
      <div className="skill-item-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontSize: '1.5rem' }}>📄</span>
          <div>
            <div style={{ fontWeight: 500, color: 'var(--foreground)' }}>{skill.name}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--muted-fg)' }}>ID: {skill.id}</div>
          </div>
        </div>
      </div>
      {expanded && (
        <div className="skill-item-details" onClick={(e) => e.stopPropagation()}>
          <p><strong>{t('skills.description')}:</strong> {skill.description}</p>
          <div className="skill-meta" style={{ marginTop: '0.5rem', maxHeight: '150px', overflowY: 'auto', background: 'var(--sidebar-bg)', padding: '0.5rem', borderRadius: 'var(--radius-sm)' }}>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.85rem' }}>
              {skill.content}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
