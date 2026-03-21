import { memo } from 'react';
import { ModelConfig } from '../../types';
import { IconArrowLeft, IconRefresh } from '../Icons';
import { Select } from '../Select';
import { OllamaManager } from './OllamaManager';
import { useTranslation } from '../../hooks/useTranslation';

interface ModelEditorProps {
  editingModel: ModelConfig;
  setEditingModel: (model: ModelConfig) => void;
  availableModels: string[];
  onFetchModels: (model: ModelConfig) => void;
  onSave: () => void;
  onCancel: () => void;
}

export const ModelEditor = memo(function ModelEditor({ 
  editingModel, 
  setEditingModel, 
  availableModels, 
  onFetchModels, 
  onSave, 
  onCancel 
}: ModelEditorProps) {
  const { t } = useTranslation();

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const provider = e.target.value as ModelConfig['provider'];
    const newConfig = { ...editingModel, provider };
    
    switch (provider) {
      case 'ollama':
        newConfig.baseUrl = 'http://localhost:11434/v1';
        break;
      case 'deepseek':
        newConfig.baseUrl = 'https://api.deepseek.com/v1';
        break;
      case 'zhipu':
        newConfig.baseUrl = 'https://open.bigmodel.cn/api/paas/v4';
        break;
      case 'kimi':
        newConfig.baseUrl = 'https://api.moonshot.cn/v1';
        break;
      case 'qianwen':
        newConfig.baseUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
        break;
      case 'openai':
      default:
        newConfig.baseUrl = 'https://api.openai.com/v1';
        break;
    }
    setEditingModel(newConfig);
  };

  return (
    <>
      <div className="config-header">
        <div className="config-title">
          <button onClick={onCancel} className="btn-icon" style={{ marginRight: '0.5rem' }}>
            <IconArrowLeft size={24} />
          </button>
          <span>{editingModel.id ? t('config.editModel') : t('config.newModel')}</span>
        </div>
      </div>

      <div className="config-content">
        <div className="form-section-title">{t('config.generalInfo')}</div>
        
        <div className="form-row">
          <div className="form-group" style={{ flex: 2 }}>
            <label>{t('config.configName')}</label>
            <input 
              className="form-control"
              value={editingModel.name} 
              onChange={e => setEditingModel({...editingModel, name: e.target.value})}
              placeholder={t('config.placeholder.modelName')}
              autoFocus
            />
            <div className="form-help">{t('config.configNameHelp')}</div>
          </div>

          <div className="form-group" style={{ flex: 1 }}>
            <label>{t('config.provider')}</label>
            <Select 
              value={editingModel.provider} 
              onChange={(val) => handleProviderChange({ target: { value: val } } as React.ChangeEvent<HTMLSelectElement>)}
              options={[
                { value: 'openai', label: 'OpenAI' },
                { value: 'deepseek', label: 'DeepSeek' },
                { value: 'zhipu', label: '智谱 (Zhipu)' },
                { value: 'kimi', label: 'Kimi (Moonshot)' },
                { value: 'qianwen', label: '通义千问 (Qianwen)' },
                { value: 'ollama', label: 'Ollama (Local)' },
              ]}
            />
          </div>
        </div>

        <div className="form-section-title">{t('config.connectionDetails')}</div>

        <div className="form-group">
          <label>{t('config.baseUrl')}</label>
          <input 
              className="form-control"
              value={editingModel.baseUrl || ''} 
              onChange={e => setEditingModel({...editingModel, baseUrl: e.target.value})}
              placeholder={t('config.placeholder.baseUrl')}
            />
          <div className="form-help">{t('config.baseUrlHelp')}</div>
        </div>

        <div className="form-group">
          <label>{t('config.apiKey')}</label>
          <input 
            className="form-control"
            type="password" 
            value={editingModel.apiKey} 
            onChange={e => setEditingModel({...editingModel, apiKey: e.target.value})}
            placeholder="sk-..." 
          />
          <div className="form-help">{t('config.apiKeyHelp')}</div>
        </div>

        <div className="form-group">
          <label>{t('config.modelId')}</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <input 
                className="form-control"
                value={editingModel.model} 
                onChange={e => setEditingModel({...editingModel, model: e.target.value})}
                placeholder={t('config.placeholder.modelId')}
                list="available-models"
              />
              <datalist id="available-models">
                {availableModels.map(m => <option key={m} value={m} />)}
              </datalist>
            </div>
            <button 
              onClick={() => onFetchModels(editingModel)}
              className="btn btn-secondary"
              title={t('config.fetchModels')}
            >
              <IconRefresh size={18} /> {t('config.fetchModels')}
            </button>
          </div>
          <div className="form-help">{t('config.modelIdHelp')}</div>
        </div>

        {editingModel.provider === 'ollama' && (
          <OllamaManager editingModel={editingModel} onFetchModels={onFetchModels} />
        )}

        <div className="form-actions">
          <button className="btn btn-secondary" onClick={onCancel}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={onSave}>{t('common.save')}</button>
        </div>
      </div>
    </>
  );
});
