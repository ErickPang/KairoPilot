import React, { useState, useEffect } from 'react';
import { ModelConfig, AgentConfig } from '../types';
import { 
  IconSettings, IconCpu, IconBot, IconEdit, IconTrash, 
  IconPlus, IconArrowLeft, IconCheck, IconRefresh, IconFolder,
  IconTerminal
} from './Icons';

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

  // Reset view when switching sections
  useEffect(() => {
    setView('list');
    setEditingModel(null);
    setEditingAgent(null);
  }, [activeSection]);

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
  
  const handleSelectDirectory = async () => {
    if (!editingAgent) return;
    try {
      const path = await window.ipcRenderer.invoke('system:selectDirectory');
      if (path) {
        setEditingAgent({ ...editingAgent, workspace: path });
      }
    } catch (error) {
      console.error('Failed to select directory:', error);
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
        newConfig.baseUrl = 'https://api.deepseek.com';
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
          <IconCpu size={20} /> Models
        </h3>
        <button onClick={handleCreateModel} className="btn btn-primary">
          <IconPlus size={16} /> Add Model
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
              title="Edit"
            >
              <IconEdit size={18} />
            </button>
            <button 
              onClick={() => onDeleteModel(model.id)}
              className="btn-icon danger"
              title="Delete"
            >
              <IconTrash size={18} />
            </button>
          </div>
        </div>
      ))}
      
      {models.length === 0 && (
        <div style={{ padding: '3rem', textAlign: 'center', opacity: 0.5, border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)' }}>
          <p>No models configured.</p>
          <button onClick={handleCreateModel} className="btn btn-primary" style={{ marginTop: '1rem' }}>
            Add First Model
          </button>
        </div>
      )}
    </div>
  );

  const renderAgentList = () => (
    <div className="config-section">
      <div className="config-section-header">
        <h3 className="config-section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
          <IconBot size={20} /> Agents
        </h3>
        <button onClick={handleCreateAgent} className="btn btn-primary">
          <IconPlus size={16} /> Add Agent
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
                {isActive && <span className="badge badge-primary" style={{ marginLeft: '0.5rem' }}>Active</span>}
              </h4>
              <div className="card-meta">
                <span title="Linked Model">
                  <IconCpu size={14} style={{ marginRight: '4px', verticalAlign: 'text-bottom' }} />
                  {linkedModel ? linkedModel.name : 'Unknown'}
                </span>
                <span>•</span>
                <span title="Workspace">
                  <IconFolder size={14} style={{ marginRight: '4px', verticalAlign: 'text-bottom' }} />
                  {agent.workspace ? 'Custom Workspace' : 'Default Workspace'}
                </span>
              </div>
            </div>
            <div className="card-actions">
              {!isActive && (
                <button 
                  onClick={() => onSetActiveAgent(agent.id)}
                  className="btn-icon"
                  title="Set Active"
                >
                  <IconCheck size={18} />
                </button>
              )}
              <button 
                onClick={() => handleEditAgent(agent)}
                className="btn-icon"
                title="Edit"
              >
                <IconEdit size={18} />
              </button>
              <button 
                onClick={() => onDeleteAgent(agent.id)}
                className="btn-icon danger"
                title="Delete"
              >
                <IconTrash size={18} />
              </button>
            </div>
          </div>
        );
      })}

      {agents.length === 0 && (
        <div style={{ padding: '3rem', textAlign: 'center', opacity: 0.5, border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)' }}>
          <p>No agents configured.</p>
          <button onClick={handleCreateAgent} className="btn btn-primary" style={{ marginTop: '1rem' }}>
            Create First Agent
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
            <span>{editingModel.id ? 'Edit Model' : 'New Model'}</span>
          </div>
        </div>

        <div className="config-content">
          <div className="form-section-title">General Information</div>
          
          <div className="form-row">
            <div className="form-group" style={{ flex: 2 }}>
              <label>Configuration Name</label>
              <input 
                className="form-control"
                value={editingModel.name} 
                onChange={e => setEditingModel({...editingModel, name: e.target.value})}
                placeholder="e.g. My GPT-4o"
                autoFocus
              />
              <div className="form-help">A friendly name to identify this configuration.</div>
            </div>

            <div className="form-group" style={{ flex: 1 }}>
              <label>Provider</label>
              <select 
                className="form-control"
                value={editingModel.provider} 
                onChange={handleProviderChange}
              >
                <option value="openai">OpenAI</option>
                <option value="deepseek">DeepSeek</option>
                <option value="zhipu">智谱 (Zhipu)</option>
                <option value="kimi">Kimi (Moonshot)</option>
                <option value="qianwen">通义千问 (Qianwen)</option>
                <option value="ollama">Ollama (Local)</option>
              </select>
            </div>
          </div>

          <div className="form-section-title">Connection Details</div>

          <div className="form-group">
            <label>Base URL</label>
            <input 
              className="form-control"
              value={editingModel.baseUrl} 
              onChange={e => setEditingModel({...editingModel, baseUrl: e.target.value})}
              placeholder="https://api.openai.com/v1"
            />
            <div className="form-help">The API endpoint URL. Usually auto-filled based on provider.</div>
          </div>

          <div className="form-group">
            <label>API Key</label>
            <input 
              className="form-control"
              type="password" 
              value={editingModel.apiKey} 
              onChange={e => setEditingModel({...editingModel, apiKey: e.target.value})}
              placeholder="sk-..." 
            />
            <div className="form-help">Your secret API key. Stored securely on your device.</div>
          </div>

          <div className="form-group">
            <label>Model ID</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <input 
                  className="form-control"
                  value={editingModel.model} 
                  onChange={e => setEditingModel({...editingModel, model: e.target.value})}
                  placeholder="e.g. gpt-4o"
                  list="available-models"
                />
                <datalist id="available-models">
                  {availableModels.map(m => <option key={m} value={m} />)}
                </datalist>
              </div>
              <button 
                onClick={() => onFetchModels(editingModel)}
                className="btn btn-secondary"
                title="Fetch available models from provider"
              >
                <IconRefresh size={18} /> Fetch Models
              </button>
            </div>
            <div className="form-help">The specific model identifier (e.g. gpt-4, claude-3-opus). Click 'Fetch Models' to load from provider.</div>
          </div>

          <div className="form-actions">
            <button className="btn btn-secondary" onClick={() => setView('list')}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSaveModel}>Save Model Configuration</button>
          </div>
        </div>
      </>
    );
  };

  const renderAgentEdit = () => {
    if (!editingAgent) return null;
    return (
      <>
        <div className="config-header">
          <div className="config-title">
            <button onClick={() => setView('list')} className="btn-icon" style={{ marginRight: '0.5rem' }}>
              <IconArrowLeft size={24} />
            </button>
            <span>{editingAgent.id ? 'Edit Agent' : 'New Agent'}</span>
          </div>
        </div>

        <div className="config-content">
          <div className="form-section-title">Identity & Role</div>

          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label>Agent Name</label>
              <input 
                className="form-control"
                value={editingAgent.name} 
                onChange={e => setEditingAgent({...editingAgent, name: e.target.value})}
                placeholder="e.g. Coding Assistant"
                autoFocus
              />
            </div>

            <div className="form-group" style={{ flex: 1 }}>
              <label>Model Configuration</label>
              <select 
                className="form-control"
                value={editingAgent.modelConfigId} 
                onChange={e => setEditingAgent({...editingAgent, modelConfigId: e.target.value})}
              >
                <option value="">Select a model config...</option>
                {models.map(m => (
                  <option key={m.id} value={m.id}>{m.name} ({m.model})</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>System Prompt</label>
            <textarea 
              className="form-control"
              value={editingAgent.systemPrompt} 
              onChange={e => setEditingAgent({...editingAgent, systemPrompt: e.target.value})}
              rows={6}
              placeholder="You are a helpful AI assistant..."
            />
            <div className="form-help">Define the agent's personality, capabilities, and constraints.</div>
          </div>

          <div className="form-section-title">Environment & Capabilities</div>

          <div className="form-group">
            <label>Workspace Directory</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input 
                className="form-control"
                value={editingAgent.workspace} 
                readOnly 
                placeholder="Default Workspace (System Managed)"
                style={{ cursor: 'default', color: editingAgent.workspace ? 'inherit' : 'var(--muted-fg)' }}
              />
              <button 
                onClick={handleSelectDirectory} 
                className="btn btn-secondary"
                title="Choose Directory"
              >
                <IconFolder size={18} /> Browse
              </button>
            </div>
            <div className="form-help">The directory where this agent is allowed to read and write files.</div>
          </div>

          <div className="form-section-title">Permissions</div>

          <label className="form-checkbox">
            <input 
              type="checkbox" 
              checked={editingAgent.enableShell} 
              onChange={e => setEditingAgent({...editingAgent, enableShell: e.target.checked})}
            />
            <div>
              <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <IconTerminal size={16} /> Enable Shell Commands
              </div>
              <div className="form-help" style={{ marginTop: '0.25rem', marginBottom: 0 }}>
                Allow this agent to execute shell commands in the workspace.
              </div>
            </div>
          </label>

          <div className="form-actions">
            <button className="btn btn-secondary" onClick={() => setView('list')}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSaveAgent}>Save Agent Settings</button>
          </div>
        </div>
      </>
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
                Configuration
              </div>
              <div className="config-subtitle">Manage your models and agents</div>
            </div>
          </div>

          <div className="config-content">
            {(activeSection === 'model' || !activeSection) && renderModelList()}
            {(activeSection === 'agent' || !activeSection) && renderAgentList()}
          </div>
        </>
      )}

      {view === 'edit-model' && renderModelEdit()}
      {view === 'edit-agent' && renderAgentEdit()}
    </div>
  );
}
