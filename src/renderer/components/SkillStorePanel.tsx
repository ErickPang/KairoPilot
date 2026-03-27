import { useState, useEffect, type ReactNode } from 'react';
import { IconRefresh, IconSkill } from './Icons';
import './PluginStorePanel.css';
import { useTranslation } from '../hooks/useTranslation';
import type { AgentConfig, SkillSummary } from '../types';
import { KAIRO_INVOKE } from '../../shared/ipc';

export function SkillStorePanel() {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<Record<string, SkillSummary[]>>({});
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'installed' | 'store'>('installed');

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [fetchedSkills, fetchedAgents] = await Promise.all([
        window.kairo.invoke(KAIRO_INVOKE.skillsGetAll),
        window.kairo.invoke(KAIRO_INVOKE.configGetAgents)
      ]);
      setSkills(fetchedSkills as Record<string, SkillSummary[]>);
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

        <div className="store-tabs">
          <button 
            className={`store-tab ${activeTab === 'installed' ? 'active' : ''}`}
            onClick={() => setActiveTab('installed')}
          >
            {t('skills.installed')}
          </button>
          <button 
            className={`store-tab ${activeTab === 'store' ? 'active' : ''}`}
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
            <SkillSectionPanel
              title={getCategoryTitle('public')}
              count={skills['public']?.length || 0}
              defaultOpen={true}
            >
              {(!skills['public'] || skills['public'].length === 0) ? (
                <div className="empty-state">{t('skills.noPublic')}</div>
              ) : (
                <div className="skills-grid">
                  {skills['public'].map(skill => (
                    <SkillItem key={skill.id} skill={skill} />
                  ))}
                </div>
              )}
            </SkillSectionPanel>

            {Object.entries(skills).filter(([key]) => key !== 'public').map(([agentId, agentSkills]) => (
              <SkillSectionPanel
                key={agentId}
                title={getCategoryTitle(agentId)}
                count={agentSkills.length}
                defaultOpen={false}
              >
                <div className="skills-grid">
                  {agentSkills.length === 0 ? (
                    <div className="empty-state">{t('skills.noAgent')}</div>
                  ) : (
                    agentSkills.map(skill => (
                      <SkillItem key={skill.id} skill={skill} />
                    ))
                  )}
                </div>
              </SkillSectionPanel>
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

function SkillSectionPanel({
  title,
  count,
  defaultOpen,
  children
}: {
  title: string;
  count: number;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  return (
    <details className="skill-section-panel" open={defaultOpen}>
      <summary className="skill-section-summary">
        <span className="skill-section-title">{title}</span>
        <span className="skill-section-count">{count}</span>
      </summary>
      <div className="skill-section-body">
        {children}
      </div>
    </details>
  );
}

function SkillItem({ skill }: { skill: SkillSummary }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();
  
  return (
    <div className={`config-card skill-card ${expanded ? 'expanded' : ''}`} onClick={() => setExpanded(!expanded)}>
      <div className="skill-card-header">
        <div className="skill-card-icon">
          📄
        </div>
        <div className="skill-card-main">
          <h4 className="skill-card-title">{skill.name}</h4>
          <div className="skill-card-id">
            ID: {skill.id}
          </div>
        </div>
      </div>
      
      <p className="skill-card-description">
        {skill.description}
      </p>

      {expanded && (
        <div className="skill-card-details" onClick={(e) => e.stopPropagation()}>
          <p className="skill-card-detail-description"><strong>{t('skills.description')}:</strong> {skill.description}</p>
          <div className="skill-card-code-wrap">
            <pre className="skill-card-code">
              {skill.content}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
