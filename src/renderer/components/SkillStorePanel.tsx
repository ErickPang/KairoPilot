import { useState, useEffect } from 'react';
import { IconRefresh, IconSkill } from './Icons';
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
                <IconSkill size={20} />
              </div>
              {t('skills.title')}
            </div>
            <div className="config-subtitle">{t('skills.subtitle')}</div>
          </div>
          <button onClick={loadData} className="btn btn-secondary" disabled={loading}>
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
            {/* Show Public Skills First */}
            <h3 className="skill-category-title">{getCategoryTitle('public')}</h3>
            {(!skills['public'] || skills['public'].length === 0) ? (
              <div className="empty-state">{t('skills.noPublic')}</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
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
            <div className="empty-state" style={{ marginTop: '4rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🛒</div>
              <h3 style={{ margin: '0 0 0.5rem 0' }}>{t('skills.marketplace')}</h3>
              <p style={{ margin: 0, color: 'var(--muted-fg)' }}>{t('skills.comingSoon')}</p>
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
    <div className="config-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', height: '100%', cursor: 'pointer' }} onClick={() => setExpanded(!expanded)}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
        <div style={{ 
          fontSize: '2rem', width: '48px', height: '48px', 
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--sidebar-bg)', borderRadius: 'var(--radius-md)'
        }}>
          📄
        </div>
        <div style={{ flex: 1 }}>
          <h4 style={{ margin: '0 0 0.25rem 0' }}>{skill.name}</h4>
          <div style={{ fontSize: '0.8rem', color: 'var(--muted-fg)' }}>
            ID: {skill.id}
          </div>
        </div>
      </div>
      
      <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--foreground)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {skill.description}
      </p>

      {expanded && (
        <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }} onClick={(e) => e.stopPropagation()}>
          <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}><strong>{t('skills.description')}:</strong> {skill.description}</p>
          <div style={{ maxHeight: '150px', overflowY: 'auto', background: 'var(--sidebar-bg)', padding: '0.5rem', borderRadius: 'var(--radius-sm)' }}>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--muted-fg)' }}>
              {skill.content}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
