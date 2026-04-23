import { startTransition, useCallback, useEffect, useState } from 'react';
import './App.css'
import { ConfigPanel } from './components/ConfigPanel';
import { Sidebar } from './components/Sidebar';
import { SettingsSidebar } from './components/SettingsSidebar';
import { ChatInterface } from './components/ChatInterface';
import { ConfirmationModal } from './components/ConfirmationModal';
import { ActionConfirmationModal } from './components/ActionConfirmationModal';
import { AppNoticeBanner } from './components/AppNoticeBanner';
import AuditLogViewer from './components/AuditLogViewer';
import { PluginStorePanel } from './components/PluginStorePanel';
import { SkillStorePanel } from './components/SkillStorePanel';
import { Dashboard } from './components/Dashboard';
import { IconChat, IconShield, IconSettings, IconPlugin, IconDashboard, IconSkill } from './components/Icons';
import { useAppController } from './hooks/useAppController';
import { useTranslation } from './hooks/useTranslation';
import { KAIRO_INVOKE } from '../shared/ipc';
import type { AppearanceTheme } from './types';
import { applyAppearanceTheme, subscribeAppearanceThemeChanged, subscribeSystemThemeChanged } from './theme';

function App() {
  const { t } = useTranslation();
  const {
    activeAgentName,
    activeConfigSection,
    activeTab,
    actionConfirmation,
    agents,
    availableModels,
    clearAppNotice,
    confirmationRequest,
    describeProvider,
    fetchModels,
    handleCancelRun,
    handleClear,
    handleConfirm,
    handleCreateSession,
    handleDeleteAgent,
    handleDeleteModel,
    handleDeleteSession,
    handleDeny,
    handlePauseRun,
    handleResumeRun,
    handleRetryStep,
    handleSaveAgent,
    handleSaveModel,
    handleSelectSession,
    handleSend,
    handleSetActiveAgent,
    handleUpdateSessionTitle,
    input,
    loading,
    messages,
    messagesEndRef,
    models,
    reportAppError,
    reportAppNotice,
    requestConfirmation,
    resolveActionConfirmation,
    sessionContext,
    sessions,
    setActiveConfigSection,
    setActiveTab,
    setInput
  } = useAppController();
  const [focusSessionSearchToken, setFocusSessionSearchToken] = useState(0);
  const [focusChatInputToken, setFocusChatInputToken] = useState(0);

  const activeAgentId = sessionContext.activeAgentId;
  const activeSessionId = sessionContext.activeSessionId;
  const isMacLike = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform);
  const shortcutModifierLabel = isMacLike ? '⌘' : 'Ctrl';
  const navigationItems = [
    { id: 'chat', icon: IconChat, label: t('nav.chat'), shortcut: `${shortcutModifierLabel}+1` },
    { id: 'dashboard', icon: IconDashboard, label: t('nav.dashboard'), shortcut: `${shortcutModifierLabel}+2` },
    { id: 'plugins', icon: IconPlugin, label: t('nav.plugins'), shortcut: `${shortcutModifierLabel}+3` },
    { id: 'skills', icon: IconSkill, label: t('nav.skills'), shortcut: `${shortcutModifierLabel}+4` },
    { id: 'audit', icon: IconShield, label: t('nav.auditLogs'), shortcut: `${shortcutModifierLabel}+5` },
    { id: 'settings', icon: IconSettings, label: t('nav.settings'), shortcut: `${shortcutModifierLabel}+6` }
  ] as const;
  const primaryNavigationItems = navigationItems.slice(0, 4);
  const secondaryNavigationItems = navigationItems.slice(4);
  const [appearanceTheme, setAppearanceTheme] = useState<AppearanceTheme>('system');
  const [mountedTabs, setMountedTabs] = useState<Record<typeof navigationItems[number]['id'], boolean>>({
    chat: true,
    dashboard: false,
    plugins: false,
    skills: false,
    audit: false,
    settings: false
  });

  const handleTabChange = useCallback((tab: typeof navigationItems[number]['id']) => {
    setMountedTabs((current) => (
      current[tab]
        ? current
        : { ...current, [tab]: true }
    ));
    startTransition(() => {
      setActiveTab(tab);
    });
  }, [setActiveTab]);

  useEffect(() => {
    let cancelled = false;

    const loadAppearance = async () => {
      try {
        const appearance = await window.kairo.invoke(KAIRO_INVOKE.configGetAppearance);
        if (!cancelled && appearance?.theme) {
          setAppearanceTheme(appearance.theme);
          applyAppearanceTheme(appearance.theme);
        }
      } catch (error) {
        console.error('Failed to load appearance settings:', error);
      }
    };

    void loadAppearance();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return subscribeAppearanceThemeChanged((theme) => {
      setAppearanceTheme(theme);
      applyAppearanceTheme(theme);
    });
  }, []);

  useEffect(() => {
    if (appearanceTheme !== 'system') {
      return;
    }

    applyAppearanceTheme('system');
    return subscribeSystemThemeChanged(() => {
      applyAppearanceTheme('system');
    });
  }, [appearanceTheme]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifierPressed = event.metaKey || event.ctrlKey;
      if (!modifierPressed || event.altKey) {
        return;
      }

      const key = event.key.toLowerCase();
      const tabByShortcut = ['chat', 'dashboard', 'plugins', 'skills', 'audit', 'settings'] as const;

      if (/^[1-6]$/.test(key)) {
        event.preventDefault();
        handleTabChange(tabByShortcut[Number(key) - 1]);
        return;
      }

      if (key === 'n' && !event.shiftKey) {
        event.preventDefault();
        handleTabChange('chat');
        void handleCreateSession();
        return;
      }

      if (key === 'k' && !event.shiftKey) {
        event.preventDefault();
        handleTabChange('chat');
        setFocusSessionSearchToken((token) => token + 1);
        return;
      }

      if (key === 'l' && !event.shiftKey) {
        event.preventDefault();
        handleTabChange('chat');
        setFocusChatInputToken((token) => token + 1);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [handleCreateSession, handleTabChange]);

  return (
    <div className="app-container">
      <div className="window-drag-strip" aria-hidden="true" />
      <div className="app-gradient-orb app-gradient-orb-left" aria-hidden="true" />
      <div className="app-gradient-orb app-gradient-orb-right" aria-hidden="true" />

      <div className="nav-rail">
        <div className="nav-brand">
          <div className="nav-brand-mark">
            <img src="/icon.png" alt="" className="nav-brand-mark-image" />
          </div>
          <span className="nav-brand-name">KairoPilot</span>
        </div>

        <div className="nav-group">
          {primaryNavigationItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-icon ${isActive ? 'active' : ''}`}
                onClick={() => handleTabChange(item.id)}
                title={`${item.label} · ${item.shortcut}`}
              >
                <Icon size={20} />
                <span className="nav-icon-label">{item.label}</span>
              </button>
            );
          })}
        </div>
        
        <div className="nav-spacer" />
        
        <div className="nav-group nav-group-secondary">
          {secondaryNavigationItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-icon ${isActive ? 'active' : ''}`}
                onClick={() => handleTabChange(item.id)}
                title={`${item.label} · ${item.shortcut}`}
              >
                <Icon size={20} />
                <span className="nav-icon-label">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="workspace-area">
        {mountedTabs.chat && (
          <>
            <div className={`workspace-panel-sidebar ${activeTab === 'chat' ? '' : 'app-panel-hidden'}`}>
              <Sidebar 
                sessions={sessions} 
                activeSessionId={activeSessionId} 
                handleCreateSession={handleCreateSession} 
                handleSelectSession={handleSelectSession} 
                handleDeleteSession={handleDeleteSession}
                handleUpdateSessionTitle={handleUpdateSessionTitle}
                focusSearchToken={focusSessionSearchToken}
                shortcutModifierLabel={shortcutModifierLabel}
              />
            </div>
            <div className={`workspace-panel-main ${activeTab === 'chat' ? '' : 'app-panel-hidden'}`}>
              <ChatInterface 
                messages={messages} 
                input={input} 
                setInput={setInput} 
                loading={loading} 
                handleSend={handleSend} 
                handleClear={handleClear} 
                messagesEndRef={messagesEndRef}
                models={models}
                activeModelId={agents.find((agent) => agent.id === activeAgentId)?.model || null}
                activeAgentName={activeAgentName}
                focusInputToken={focusChatInputToken}
                onModelChange={(model: string) => {
                  const activeAgent = agents.find((agent) => agent.id === activeAgentId);
                  if (activeAgent) {
                    handleSaveAgent({ ...activeAgent, model });
                  }
                }}
              />
            </div>
          </>
        )}

        {mountedTabs.settings && (
          <>
            <div className={`workspace-panel-sidebar ${activeTab === 'settings' ? '' : 'app-panel-hidden'}`}>
              <SettingsSidebar 
                activeSection={activeConfigSection} 
                onSelectSection={setActiveConfigSection} 
              />
            </div>
            <div className={`workspace-panel-main ${activeTab === 'settings' ? '' : 'app-panel-hidden'}`}>
              <div className="main-content main-content-settings">
                <ConfigPanel 
                  models={models}
                  agents={agents}
                  activeAgentId={activeAgentId}
                  onClearNotice={clearAppNotice}
                  onReportNotice={reportAppNotice}
                  onSaveModel={handleSaveModel}
                  onDeleteModel={handleDeleteModel}
                  onSaveAgent={handleSaveAgent}
                  onDeleteAgent={handleDeleteAgent}
                  onSetActiveAgent={handleSetActiveAgent}
                  onDescribeProvider={describeProvider}
                  onFetchModels={fetchModels}
                  availableModels={availableModels}
                  activeSection={activeConfigSection}
                />
              </div>
            </div>
          </>
        )}

        {mountedTabs.dashboard && (
          <div className={`workspace-panel-main ${activeTab === 'dashboard' ? '' : 'app-panel-hidden'}`}>
            <div className="main-content">
              <Dashboard
                agents={agents}
                isActive={activeTab === 'dashboard'}
                onReportError={(message, source) => reportAppError(message, source)}
              />
            </div>
          </div>
        )}

        {mountedTabs.plugins && (
          <div className={`workspace-panel-main ${activeTab === 'plugins' ? '' : 'app-panel-hidden'}`}>
            <div className="main-content">
              <PluginStorePanel
                onClearNotice={clearAppNotice}
                onReportNotice={reportAppNotice}
                onRequestConfirmation={requestConfirmation}
              />
            </div>
          </div>
        )}

        {mountedTabs.skills && (
          <div className={`workspace-panel-main ${activeTab === 'skills' ? '' : 'app-panel-hidden'}`}>
            <div className="main-content">
              <SkillStorePanel />
            </div>
          </div>
        )}
        
        {mountedTabs.audit && (
          <div className={`workspace-panel-main ${activeTab === 'audit' ? '' : 'app-panel-hidden'}`}>
            <div className="main-content">
              <AuditLogViewer
                latestRun={sessionContext.latestRun}
                activeRunSteps={sessionContext.activeRunSteps}
                handleCancelRun={handleCancelRun}
                handlePauseRun={handlePauseRun}
                handleResumeRun={handleResumeRun}
                onReportError={(message, source) => reportAppError(message, source)}
                handleRetryStep={handleRetryStep}
              />
            </div>
          </div>
        )}
      </div>

      {sessionContext.appNotice && (
        <AppNoticeBanner notice={sessionContext.appNotice} onDismiss={clearAppNotice} />
      )}
      
      {confirmationRequest && (
        <ConfirmationModal 
          request={confirmationRequest} 
          onConfirm={handleConfirm} 
          onDeny={handleDeny} 
        />
      )}

      {actionConfirmation && (
        <ActionConfirmationModal
          request={actionConfirmation}
          onConfirm={() => resolveActionConfirmation(true)}
          onCancel={() => resolveActionConfirmation(false)}
        />
      )}
    </div>
  )
}

export default App
