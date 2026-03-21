import { memo } from 'react';
import { ModelConfig } from '../../types';
import { IconCpu, IconPlus, IconEdit, IconTrash } from '../Icons';
import { useTranslation } from '../../hooks/useTranslation';

interface ModelListProps {
  models: ModelConfig[];
  onCreateModel: () => void;
  onEditModel: (model: ModelConfig) => void;
  onDeleteModel: (id: string) => void;
}

export const ModelList = memo(function ModelList({ models, onCreateModel, onEditModel, onDeleteModel }: ModelListProps) {
  const { t } = useTranslation();

  return (
    <div className="config-section">
      <div className="config-section-header">
        <h3 className="config-section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
          <IconCpu size={20} /> {t('config.models')}
        </h3>
        <button onClick={onCreateModel} className="btn btn-primary">
          <IconPlus size={16} /> {t('config.addModel')}
        </button>
      </div>

      {models.map(model => (
        <div key={model.id} className="config-card">
          <div className="card-info">
            <h4>{model.name}</h4>
            <div className="card-meta">
              <span className="badge" style={{ background: 'var(--sidebar-accent)', color: 'var(--foreground)' }}>
                {model.provider}
              </span>
              <span>{model.model}</span>
            </div>
          </div>
          <div className="card-actions">
            <button 
              onClick={() => onEditModel(model)}
              className="btn-icon"
              title={t('common.edit')}
            >
              <IconEdit size={18} />
            </button>
            <button 
              onClick={() => onDeleteModel(model.id)}
              className="btn-icon danger"
              title={t('common.delete')}
            >
              <IconTrash size={18} />
            </button>
          </div>
        </div>
      ))}
      
      {models.length === 0 && (
        <div style={{ padding: '3rem', textAlign: 'center', opacity: 0.5, border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)' }}>
          <p>{t('config.noModels')}</p>
          <button onClick={onCreateModel} className="btn btn-primary" style={{ marginTop: '1rem' }}>
            {t('config.addFirstModel')}
          </button>
        </div>
      )}
    </div>
  );
});
