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

const PROVIDER_BASE_URLS: Partial<Record<ModelConfig['provider'], string>> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  kimi: 'https://api.moonshot.cn/v1',
  qianwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  ollama: 'http://localhost:11434/v1',
  anthropic: 'https://api.anthropic.com/v1',
  custom: ''
};

export const ModelEditor = memo(function ModelEditor({ 
  editingModel, 
  setEditingModel, 
  availableModels, 
  onFetchModels, 
  onSave, 
  onCancel 
}: ModelEditorProps) {
  const { t } = useTranslation();
  const canFetchModels = editingModel.baseUrl.trim().length > 0;

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const provider = e.target.value as ModelConfig['provider'];
    const nextBaseUrl = PROVIDER_BASE_URLS[provider];
    const newConfig = {
      ...editingModel,
      provider,
      baseUrl: nextBaseUrl !== undefined ? nextBaseUrl : editingModel.baseUrl
    };
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
                { value: 'custom', label: t('config.providerCustom') },
              ]}
            />
            {editingModel.provider === 'custom' && (
              <div className="form-help">{t('config.providerCustomHelp')}</div>
            )}
          </div>
        </div>

        <div className="form-section-title">{t('config.connectionDetails')}</div>

        <div className="form-group">
          <label>{t('config.baseUrl')}</label>
          <input 
              className="form-control"
              value={editingModel.baseUrl || ''} 
              onChange={e => setEditingModel({...editingModel, baseUrl: e.target.value})}
              placeholder={editingModel.provider === 'custom' ? t('config.placeholder.customBaseUrl') : t('config.placeholder.baseUrl')}
            />
          <div className="form-help">
            {editingModel.provider === 'custom' ? t('config.baseUrlHelpCustom') : t('config.baseUrlHelp')}
          </div>
        </div>

        <div className="form-group">
          <label>{t('config.apiKey')}</label>
          <input 
            className="form-control"
            type="password" 
            value={editingModel.apiKey} 
            onChange={e => setEditingModel({...editingModel, apiKey: e.target.value})}
            placeholder={t('config.placeholder.apiKey')} 
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
                placeholder={editingModel.provider === 'custom' ? t('config.placeholder.customModelId') : t('config.placeholder.modelId')}
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
              disabled={!canFetchModels}
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
