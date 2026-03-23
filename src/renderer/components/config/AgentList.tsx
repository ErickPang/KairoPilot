import { memo } from 'react';
import { AgentConfig, ModelConfig } from '../../types';
import { IconBot, IconPlus, IconCheck, IconEdit, IconTrash, IconCpu, IconFolder } from '../Icons';
import { useTranslation } from '../../hooks/useTranslation';

interface AgentListProps {
  agents: AgentConfig[];
  models: ModelConfig[];
  activeAgentId: string | null;
  onCreateAgent: () => void;
  onEditAgent: (agent: AgentConfig) => void;
  onDeleteAgent: (id: string) => void;
  onSetActiveAgent: (id: string) => void;
}

export const AgentList = memo(function AgentList({ 
  agents, 
  models, 
  activeAgentId, 
  onCreateAgent, 
  onEditAgent, 
  onDeleteAgent, 
  onSetActiveAgent 
}: AgentListProps) {
  const { t } = useTranslation();

  return (
    <div className="config-section">
      <div className="config-section-header">
        <h3 className="config-section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
          <IconBot size={20} /> {t('config.agents')}
        </h3>
        <button onClick={onCreateAgent} className="btn btn-primary">
          <IconPlus size={16} /> {t('config.addAgent')}
        </button>
      </div>

      {agents.map(agent => {
        const isActive = agent.id === activeAgentId;
        const linkedModel = models.find(m => agent.model.startsWith(`${m.id}/`));
        const modelId = agent.model.includes('/') ? agent.model.split('/')[1] : '';
        
        return (
          <div key={agent.id} className={`config-card ${isActive ? 'active' : ''}`}>
            <div className="card-info">
              <h4>
                {agent.name}
                {isActive && <span className="badge badge-primary" style={{ marginLeft: '0.5rem' }}>{t('config.active')}</span>}
              </h4>
              <div className="card-meta">
                <span title={t('config.linkedModel')}>
                  <IconCpu size={14} style={{ marginRight: '4px', verticalAlign: 'text-bottom' }} />
                  {linkedModel ? `${linkedModel.name} (${modelId})` : 'Unknown'}
                </span>
                <span>•</span>
                <span title={t('config.workspace')}>
                  <IconFolder size={14} style={{ marginRight: '4px', verticalAlign: 'text-bottom' }} />
                  {agent.workspace ? t('config.customWorkspace') : t('config.defaultWorkspace')}
                </span>
              </div>
            </div>
            <div className="card-actions">
              {!isActive && (
                <button 
                  onClick={() => onSetActiveAgent(agent.id)}
                  className="btn-icon"
                  title={t('config.setActive')}
                >
                  <IconCheck size={18} />
                </button>
              )}
              <button 
                onClick={() => onEditAgent(agent)}
                className="btn-icon"
                title={t('common.edit')}
              >
                <IconEdit size={18} />
              </button>
              {agent.id !== 'mainAgent' && (
                <button 
                  onClick={() => onDeleteAgent(agent.id)}
                  className="btn-icon danger"
                  title={t('common.delete')}
                >
                  <IconTrash size={18} />
                </button>
              )}
            </div>
          </div>
        );
      })}

      {agents.length === 0 && (
        <div style={{ padding: '3rem', textAlign: 'center', opacity: 0.5, border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)' }}>
          <p>{t('config.noAgents')}</p>
          <button onClick={onCreateAgent} className="btn btn-primary" style={{ marginTop: '1rem' }}>
            {t('config.createFirstAgent')}
          </button>
        </div>
      )}
    </div>
  );
});
