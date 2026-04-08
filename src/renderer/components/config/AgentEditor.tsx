import { memo, useMemo, useState } from 'react';
import type { AgentConfig, AgentPermissionConfig, ModelConfig } from '../../types';
import { IconArrowLeft, IconFolder, IconShield, IconTerminal } from '../Icons';
import { Select } from '../Select';
import { useTranslation } from '../../hooks/useTranslation';
import { applyExecutionProfileConstraints, createDefaultPolicyConfig, DEFAULT_SHELL_COMMANDS } from '../../../shared/contracts';

const SHELL_COMMAND_DESCRIPTIONS: Record<string, { zh: string; en: string }> = {
  ls: { zh: '列出目录内容', en: 'List directory contents' },
  cd: { zh: '切换当前目录', en: 'Change current directory' },
  pwd: { zh: '显示当前目录路径', en: 'Print current directory path' },
  mkdir: { zh: '创建目录', en: 'Create directories' },
  rm: { zh: '删除文件或目录（高风险）', en: 'Remove files or directories (high risk)' },
  touch: { zh: '创建空文件或更新时间戳', en: 'Create empty file or update timestamp' },
  cat: { zh: '查看文件内容', en: 'Display file contents' },
  grep: { zh: '按条件搜索文本', en: 'Search text by pattern' },
  echo: { zh: '输出文本到终端', en: 'Print text to terminal' },
  npm: { zh: 'Node.js 包管理与脚本执行', en: 'Node.js package management and scripts' },
  node: { zh: '运行 Node.js 脚本', en: 'Run Node.js scripts' },
  git: { zh: '版本控制操作', en: 'Version control operations' },
  python: { zh: '运行 Python 脚本', en: 'Run Python scripts' },
  python3: { zh: '运行 Python3 脚本', en: 'Run Python3 scripts' },
  open: { zh: '用系统应用打开文件或链接', en: 'Open files or URLs with system app' },
  curl: { zh: '发起网络请求', en: 'Make HTTP requests' }
};

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
  const { t, locale } = useTranslation();
  const [activeDocTab, setActiveDocTab] = useState<'kairopilot' | 'identity' | 'user' | 'soul'>('kairopilot');
  const [isShellCommandsExpanded, setIsShellCommandsExpanded] = useState(false);
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
  const docTabs = useMemo(() => ([
    { id: 'kairopilot' as const, label: 'KAIROPILOT.md' },
    { id: 'identity' as const, label: 'IDENTITY.md' },
    { id: 'user' as const, label: 'USER.md' },
    { id: 'soul' as const, label: 'SOUL.md' }
  ]), []);
  const activeDocValue = activeDocTab === 'kairopilot'
    ? editingAgent.systemPrompt
    : activeDocTab === 'identity'
      ? editingAgent.identityPrompt
      : activeDocTab === 'user'
        ? editingAgent.userPrompt
        : editingAgent.soulPrompt;
  const permissions = editingAgent.permissions;
  const shellCommands = useMemo(() => {
    const source = [...DEFAULT_SHELL_COMMANDS, ...permissions.shell.allowedCommands];
    return Array.from(new Set(source.map(item => item.trim()).filter(Boolean)));
  }, [permissions.shell.allowedCommands]);
  const commandDescriptionLocale = locale === 'zh' ? 'zh' : 'en';
  const selectedCommands = useMemo(
    () => new Set(permissions.shell.allowedCommands.map(item => item.trim()).filter(Boolean)),
    [permissions.shell.allowedCommands]
  );
  const effectiveSelectedCommands = useMemo(
    () => (permissions.shell.enabled ? selectedCommands : new Set<string>()),
    [permissions.shell.enabled, selectedCommands]
  );
  const executionProfileOptions = useMemo(() => ([
    { value: 'chat_only', label: t('config.executionProfile.chat_only') },
    { value: 'read_only_workspace', label: t('config.executionProfile.read_only_workspace') },
    { value: 'approved_execution', label: t('config.executionProfile.approved_execution') },
    { value: 'trusted_automation', label: t('config.executionProfile.trusted_automation') }
  ]), [t]);
  const approvalModeOptions = useMemo(() => ([
    { value: 'never', label: t('config.approvalMode.never') },
    { value: 'on_write', label: t('config.approvalMode.on_write') },
    { value: 'on_external', label: t('config.approvalMode.on_external') },
    { value: 'always', label: t('config.approvalMode.always') }
  ]), [t]);
  const environmentScopeOptions = useMemo(() => ([
    { value: 'workspace', label: t('config.environmentScope.workspace') },
    { value: 'allowed_paths', label: t('config.environmentScope.allowed_paths') },
    { value: 'isolated_env', label: t('config.environmentScope.isolated_env') }
  ]), [t]);
  const dataClassOptions = useMemo(() => ([
    { value: 'public', label: t('config.dataClass.public') },
    { value: 'project', label: t('config.dataClass.project') },
    { value: 'sensitive', label: t('config.dataClass.sensitive') }
  ]), [t]);
  const allowedPathsValue = permissions.fileSystem.allowedPaths.join('\n');
  const allowedDomainsValue = permissions.network.allowedDomains.join('\n');
  const fileReadLocked = permissions.executionProfile === 'chat_only';
  const fileWriteLocked = permissions.executionProfile === 'chat_only' || permissions.executionProfile === 'read_only_workspace';
  const networkLocked = permissions.executionProfile === 'chat_only';
  const shellLocked = permissions.executionProfile === 'chat_only' || permissions.executionProfile === 'read_only_workspace';
  const enabledCapabilityCount = [
    permissions.fileSystem.read,
    permissions.fileSystem.write,
    permissions.network.enabled,
    permissions.shell.enabled
  ].filter(Boolean).length;
  const updatePermissions = (updater: (current: AgentPermissionConfig) => AgentPermissionConfig) => {
    setEditingAgent({
      ...editingAgent,
      permissions: updater(editingAgent.permissions)
    });
  };
  const parseListInput = (value: string) => Array.from(new Set(value
    .split(/[\n,]/)
    .map(item => item.trim())
    .filter(Boolean)));
  const toggleCommand = (command: string, checked: boolean) => {
    const normalizedCommand = command.trim();
    if (!normalizedCommand || !permissions.shell.enabled) {
      return;
    }
    const nextSet = new Set(effectiveSelectedCommands);
    if (checked) {
      nextSet.add(normalizedCommand);
    } else {
      nextSet.delete(normalizedCommand);
    }
    const nextAllowedCommands = shellCommands.filter(item => nextSet.has(item));
    updatePermissions(current => ({
      ...current,
      shell: {
        ...current.shell,
        allowedCommands: nextAllowedCommands
      }
    }));
  };
  const enableAllPermissions = () => {
    updatePermissions(current => ({
      ...current,
      executionProfile: 'trusted_automation',
      policy: {
        ...createDefaultPolicyConfig('trusted_automation'),
        environmentScope: 'workspace'
      },
      fileSystem: {
        ...current.fileSystem,
        read: true,
        write: true
      },
      network: {
        ...current.network,
        enabled: true
      },
      shell: {
        ...current.shell,
        enabled: true,
        allowedCommands: shellCommands
      }
    }));
    setIsShellCommandsExpanded(true);
  };

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
          <label>{t('config.agentDocs')}</label>
          <div className="agent-doc-tabs" role="tablist" aria-label={t('config.agentDocs')}>
            {docTabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeDocTab === tab.id}
                aria-controls={`agent-doc-panel-${tab.id}`}
                className={`agent-doc-tab ${activeDocTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveDocTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <textarea
            id={`agent-doc-panel-${activeDocTab}`}
            className="form-control"
            value={activeDocValue}
            onChange={e => {
              const value = e.target.value;
              if (activeDocTab === 'kairopilot') {
                setEditingAgent({ ...editingAgent, systemPrompt: value });
                return;
              }
              if (activeDocTab === 'identity') {
                setEditingAgent({ ...editingAgent, identityPrompt: value });
                return;
              }
              if (activeDocTab === 'user') {
                setEditingAgent({ ...editingAgent, userPrompt: value });
                return;
              }
              setEditingAgent({ ...editingAgent, soulPrompt: value });
            }}
            rows={10}
            placeholder={
              activeDocTab === 'kairopilot'
                ? t('config.placeholder.kairopilotPrompt')
                : activeDocTab === 'identity'
                  ? t('config.placeholder.identityPrompt')
                  : activeDocTab === 'user'
                    ? t('config.placeholder.userPrompt')
                    : t('config.placeholder.soulPrompt')
            }
          />
          <div className="form-help">
            {activeDocTab === 'kairopilot'
              ? t('config.kairopilotPromptHelp')
              : activeDocTab === 'identity'
                ? t('config.identityPromptHelp')
                : activeDocTab === 'user'
                  ? t('config.userPromptHelp')
                  : t('config.soulPromptHelp')}
          </div>
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

        <div className="permission-overview-card">
          <div className="permission-overview-content">
            <div className="permission-overview-title-row">
              <div className="permission-overview-title">{t('config.permissionOverview')}</div>
              <span className="shell-status-badge enabled">
                {t('config.permissionSummary', { enabled: enabledCapabilityCount, total: 4 })}
              </span>
            </div>
            <div className="form-help permission-overview-help">
              {t('config.permissionOverviewHelp')}
            </div>
            <div className="permission-overview-note">
              <IconShield size={16} /> {t('config.permissionsDefaultClosedHelp')}
            </div>
          </div>
          <div className="permission-overview-actions">
            <button type="button" className="btn btn-primary" onClick={enableAllPermissions}>
              {t('config.enableAllPermissions')}
            </button>
          </div>
        </div>

        <div className="permission-category-panel">
          <div className="permission-category-header">
            <div>
              <div className="permission-category-title">{t('config.permissionBoundaryTitle')}</div>
              <div className="form-help permission-category-help">{t('config.permissionBoundaryHelp')}</div>
            </div>
          </div>
          <div className="permission-settings-grid">
            <div className="shell-command-panel">
              <div className="shell-command-panel-header">
                <span>{t('config.executionProfile')}</span>
              </div>
              <div className="form-help shell-command-help">
                {t('config.executionProfileHelp')}
              </div>
              <Select
                value={permissions.executionProfile}
                onChange={(executionProfile) => updatePermissions(current => ({
                  ...applyExecutionProfileConstraints({
                    ...current,
                    executionProfile: executionProfile as AgentPermissionConfig['executionProfile'],
                    policy: createDefaultPolicyConfig(executionProfile as AgentPermissionConfig['executionProfile'])
                  })
                }))}
                options={executionProfileOptions}
                placeholder={t('config.executionProfile')}
              />
            </div>

            <div className="shell-command-panel">
              <div className="shell-command-panel-header">
                <span>{t('config.approvalPolicy')}</span>
              </div>
              <div className="form-help shell-command-help">
                {t('config.approvalPolicyHelp')}
              </div>
              <Select
                value={permissions.policy.approvalMode}
                onChange={(approvalMode) => updatePermissions(current => ({
                  ...current,
                  policy: {
                    ...current.policy,
                    approvalMode: approvalMode as AgentPermissionConfig['policy']['approvalMode']
                  }
                }))}
                options={approvalModeOptions}
                placeholder={t('config.approvalPolicy')}
              />
            </div>

            <div className="shell-command-panel">
              <div className="shell-command-panel-header">
                <span>{t('config.environmentScope')}</span>
              </div>
              <div className="form-help shell-command-help">
                {t('config.environmentScopeHelp')}
              </div>
              <Select
                value={permissions.policy.environmentScope}
                onChange={(environmentScope) => updatePermissions(current => ({
                  ...current,
                  policy: {
                    ...current.policy,
                    environmentScope: environmentScope as AgentPermissionConfig['policy']['environmentScope']
                  }
                }))}
                options={environmentScopeOptions}
                placeholder={t('config.environmentScope')}
              />
            </div>

            <div className="shell-command-panel">
              <div className="shell-command-panel-header">
                <span>{t('config.dataClass')}</span>
              </div>
              <div className="form-help shell-command-help">
                {t('config.dataClassHelp')}
              </div>
              <Select
                value={permissions.policy.dataClass}
                onChange={(dataClass) => updatePermissions(current => ({
                  ...current,
                  policy: {
                    ...current.policy,
                    dataClass: dataClass as AgentPermissionConfig['policy']['dataClass']
                  }
                }))}
                options={dataClassOptions}
                placeholder={t('config.dataClass')}
              />
            </div>
          </div>

          <div className="shell-access-card permission-inline-card">
            <label className="form-checkbox shell-access-toggle">
              <input
                type="checkbox"
                checked={permissions.policy.redactSensitiveOutput}
                onChange={e => updatePermissions(current => ({
                  ...current,
                  policy: {
                    ...current.policy,
                    redactSensitiveOutput: e.target.checked
                  }
                }))}
              />
              <div>
                <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <IconShield size={16} /> {t('config.redactSensitiveOutput')}
                </div>
                <div className="form-help" style={{ marginTop: '0.25rem', marginBottom: 0 }}>
                  {t('config.redactSensitiveOutputHelp')}
                </div>
              </div>
            </label>
            <div className="shell-access-actions">
              <span className={`shell-status-badge ${permissions.policy.redactSensitiveOutput ? 'enabled' : 'disabled'}`}>
                {permissions.policy.redactSensitiveOutput ? t('config.shellEnabled') : t('config.shellDisabled')}
              </span>
            </div>
          </div>
        </div>

        <div className="permission-category-panel">
          <div className="permission-category-header">
            <div>
              <div className="permission-category-title">{t('config.permissionCapabilitiesTitle')}</div>
              <div className="form-help permission-category-help">{t('config.permissionCapabilitiesHelp')}</div>
            </div>
          </div>
          <div className="permission-card-grid">
            <div className="shell-access-card">
              <label className="form-checkbox shell-access-toggle">
                <input
                  type="checkbox"
                  checked={permissions.fileSystem.read}
                  disabled={fileReadLocked}
                  onChange={e => updatePermissions(current => ({
                    ...current,
                    fileSystem: {
                      ...current.fileSystem,
                      read: e.target.checked
                    }
                  }))}
                />
                <div>
                  <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <IconFolder size={16} /> {t('config.allowFileRead')}
                  </div>
                  <div className="form-help" style={{ marginTop: '0.25rem', marginBottom: 0 }}>
                    {t('config.allowFileReadHelp')}
                  </div>
                </div>
              </label>
              <div className="shell-access-actions">
                <span className={`shell-status-badge ${permissions.fileSystem.read ? 'enabled' : 'disabled'}`}>
                  {permissions.fileSystem.read ? t('config.shellEnabled') : t('config.shellDisabled')}
                </span>
              </div>
            </div>

            <div className="shell-access-card">
              <label className="form-checkbox shell-access-toggle">
                <input
                  type="checkbox"
                  checked={permissions.fileSystem.write}
                  disabled={fileWriteLocked}
                  onChange={e => updatePermissions(current => ({
                    ...current,
                    fileSystem: {
                      ...current.fileSystem,
                      write: e.target.checked
                    }
                  }))}
                />
                <div>
                  <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <IconFolder size={16} /> {t('config.allowFileWrite')}
                  </div>
                  <div className="form-help" style={{ marginTop: '0.25rem', marginBottom: 0 }}>
                    {t('config.allowFileWriteHelp')}
                  </div>
                </div>
              </label>
              <div className="shell-access-actions">
                <span className={`shell-status-badge ${permissions.fileSystem.write ? 'enabled' : 'disabled'}`}>
                  {permissions.fileSystem.write ? t('config.shellEnabled') : t('config.shellDisabled')}
                </span>
              </div>
            </div>

            <div className="shell-access-card">
              <label className="form-checkbox shell-access-toggle">
                <input
                  type="checkbox"
                  checked={permissions.network.enabled}
                  disabled={networkLocked}
                  onChange={e => updatePermissions(current => ({
                    ...current,
                    network: {
                      ...current.network,
                      enabled: e.target.checked
                    }
                  }))}
                />
                <div>
                  <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <IconShield size={16} /> {t('config.allowNetwork')}
                  </div>
                  <div className="form-help" style={{ marginTop: '0.25rem', marginBottom: 0 }}>
                    {t('config.allowNetworkHelp')}
                  </div>
                </div>
              </label>
              <div className="shell-access-actions">
                <span className={`shell-status-badge ${permissions.network.enabled ? 'enabled' : 'disabled'}`}>
                  {permissions.network.enabled ? t('config.shellEnabled') : t('config.shellDisabled')}
                </span>
              </div>
            </div>

            <div className="shell-access-card">
              <label className="form-checkbox shell-access-toggle">
                <input
                  type="checkbox"
                  checked={permissions.shell.enabled}
                  disabled={shellLocked}
                  onChange={e => updatePermissions(current => ({
                    ...current,
                    shell: {
                      ...current.shell,
                      enabled: e.target.checked,
                      allowedCommands: e.target.checked ? current.shell.allowedCommands : []
                    }
                  }))}
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
              <div className="shell-access-actions">
                <span className={`shell-status-badge ${permissions.shell.enabled ? 'enabled' : 'disabled'}`}>
                  {permissions.shell.enabled ? t('config.shellEnabled') : t('config.shellDisabled')}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary shell-expand-btn"
                  onClick={() => setIsShellCommandsExpanded(prev => !prev)}
                >
                  {isShellCommandsExpanded ? t('config.collapseCommands') : t('config.expandCommands')}
                </button>
              </div>
            </div>
          </div>

          {isShellCommandsExpanded && (
            <div className="shell-command-panel permission-command-panel">
              <div className="permission-category-header">
                <div>
                  <div className="permission-category-title">{t('config.permissionCommandsTitle')}</div>
                  <div className="form-help permission-category-help">{t('config.permissionCommandsHelp')}</div>
                </div>
              </div>
              <div className="shell-command-panel-header">
                <span>{t('config.allowedCommandsTitle')}</span>
                <span className="shell-command-count">{t('config.selectedCommandsCount', { count: effectiveSelectedCommands.size })}</span>
              </div>
              <div className="form-help shell-command-help">
                {t('config.allowedCommandsHelp')}
              </div>
              <div className="shell-command-grid">
                {shellCommands.map(command => {
                  const checked = effectiveSelectedCommands.has(command);
                  return (
                    <label
                      key={command}
                      className={`shell-command-item ${checked ? 'selected' : ''} ${permissions.shell.enabled ? '' : 'disabled'}`.trim()}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!permissions.shell.enabled}
                        onChange={e => toggleCommand(command, e.target.checked)}
                      />
                      <div className="shell-command-content">
                        <div className="shell-command-name">{command}</div>
                        <div className="shell-command-description">
                          {SHELL_COMMAND_DESCRIPTIONS[command]?.[commandDescriptionLocale] || t('config.allowedCommandUnknown')}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
              {effectiveSelectedCommands.size === 0 && (
                <div className="form-help shell-command-help">
                  {t('config.noCommandsSelectedHelp')}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="permission-category-panel">
          <div className="permission-category-header">
            <div>
              <div className="permission-category-title">{t('config.permissionScopeTitle')}</div>
              <div className="form-help permission-category-help">{t('config.permissionScopeHelp')}</div>
            </div>
          </div>
          <div className="permission-settings-grid">
            <div className="shell-command-panel">
              <div className="shell-command-panel-header">
                <span>{t('config.allowedPaths')}</span>
              </div>
              <div className="form-help shell-command-help">
                {t('config.allowedPathsHelp')}
              </div>
              <textarea
                className="form-control permission-textarea"
                value={allowedPathsValue}
                onChange={e => updatePermissions(current => ({
                  ...current,
                  fileSystem: {
                    ...current.fileSystem,
                    allowedPaths: parseListInput(e.target.value)
                  }
                }))}
                rows={5}
                placeholder={t('config.placeholder.allowedPaths')}
              />
            </div>

            <div className="shell-command-panel">
              <div className="shell-command-panel-header">
                <span>{t('config.allowedDomains')}</span>
              </div>
              <div className="form-help shell-command-help">
                {t('config.allowedDomainsHelp')}
              </div>
              <textarea
                className="form-control permission-textarea"
                value={allowedDomainsValue}
                onChange={e => updatePermissions(current => ({
                  ...current,
                  network: {
                    ...current.network,
                    allowedDomains: parseListInput(e.target.value)
                  }
                }))}
                rows={5}
                placeholder={t('config.placeholder.allowedDomains')}
              />
              {permissions.network.enabled && permissions.network.allowedDomains.length === 0 && (
                <div className="form-help shell-command-help">
                  {t('config.noDomainsSelectedHelp')}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="form-actions">
          <button className="btn btn-secondary" onClick={onCancel}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={onSave}>{t('common.save')}</button>
        </div>
      </div>
    </>
  );
});
