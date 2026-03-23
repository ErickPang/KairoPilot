import { useState, useEffect, useCallback } from 'react';
import { ModelConfig, AgentConfig, FetchModelsResult } from '../types';
import { IconSettings } from './Icons';
import { useTranslation } from '../hooks/useTranslation';
import { ModelList } from './config/ModelList';
import { AgentList } from './config/AgentList';
import { ModelEditor } from './config/ModelEditor';
import { AgentEditor } from './config/AgentEditor';
import { GeneralSettings } from './config/GeneralSettings';

interface ConfigPanelProps {
  models: ModelConfig[];
  agents: AgentConfig[];
  activeAgentId: string | null;
  onSaveModel: (model: ModelConfig) => void;
  onDeleteModel: (id: string) => void;
  onSaveAgent: (agent: AgentConfig) => void;
  onDeleteAgent: (id: string) => void;
  onSetActiveAgent: (id: string) => void;
  onFetchModels: (config: ModelConfig) => Promise<FetchModelsResult>;
  availableModels: string[];
  activeSection?: string;
}

const EmptyModelConfig: ModelConfig = {
  id: '',
  name: '',
  provider: '',
  baseUrl: '',
  apiKey: '',
  model: '',
  availableModels: []
};

const EmptyAgentConfig: AgentConfig = {
  id: '',
  name: 'New Agent',
  workspace: '',
  systemPrompt: 'You are a helpful AI assistant.',
  model: '',
  allowedPaths: [],
  allowedCommands: [],
  enableShell: false
};

export function ConfigPanel({ 
  models, agents, activeAgentId, 
  onSaveModel, onDeleteModel, 
  onSaveAgent, onDeleteAgent, onSetActiveAgent,
  onFetchModels, availableModels, activeSection 
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
      const normalizedName = editingModel.name.trim();
      if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(normalizedName)) {
        alert('模型名称只能使用英文、数字、下划线或短横线，且必须以英文开头');
        return;
      }
      if (!editingModel.provider) {
        alert('请先选择提供商');
        return;
      }
      const selectedModelIds = (editingModel.availableModels || []).map(item => item.id).filter(Boolean);
      if (selectedModelIds.length === 0 && !editingModel.model.trim()) {
        alert('请至少选择一个模型ID');
        return;
      }
      onSaveModel({ ...editingModel, id: normalizedName, name: normalizedName });
      setView('list');
      setEditingModel(null);
    }
  }, [editingModel, onSaveModel]);

  const handleEditAgent = useCallback((agent: AgentConfig) => {
    setEditingAgent({ ...agent });
    setView('edit-agent');
  }, []);

  const handleCreateAgent = useCallback(() => {
    setEditingAgent({ 
      ...EmptyAgentConfig, 
      id: Math.random().toString(36).slice(2, 12),
      model: models.length > 0
        ? `${models[0].id}/${models[0].availableModels?.[0]?.id || models[0].model}`
        : ''
    });
    setView('edit-agent');
  }, [models]);

  const handleSaveAgent = useCallback(() => {
    if (editingAgent) {
      onSaveAgent(editingAgent);
      setView('list');
      setEditingAgent(null);
    }
  }, [editingAgent, onSaveAgent]);

  return (
    <div className="config-panel">
      {view === 'list' && (
        <>
          <div className="config-header">
            <div>
              <div className="config-title">
                <div style={{ 
                  width: '32px', height: '32px', borderRadius: 'var(--radius-md)', 
                  background: 'var(--primary)', display: 'flex', alignItems: 'center', 
                  justifyContent: 'center', color: 'var(--primary-fg)', marginRight: '0.75rem' 
                }}>
                  <IconSettings size={20} />
                </div>
                {t('settings.title')}
              </div>
              <div className="config-subtitle">{t('settings.subtitle')}</div>
            </div>
          </div>

          <div className="config-content">
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
}
