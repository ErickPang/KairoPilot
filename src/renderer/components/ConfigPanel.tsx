import { memo, useState, useEffect, useCallback } from 'react';
import { ModelConfig, WorkbenchConfig,WorkbenchSettingsInput, FetchModelsResult, ProviderCapabilitySnapshot, AppNotice } from '../types';
import { useTranslation } from '../hooks/useTranslation';
import { ModelList } from './config/ModelList';
import { WorkbenchSettings } from './config/WorkbenchSettings';
import { ModelEditor } from './config/ModelEditor';
import { GeneralSettings } from './config/GeneralSettings';
import { IconCpu, IconPlus, IconSettings } from './Icons';
import { createErrorNotice } from '../hooks/errorUtils';

interface ConfigPanelProps {
  models: ModelConfig[];
  workbench?: WorkbenchConfig;
  onSaveWorkbench:(value:WorkbenchSettingsInput)=>Promise<void>;
  onClearNotice: () => void;
  onReportNotice: (notice: AppNotice) => void;
  onSaveModel: (model: ModelConfig) => void;
  onDeleteModel: (id: string) => void;
  onDescribeProvider: (config: ModelConfig) => Promise<ProviderCapabilitySnapshot | null>;
  onFetchModels: (config: ModelConfig) => Promise<FetchModelsResult>;
  availableModels: string[];
  activeSection?: string;
}

const EmptyModelConfig: ModelConfig = {
  id: '',
  name: '',
  provider: 'openai',
  baseUrl: '',
  apiKey: '',
  model: '',
  availableModels: []
};

export const ConfigPanel = memo(function ConfigPanel({ 
  models, workbench,onSaveWorkbench,
  onClearNotice, onReportNotice,
  onSaveModel, onDeleteModel, 
  onDescribeProvider, onFetchModels, availableModels, activeSection 
}: ConfigPanelProps) {
  const [view, setView] = useState<'list' | 'edit-model'>('list');
  const [editingModel, setEditingModel] = useState<ModelConfig | null>(null);
  const [isEditingExistingModel, setIsEditingExistingModel] = useState(false);

  const { t } = useTranslation();

  // Reset view when switching sections
  useEffect(() => {
    setView('list');
    setEditingModel(null);
  }, [activeSection]);

  const handleEditModel = useCallback((model: ModelConfig) => {
    setEditingModel({ ...model });
    setIsEditingExistingModel(true);
    setView('edit-model');
    // Auto-fetch models when opening edit
    void onFetchModels(model);
  }, [onFetchModels]);

  const handleCreateModel = useCallback(() => {
    setEditingModel({ ...EmptyModelConfig });
    setIsEditingExistingModel(false);
    setView('edit-model');
  }, []);

  const handleSaveModel = useCallback(() => {
    if (editingModel) {
      onClearNotice();
      const normalizedName = editingModel.name.trim();
      const normalizedApiKey = editingModel.apiKey.trim();
      if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(normalizedName)) {
        onReportNotice(createErrorNotice(t('config.validation.modelName'), 'model_validation'));
        return;
      }
      if (!editingModel.provider) {
        onReportNotice(createErrorNotice(t('config.validation.provider'), 'model_validation'));
        return;
      }
      const canReuseStoredApiKey = isEditingExistingModel
        && editingModel.apiKeyStored
        && normalizedName === editingModel.id;
      if (editingModel.provider !== 'ollama' && !normalizedApiKey && !canReuseStoredApiKey) {
        onReportNotice(createErrorNotice(t('config.validation.apiKey'), 'model_validation'));
        return;
      }
      const selectedModelIds = (editingModel.availableModels || []).map(item => item.id).filter(Boolean);
      if (selectedModelIds.length === 0 && !editingModel.model.trim()) {
        onReportNotice(createErrorNotice(t('config.validation.modelId'), 'model_validation'));
        return;
      }
      onSaveModel({ ...editingModel, id: normalizedName, name: normalizedName, apiKey: normalizedApiKey });
      setView('list');
      setEditingModel(null);
    }
  }, [editingModel, isEditingExistingModel, onClearNotice, onReportNotice, onSaveModel, t]);

  const headerMeta = (() => {
    if (view === 'edit-model') {
      return {
        Icon: IconCpu,
        title: editingModel?.id ? t('config.editModel') : t('config.newModel'),
        description: t('settings.modelEditorDescription')
      };
    }

    if (activeSection === 'model') {
      return {
        Icon: IconCpu,
        title: t('config.models'),
        description: t('settings.modelOverviewDescription')
      };
    }

    if(activeSection==='execution' || activeSection==='rules')return {Icon:IconSettings,title:t(activeSection==='execution'?'workbench.executionSettings':'workbench.rulesSettings'),description:t('workbench.settingsDescription')};

    return {
      Icon: IconSettings,
      title: t('settings.generalOverviewTitle'),
      description: t('settings.generalOverviewDescription')
    };
  })();
  const headerAction = view === 'list'
    ? activeSection === 'model'
      ? {
          label: t('config.addModel'),
          onClick: handleCreateModel
        }
      : null
    : null;

  return (
    <div className="config-panel">
      {view === 'list' && (
        <>
          <div className="config-header config-page-header">
            <div className="config-page-title-block">
              <div className="config-page-title-row">
                <div className="config-page-title-main">
                  <div>
                    <div className="config-title">{headerMeta.title}</div>
                  </div>
                </div>
                {headerAction && (
                  <button type="button" className="btn btn-primary config-page-header-action" onClick={headerAction.onClick}>
                    <IconPlus size={16} /> {headerAction.label}
                  </button>
                )}
              </div>
              <div className="config-subtitle config-page-subtitle">{headerMeta.description}</div>
            </div>
          </div>
          <div className="config-content config-content-standalone config-detail-shell">
            {(activeSection === 'model' || !activeSection) && (
              <ModelList 
                models={models}
                onCreateModel={handleCreateModel}
                onEditModel={handleEditModel}
                onDeleteModel={onDeleteModel}
              />
            )}
            {workbench && (activeSection==='execution' || activeSection==='rules') && <WorkbenchSettings config={workbench} models={models} section={activeSection} onSave={onSaveWorkbench}/>}
            {activeSection === 'general' && <GeneralSettings />}
          </div>
        </>
      )}

      {view === 'edit-model' && editingModel && (
        <ModelEditor 
          editingModel={editingModel}
          setEditingModel={setEditingModel}
          isEditingExisting={isEditingExistingModel}
          availableModels={availableModels}
          onClearNotice={onClearNotice}
          onReportNotice={onReportNotice}
          onDescribeProvider={onDescribeProvider}
          onFetchModels={onFetchModels}
          onSave={handleSaveModel}
          onCancel={() => {
            setView('list');
            setEditingModel(null);
          }}
        />
      )}
      

    </div>
  );
});
