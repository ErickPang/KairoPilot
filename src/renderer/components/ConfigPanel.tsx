import React, { useState, useEffect } from 'react';
import { ModelConfig, AgentConfig } from '../types';
import { 
  IconSettings, IconCpu, IconBot, IconEdit, IconTrash, 
  IconPlus, IconArrowLeft, IconCheck, IconRefresh, IconFolder,
  IconTerminal
} from './Icons';
import { useTranslation } from '../hooks/useTranslation';
import { Select } from './Select';

interface ConfigPanelProps {
  models: ModelConfig[];
  agents: AgentConfig[];
  activeAgentId: string | null;
  onSaveModel: (model: ModelConfig) => void;
  onDeleteModel: (id: string) => void;
  onSaveAgent: (agent: AgentConfig) => void;
  onDeleteAgent: (id: string) => void;
  onSetActiveAgent: (id: string) => void;
  onFetchModels: (config: ModelConfig) => void;
  availableModels: string[];
  activeSection?: string;
}

function generateId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

const EmptyModelConfig: ModelConfig = {
  id: '',
  name: 'New Model',
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-3.5-turbo'
};

const EmptyAgentConfig: AgentConfig = {
  id: '',
  name: 'New Agent',
  workspace: '',
  systemPrompt: 'You are a helpful AI assistant.',
  modelConfigId: '',
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

  // Ollama Specific State
  const [ollamaStatus, setOllamaStatus] = useState<{running: boolean; message?: string, error?: string} | null>(null);
  const [modelToPull, setModelToPull] = useState('');
  const [pullProgress, setPullProgress] = useState<{status: string, completed?: number, total?: number} | null>(null);
  const [isPulling, setIsPulling] = useState(false);
  const [isStartingOllama, setIsStartingOllama] = useState(false);

  const { t, locale, setLocale } = useTranslation();

  // Reset view when switching sections
  useEffect(() => {
    setView('list');
    setEditingModel(null);
    setEditingAgent(null);
    setOllamaStatus(null);
  }, [activeSection]);

  const checkOllamaStatus = async (baseUrl?: string) => {
    try {
      const url = (baseUrl || 'http://localhost:11434').replace('/v1', '');
      const res = await window.ipcRenderer.invoke('ollama:check', url);
      setOllamaStatus(res);
    } catch (error) {
      setOllamaStatus({ running: false, error: 'Failed to check status' });
    }
  };

  useEffect(() => {
    if (editingModel?.provider === 'ollama') {
      checkOllamaStatus(editingModel.baseUrl);
    } else {
      setOllamaStatus(null);
    }
  }, [editingModel?.provider, editingModel?.baseUrl]);

  useEffect(() => {
    const removeListener = window.ipcRenderer.on('ollama:pull-progress', (_event, data: any) => {
      setPullProgress(data);
    });
    return () => removeListener();
  }, []);

  const handlePullModel = async () => {
    if (!modelToPull || !editingModel) return;
    setIsPulling(true);
    setPullProgress({ status: 'Starting pull...' });
    
    try {
      const url = editingModel.baseUrl.replace('/v1', '');
      const res = await window.ipcRenderer.invoke('ollama:pull', { baseUrl: url, modelName: modelToPull });
      
      if (res.success) {
        setPullProgress({ status: 'Success! Model pulled.' });
        onFetchModels(editingModel); // Refresh model list
        setModelToPull('');
      } else {
        setPullProgress({ status: `Error: ${res.error}` });
      }
    } catch (e: any) {
      setPullProgress({ status: `Error: ${e.message}` });
    } finally {
      setIsPulling(false);
      setTimeout(() => {
        if (!isPulling) setPullProgress(null);
      }, 5000);
    }
  };

  const handleStartOllama = async () => {
    setIsStartingOllama(true);
    try {
      const res = await window.ipcRenderer.invoke('ollama:start');
      if (res.success) {
        // Give it a moment to fully spin up before checking status again
        setTimeout(() => {
          checkOllamaStatus(editingModel?.baseUrl);
          setIsStartingOllama(false);
        }, 2000);
      } else {
        alert(t('config.startOllamaFailed', { error: res.error || 'Unknown' }));
        setIsStartingOllama(false);
      }
    } catch (e: any) {
      alert(t('config.startOllamaError', { error: e.message || 'Unknown' }));
      setIsStartingOllama(false);
    }
  };

  const handleEditModel = (model: ModelConfig) => {
    setEditingModel({ ...model });
    setView('edit-model');
    // Auto-fetch models when opening edit
    onFetchModels(model);
  };

  const handleCreateModel = () => {
    setEditingModel({ ...EmptyModelConfig, id: generateId() });
    setView('edit-model');
  };

  const handleSaveModel = () => {
    if (editingModel) {
      onSaveModel(editingModel);
      setView('list');
      setEditingModel(null);
    }
  };

  const handleEditAgent = (agent: AgentConfig) => {
    setEditingAgent({ ...agent });
    setView('edit-agent');
  };

  const handleCreateAgent = () => {
    setEditingAgent({ 
      ...EmptyAgentConfig, 
      id: generateId(), 
      // Default to first model if available
      modelConfigId: models.length > 0 ? models[0].id : '' 
    });
    setView('edit-agent');
  };

  const handleSaveAgent = () => {
    if (editingAgent) {
      onSaveAgent(editingAgent);
      setView('list');
      setEditingAgent(null);
    }
  };

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!editingModel) return;
    
    const provider = e.target.value as ModelConfig['provider'];
    const newConfig = { ...editingModel, provider };
    
    // Auto-fill base URL
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

  const renderModelList = () => (
    <div className="config-section">
      <div className="config-section-header">
        <h3 className="config-section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
          <IconCpu size={20} /> {t('config.models')}
        </h3>
        <button onClick={handleCreateModel} className="btn btn-primary">
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
              onClick={() => handleEditModel(model)}
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
          <button onClick={handleCreateModel} className="btn btn-primary" style={{ marginTop: '1rem' }}>
            {t('config.addFirstModel')}
          </button>
        </div>
      )}
    </div>
  );

  const renderAgentList = () => (
    <div className="config-section">
      <div className="config-section-header">
        <h3 className="config-section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
          <IconBot size={20} /> {t('config.agents')}
        </h3>
        <button onClick={handleCreateAgent} className="btn btn-primary">
          <IconPlus size={16} /> {t('config.addAgent')}
        </button>
      </div>

      {agents.map(agent => {
        const isActive = agent.id === activeAgentId;
        const linkedModel = models.find(m => m.id === agent.modelConfigId);
        
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
                  {linkedModel ? linkedModel.name : 'Unknown'}
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
                onClick={() => handleEditAgent(agent)}
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
          <button onClick={handleCreateAgent} className="btn btn-primary" style={{ marginTop: '1rem' }}>
            {t('config.createFirstAgent')}
          </button>
        </div>
      )}
    </div>
  );

  const renderModelEdit = () => {
    if (!editingModel) return null;
    return (
      <>
        <div className="config-header">
          <div className="config-title">
            <button onClick={() => setView('list')} className="btn-icon" style={{ marginRight: '0.5rem' }}>
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
                onChange={(val) => handleProviderChange({ target: { value: val } } as any)}
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
            <div className="form-group" style={{ 
              marginTop: '1rem', 
              padding: '1.25rem', 
              background: 'var(--sidebar-bg)', 
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)' 
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <IconCpu size={18} /> Ollama Manager
                </h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                  <span style={{ 
                    display: 'inline-block', 
                    width: '8px', height: '8px', 
                    borderRadius: '50%', 
                    background: ollamaStatus?.running ? 'var(--success)' : 'var(--danger)' 
                  }}></span>
                  {ollamaStatus?.running ? t('config.ollamaRunning') : t('config.ollamaNotRunning')}
                  
                  {!ollamaStatus?.running && (
                    <button 
                      onClick={handleStartOllama} 
                      disabled={isStartingOllama} 
                      className="btn btn-secondary" 
                      style={{ padding: '0.15rem 0.5rem', fontSize: '0.75rem', marginLeft: '0.5rem' }}
                    >
                      {isStartingOllama ? t('config.ollamaStarting') : t('config.ollamaStart')}
                    </button>
                  )}
                </div>
              </div>
              
              <label>{t('config.ollamaPull')}</label>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                 <input 
                    className="form-control"
                    value={modelToPull} 
                    onChange={e => setModelToPull(e.target.value)} 
                    placeholder={t('config.placeholder.ollamaModel')} 
                    disabled={isPulling || !ollamaStatus?.running}
                 />
                 <button 
                    onClick={handlePullModel} 
                    className="btn btn-primary" 
                    disabled={isPulling || !modelToPull || !ollamaStatus?.running}
                 >
                   {isPulling ? t('config.pulling') : t('config.pull')}
                 </button>
              </div>
              <div className="form-help">{t('config.ollamaPullHelp')}</div>
              {pullProgress && (
                <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--muted-fg)' }}>
                  <div>Status: {pullProgress.status}</div>
                  {pullProgress.total && pullProgress.completed && (
                    <div style={{ marginTop: '0.25rem', height: '4px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ 
                        height: '100%', 
                        background: 'var(--primary)', 
                        width: `${Math.min(100, Math.round((pullProgress.completed / pullProgress.total) * 100))}%`,
                        transition: 'width 0.2s'
                      }}></div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="form-actions">
            <button className="btn btn-secondary" onClick={() => setView('list')}>{t('common.cancel')}</button>
            <button className="btn btn-primary" onClick={handleSaveModel}>{t('common.save')}</button>
          </div>
        </div>
      </>
    );
  };

  const renderAgentEdit = () => {
    if (!editingAgent) return null;
    
    const isNewAgent = !agents.some(a => a.id === editingAgent.id);
    
    return (
      <>
        <div className="config-header">
          <div className="config-title">
            <button onClick={() => setView('list')} className="btn-icon" style={{ marginRight: '0.5rem' }}>
              <IconArrowLeft size={24} />
            </button>
            <span>{isNewAgent ? t('config.newAgent') : t('config.editAgent')}</span>
          </div>
        </div>

        <div className="config-content">
          <div className="form-section-title">{t('config.agentInfo')}</div>

          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label>{t('config.agentName')}</label>
              <input 
                className="form-control"
                value={editingAgent.name} 
                onChange={e => {
                  const newName = e.target.value;
                  const updates: Partial<typeof editingAgent> = { name: newName };
                  if (isNewAgent) {
                    updates.workspaceName = newName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '');
                  }
                  setEditingAgent({...editingAgent, ...updates});
                }}
                placeholder="e.g. Coding Assistant"
                disabled={!isNewAgent}
                autoFocus={isNewAgent}
              />
              {!isNewAgent && <div className="form-help">{t('config.agentNameHelp')}</div>}
            </div>

            <div className="form-group" style={{ flex: 1 }}>
              <label>{t('config.linkedModel')}</label>
              <Select 
                value={editingAgent.modelConfigId} 
                onChange={(val) => setEditingAgent({...editingAgent, modelConfigId: val})}
                placeholder={t('config.selectModel')}
                options={models.map(m => ({ value: m.id, label: `${m.name} (${m.model})` }))}
              />
            </div>
          </div>

          <div className="form-group">
            <label>{t('config.systemPrompt')}</label>
            <textarea 
              className="form-control"
              value={editingAgent.systemPrompt} 
              onChange={e => setEditingAgent({...editingAgent, systemPrompt: e.target.value})}
              rows={6}
              placeholder={t('config.placeholder.systemPrompt')}
            />
            <div className="form-help">{t('config.systemPromptHelp')}</div>
          </div>

          <div className="form-section-title">{t('config.workspace')}</div>

          <div className="form-group">
            <label>{t('config.workspaceName')}</label>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {editingAgent.id === 'mainAgent' ? (
                <span style={{ color: 'var(--foreground)', whiteSpace: 'nowrap', padding: '0.5rem 0' }}>~/.kairopilot/workspace</span>
              ) : (
                <>
                  <span style={{ color: 'var(--muted-fg)', whiteSpace: 'nowrap' }}>~/.kairopilot/workspace-</span>
                  <input 
                    className="form-control"
                    value={editingAgent.workspaceName !== undefined ? editingAgent.workspaceName : (
                      editingAgent.workspace ? 
                        (editingAgent.workspace.match(/workspace-(.+)$/) ? editingAgent.workspace.match(/workspace-(.+)$/)![1] : (
                          editingAgent.workspace.endsWith('workspace') ? '' : 'custom'
                        ))
                        : ''
                    )}
                    onChange={e => {
                      const val = e.target.value.replace(/[^a-zA-Z0-9_-]/g, '');
                      setEditingAgent({...editingAgent, workspaceName: val});
                    }} 
                    placeholder={t('config.placeholder.workspace')}
                    disabled={!isNewAgent}
                    style={{ flex: 1 }}
                  />
                </>
              )}
            </div>
            {editingAgent.id === 'mainAgent' ? (
              <div className="form-help">{t('config.workspaceNameHelpMain')}</div>
            ) : (
              <div className="form-help">
                {isNewAgent 
                  ? t('config.workspaceNameHelp') 
                  : t('config.workspaceNameHelpFixed')}
              </div>
            )}
          </div>

          <div className="form-section-title">{t('config.security')}</div>

          <label className="form-checkbox">
            <input 
              type="checkbox" 
              checked={editingAgent.enableShell} 
              onChange={e => setEditingAgent({...editingAgent, enableShell: e.target.checked})}
            />
            <div>
              <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <IconTerminal size={16} /> {t('config.allowShell')}
              </div>
              <div className="form-help" style={{ marginTop: '0.25rem', marginBottom: 0 }}>
                {t('config.allowShellHelp')}
              </div>
            </div>
          </label>

          <div className="form-actions">
            <button className="btn btn-secondary" onClick={() => setView('list')}>{t('common.cancel')}</button>
            <button className="btn btn-primary" onClick={handleSaveAgent}>{t('common.save')}</button>
          </div>
        </div>
      </>
    );
  };

  const renderGeneralSettings = () => {
    return (
      <div className="config-section">
        <div className="config-section-header">
          <h3>{t('settings.general')}</h3>
        </div>
        <div className="config-card">
          <div className="form-group">
                <label>{t('general.language')}</label>
                <Select 
                  value={locale} 
                  onChange={(val) => setLocale(val as 'zh' | 'en')}
                  style={{ width: '300px' }}
                  options={[
                    { value: 'zh', label: t('general.language.zh') },
                    { value: 'en', label: t('general.language.en') }
                  ]}
                />
              </div>
        </div>
      </div>
    );
  };

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
            {(activeSection === 'model' || !activeSection) && renderModelList()}
            {(activeSection === 'agent' || !activeSection) && renderAgentList()}
            {activeSection === 'general' && renderGeneralSettings()}
          </div>
        </>
      )}

      {view === 'edit-model' && renderModelEdit()}
      {view === 'edit-agent' && renderAgentEdit()}
    </div>
  );
}
