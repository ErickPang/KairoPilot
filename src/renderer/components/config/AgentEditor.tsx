import { memo } from 'react';
import { AgentConfig, ModelConfig } from '../../types';
import { IconArrowLeft, IconTerminal } from '../Icons';
import { Select } from '../Select';
import { useTranslation } from '../../hooks/useTranslation';

interface AgentEditorProps {
  editingAgent: AgentConfig;
  setEditingAgent: (agent: AgentConfig) => void;
  models: ModelConfig[];
  agents: AgentConfig[];
  onSave: () => void;
  onCancel: () => void;
}

export const AgentEditor = memo(function AgentEditor({
  editingAgent,
  setEditingAgent,
  models,
  agents,
  onSave,
  onCancel
}: AgentEditorProps) {
  const { t } = useTranslation();
  const isNewAgent = !agents.some(a => a.id === editingAgent.id);
  const [selectedProvider, selectedModelId] = editingAgent.model.includes('/')
    ? editingAgent.model.split('/', 2)
    : [models[0]?.id || '', ''];
  const providerOptions = models.map(model => ({
    value: model.id,
    label: model.name
  }));
  const activeProvider = models.find(model => model.id === selectedProvider) || models[0];
  const activeProviderModelOptions = activeProvider
    ? ((activeProvider.availableModels && activeProvider.availableModels.length > 0
      ? activeProvider.availableModels
      : [{ id: activeProvider.model, name: activeProvider.model }]).map(item => ({
      value: item.id,
      label: item.id
    })))
    : [];
  const activeModelId = selectedModelId || activeProviderModelOptions[0]?.value || '';

  return (
    <>
      <div className="config-header">
        <div className="config-title">
          <button onClick={onCancel} className="btn-icon" style={{ marginRight: '0.5rem' }}>
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
              placeholder={t('config.placeholder.agentName')}
              disabled={!isNewAgent}
              autoFocus={isNewAgent}
            />
            {!isNewAgent && <div className="form-help">{t('config.agentNameHelp')}</div>}
          </div>

          <div className="form-group" style={{ flex: 1 }}>
            <label>{t('config.linkedModel')}</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <Select
                value={activeProvider?.id || ''}
                onChange={(providerId) => {
                  const provider = models.find(item => item.id === providerId);
                  const providerModels = provider
                    ? (provider.availableModels && provider.availableModels.length > 0
                      ? provider.availableModels
                      : [{ id: provider.model, name: provider.model }])
                    : [];
                  const nextModelId = providerModels[0]?.id || '';
                  setEditingAgent({ ...editingAgent, model: `${providerId}/${nextModelId}` });
                }}
                placeholder="选择模型提供商"
                options={providerOptions}
              />
              <Select
                value={activeModelId}
                onChange={(modelId) => {
                  const providerId = activeProvider?.id || selectedProvider;
                  setEditingAgent({ ...editingAgent, model: `${providerId}/${modelId}` });
                }}
                placeholder={t('config.selectModel')}
                options={activeProviderModelOptions}
              />
            </div>
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
          <button className="btn btn-secondary" onClick={onCancel}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={onSave}>{t('common.save')}</button>
        </div>
      </div>
    </>
  );
});
