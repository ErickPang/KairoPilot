import { memo, useState, useEffect, useCallback } from 'react';
import { ModelConfig, AgentConfig, FetchModelsResult, ProviderCapabilitySnapshot, AppNotice } from '../types';
import { useTranslation } from '../hooks/useTranslation';
import { ModelList } from './config/ModelList';
import { AgentList } from './config/AgentList';
import { ModelEditor } from './config/ModelEditor';
import { AgentEditor } from './config/AgentEditor';
import { GeneralSettings } from './config/GeneralSettings';
import { IconBot, IconCpu, IconPlus, IconSettings } from './Icons';
import { KAIRO_INVOKE } from '../../shared/ipc';
import { createErrorNotice } from '../hooks/errorUtils';

interface ConfigPanelProps {
  models: ModelConfig[];
  agents: AgentConfig[];
  activeAgentId: string | null;
  onClearNotice: () => void;
  onReportNotice: (notice: AppNotice) => void;
  onSaveModel: (model: ModelConfig) => void;
  onDeleteModel: (id: string) => void;
  onSaveAgent: (agent: AgentConfig) => void;
  onDeleteAgent: (id: string) => void;
  onSetActiveAgent: (id: string) => void;
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
  models, agents, activeAgentId, 
  onClearNotice, onReportNotice,
  onSaveModel, onDeleteModel, 
  onSaveAgent, onDeleteAgent, onSetActiveAgent,
  onDescribeProvider, onFetchModels, availableModels, activeSection 
}: ConfigPanelProps) {
  const [view, setView] = useState<'list' | 'edit-model' | 'edit-agent'>('list');
  const [editingModel, setEditingModel] = useState<ModelConfig | null>(null);
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);
  const [isEditingExistingModel, setIsEditingExistingModel] = useState(false);

  const { t } = useTranslation();

  // Reset view when switching sections
  useEffect(() => {
    setView('list');
    setEditingModel(null);
    setEditingAgent(null);
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
      if (editingModel.provider !== 'ollama' && !normalizedApiKey) {
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
  }, [editingModel, onClearNotice, onReportNotice, onSaveModel, t]);

  const handleEditAgent = useCallback((agent: AgentConfig) => {
    setEditingAgent({ ...agent });
    setView('edit-agent');
  }, []);

  const handleCreateAgent = useCallback(async () => {
    const nextModel = models.length > 0
      ? `${models[0].id}/${models[0].availableModels?.[0]?.id || models[0].model}`
      : '';
    const draft = await window.kairo.invoke(KAIRO_INVOKE.configCreateAgentDraft, {
      model: nextModel,
      name: 'New Agent'
    });
    setEditingAgent(draft);
    setView('edit-agent');
  }, [models]);

  const handleSaveAgent = useCallback(() => {
    if (editingAgent) {
      onSaveAgent(editingAgent);
      setView('list');
      setEditingAgent(null);
    }
  }, [editingAgent, onSaveAgent]);

  const headerMeta = (() => {
    if (view === 'edit-model') {
      return {
        Icon: IconCpu,
        title: editingModel?.id ? t('config.editModel') : t('config.newModel'),
        description: t('settings.modelEditorDescription')
      };
    }

    if (view === 'edit-agent') {
      return {
        Icon: IconBot,
        title: editingAgent?.id ? t('config.editAgent') : t('config.newAgent'),
        description: t('settings.agentEditorDescription')
      };
    }

    if (activeSection === 'model') {
      return {
        Icon: IconCpu,
        title: t('config.models'),
        description: t('settings.modelOverviewDescription')
      };
    }

    if (activeSection === 'agent') {
      return {
        Icon: IconBot,
        title: t('config.agents'),
        description: t('settings.agentOverviewDescription')
      };
    }

    return {
      Icon: IconSettings,
      title: t('settings.generalOverviewTitle'),
      description: t('settings.generalOverviewDescription')
    };
  })();
  const HeaderIcon = headerMeta.Icon;
  const headerAction = view === 'list'
    ? activeSection === 'model'
      ? {
          label: t('config.addModel'),
          onClick: handleCreateModel
        }
      : activeSection === 'agent'
        ? {
            label: t('config.addAgent'),
            onClick: () => { void handleCreateAgent(); }
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
                  <div className="config-page-icon">
                    <HeaderIcon size={20} />
                  </div>
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
            {(activeSection === 'agent' || !activeSection) && (
              <AgentList 
                agents={agents}
                models={models}
                activeAgentId={activeAgentId}
                onCreateAgent={handleCreateAgent}
                onEditAgent={handleEditAgent}
                onDeleteAgent={onDeleteAgent}
                onSetActiveAgent={onSetActiveAgent}
              />
            )}
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
      
      {view === 'edit-agent' && editingAgent && (
        <AgentEditor 
          editingAgent={editingAgent}
          setEditingAgent={setEditingAgent}
          models={models}
          agents={agents}
          onSave={handleSaveAgent}
          onCancel={() => {
            setView('list');
            setEditingAgent(null);
          }}
        />
      )}
    </div>
  );
});
