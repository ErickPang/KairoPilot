import { memo } from 'react';
import { AgentConfig, ModelConfig } from '../../types';
import { IconCheck, IconEdit, IconTrash, IconCpu, IconFolder } from '../Icons';
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
  const sortedAgents = [...agents].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="config-section config-page-section">
      {sortedAgents.map(agent => {
        const isActive = agent.id === activeAgentId;
        const linkedModel = models.find(m => agent.model.startsWith(`${m.id}/`));
        const modelId = agent.model.includes('/') ? agent.model.split('/')[1] : '';
        
        return (
          <div key={agent.id} className={`config-card ${isActive ? 'active' : ''}`}>
            <div className="card-info">
              <div className="config-card-label-row">
                <h4>{agent.name}</h4>
                {isActive && <span className="badge badge-primary">{t('config.active')}</span>}
              </div>
              <div className="card-meta">
                <span className="card-meta-item" title={t('config.linkedModel')}>
                  <IconCpu size={14} className="card-meta-icon" />
                  {linkedModel ? `${linkedModel.name} (${modelId})` : 'Unknown'}
                </span>
                <span className="card-meta-divider" aria-hidden="true">•</span>
                <span className="card-meta-item" title={t('config.workspace')}>
                  <IconFolder size={14} className="card-meta-icon" />
                  {agent.workspace ? t('config.customWorkspace') : t('config.defaultWorkspace')}
                </span>
              </div>
            </div>
            <div className="card-actions">
              {!isActive && (
                <button
                  type="button"
                  onClick={() => onSetActiveAgent(agent.id)}
                  className="btn-icon"
                  title={t('config.setActive')}
                >
                  <IconCheck size={18} />
                </button>
              )}
              <button
                type="button"
                onClick={() => onEditAgent(agent)}
                className="btn-icon"
                title={t('common.edit')}
              >
                <IconEdit size={18} />
              </button>
              {agent.id !== 'mainAgent' && (
                <button
                  type="button"
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
        <div className="config-list-empty">
          <p>{t('config.noAgents')}</p>
          <button type="button" onClick={onCreateAgent} className="btn btn-primary">
            {t('config.createFirstAgent')}
          </button>
        </div>
      )}
    </div>
  );
});
