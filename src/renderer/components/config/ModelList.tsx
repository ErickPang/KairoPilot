import { memo } from 'react';
import { ModelConfig } from '../../types';
import { IconEdit, IconTrash } from '../Icons';
import { useTranslation } from '../../hooks/useTranslation';

interface ModelListProps {
  models: ModelConfig[];
  onCreateModel: () => void;
  onEditModel: (model: ModelConfig) => void;
  onDeleteModel: (id: string) => void;
}

export const ModelList = memo(function ModelList({ models, onCreateModel, onEditModel, onDeleteModel }: ModelListProps) {
  const { t } = useTranslation();
  const sortedModels = [...models].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="config-section config-page-section">
      {sortedModels.map(model => (
        <div key={model.id} className="config-card">
          <div className="card-info">
            <div className="config-card-label-row">
              <h4>{model.name}</h4>
              <span className="badge config-card-badge">{model.provider}</span>
            </div>
            <div className="card-meta">
              <span className="card-meta-item">
                <span className="card-meta-emphasis">{model.model}</span>
              </span>
            </div>
          </div>
          <div className="card-actions">
            <button
              type="button"
              onClick={() => onEditModel(model)}
              className="btn-icon"
              title={t('common.edit')}
            >
              <IconEdit size={18} />
            </button>
            <button
              type="button"
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
        <div className="config-list-empty">
          <p>{t('config.noModels')}</p>
          <button type="button" onClick={onCreateModel} className="btn btn-primary">
            {t('config.addFirstModel')}
          </button>
        </div>
      )}
    </div>
  );
});
