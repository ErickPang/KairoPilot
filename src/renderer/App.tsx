import {TaskTitleMenu} from './components/TaskTitleMenu';
import {useTransientScrollbars} from './hooks/useTransientScrollbars';
import './styles/ui-unification.css';
import { useQuitDraftProtection } from './hooks/useQuitDraftProtection';
import type { TaskFilter } from './components/Sidebar';
import { lazy, Suspense, startTransition, useCallback, useEffect, useRef, useState } from 'react';
import './App.css'
import './components/Workbench.css'
const ConfigPanel = lazy(() => import('./components/ConfigPanel').then((module) => ({ default: module.ConfigPanel })));
import { WorkbenchNavigation } from './components/WorkbenchNavigation';
import { SettingsSidebar } from './components/SettingsSidebar';
import { ChatInterface } from './components/ChatInterface';
import { ActionConfirmationModal } from './components/ActionConfirmationModal';
import { AppNoticeBanner } from './components/AppNoticeBanner';
const PluginStorePanel = lazy(() => import('./components/PluginStorePanel').then((module) => ({ default: module.PluginStorePanel })));
const SkillStorePanel = lazy(() => import('./components/SkillStorePanel').then((module) => ({ default: module.SkillStorePanel })));
const Dashboard = lazy(() => import('./components/Dashboard').then((module) => ({ default: module.Dashboard })));
import { WorkbenchFiles } from './components/WorkbenchFiles';
import { useWorkbenchViewState, useWorkbenchPreference } from './hooks/useWorkbenchViewState';
import type { ComposerHandle } from './hooks/useTaskDraft';
import type { ContextReference } from '../shared/contracts';
import { RunDetailsPanel } from './components/RunDetailsPanel';
import { TaskResultsPanel } from './components/TaskResultsPanel';
import { isRunUnsettled } from './hooks/runtimeEventUtils';
import { Menu, FolderOpen, ListTree, FileCheck2, X } from 'lucide-react';
import { useAppController } from './hooks/useAppController';
import { useTranslation } from './hooks/useTranslation';
import { KAIRO_EVENT, KAIRO_INVOKE } from '../shared/ipc';
import type { AppearanceTheme } from './types';
import { applyAppearanceTheme, subscribeAppearanceThemeChanged, subscribeSystemThemeChanged } from './theme';

function App() {
  useTransientScrollbars();
  const { t } = useTranslation();
  const composerRef = useRef<ComposerHandle | null>(null);
  const isQuitPending = useQuitDraftProtection(composerRef);
  const beforeNavigate = useCallback(async () => { await composerRef.current?.flush(); }, []);
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
    handleArchiveTask,
    handleCancelRun,
    handleConfirm,
    handleCreateSession,
    handleDeleteModel,
    handleDeleteSession,
    handleDeny,
    handlePauseRun,
    handleResumeRun,
    handleRetryStep,
    handleSaveModel,
    handleSelectSession,
    handleSend,
    workbench,
    handleSaveWorkbench,
    refreshWorkbenchConfig,
    refreshTasks,
    initializing,
    handleUpdateSessionTitle,
    input,
    loading,
    isRequestPending,
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
  } = useAppController(beforeNavigate);
  const [taskFilter, setTaskFilter] = useWorkbenchPreference<TaskFilter>('kairo.workbench.filter', 'open', (value): value is TaskFilter => typeof value === 'string' && ['open', 'archived', 'unread', 'all'].includes(value));
  const [sessionSearch, setSessionSearch] = useWorkbenchPreference('kairo.workbench.search', '', (value): value is string => typeof value === 'string' && value.length < 1000);
  const [focusSessionSearchToken, setFocusSessionSearchToken] = useState(0);
  const [focusChatInputToken, setFocusChatInputToken] = useState(0);

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useWorkbenchPreference('kairo.workbench.collapsed', false, (value): value is boolean => typeof value === 'boolean');
  const [isProjectPending, setIsProjectPending] = useState(false);

  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [previewWidth, setPreviewWidth] = useWorkbenchPreference('kairo.workbench.previewWidth', 348, (value): value is number => typeof value === 'number' && value >= 280 && value <= 1200);
  const [resizeTarget, setResizeTarget] = useState<'preview' | null>(null);
  const [clipboardHint, setClipboardHint] = useState<{ kind: string; preview: string; length: number } | null>(null);
  const workspaceAreaRef = useRef<HTMLDivElement | null>(null);
  const chatWorkspaceRef = useRef<HTMLDivElement | null>(null);

  const activeAgentId = sessionContext.activeAgentId;
  const activeSessionId = sessionContext.activeSessionId;
  const taskKey = `${activeAgentId}:${activeSessionId}`;
  const currentTaskKey = useRef(taskKey);
  currentTaskKey.current = taskKey;
  const { taskViews, view, updateView } = useWorkbenchViewState(taskKey);
  const auxiliaryPanel = view.auxiliaryPanel || null;
  const previewFilePath = view.previewFilePath || null;
  const setAuxiliaryPanel = useCallback((value: React.SetStateAction<typeof auxiliaryPanel>) => updateView({ auxiliaryPanel: typeof value === 'function' ? value(auxiliaryPanel) : value }), [auxiliaryPanel, updateView]);
  const setPreviewFilePath = useCallback((value: string | null) => updateView({ previewFilePath: value || undefined }), [updateView]);
  const handleArchiveTaskWithFilter = async (id: string, archived: boolean) => {
    const success = await handleArchiveTask(id, archived);
    if (success && currentTaskKey.current === taskKey && id === activeSessionId) setTaskFilter(archived ? 'archived' : 'open');
    return success;
  };
  const handleReference = useCallback(async (path: string) => {
    if (!composerRef.current) return;
    try { await composerRef.current.addReference(path); } catch (error) { reportAppError(String(error), 'context_reference'); }
  }, [reportAppError]);
  const handleViewReference = useCallback((reference: ContextReference) => {
    updateView(reference.kind === 'directory' ? { directoryPath: reference.path, auxiliaryPanel: 'files', previewFilePath: undefined } : { previewFilePath: reference.path, auxiliaryPanel: 'files' });
    setPreviewExpanded(false);
  }, [updateView]);

  const baseExecutionConfig = agents[0] || null;
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const activeAgent = baseExecutionConfig && {...baseExecutionConfig,model:activeSession?.executionSettings?.model ?? baseExecutionConfig.model,permissions:activeSession?.executionSettings?.permissions || baseExecutionConfig.permissions};
  const updateTaskConfig=async(value:{model?:string;executionProfile?:import('../shared/contracts').ExecutionProfile;rootPath?:string})=> {
    if(!activeSessionId)return;
    try {await window.kairo.invoke(KAIRO_INVOKE.chatUpdateTaskSettings,{sessionId:activeSessionId,...value});await refreshTasks();}catch(reason){reportAppError(String(reason),'task_settings');}
  };
  const workspacePath = activeSession?.executionRoot || sessionContext.latestRun?.executionContext?.executionRoot || activeAgent?.workspace || '';
  const hasPreview = auxiliaryPanel !== null;
  const navigationLocked = isQuitPending || initializing || isProjectPending;
  const openConfig = (section: string) => {
    if (navigationLocked) return;
    setActiveConfigSection(section);
    handleTabChange('settings');
  };
  const isMacLike = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform);
  const shortcutModifierLabel = isMacLike ? '⌘' : 'Ctrl';
  const navigationItems = [
    { id: 'chat', label: t('nav.chat') },
    { id: 'dashboard', label: t('nav.dashboard') },
    { id: 'plugins', label: t('nav.plugins') },
    { id: 'skills', label: t('nav.skills') },
    { id: 'settings', label: t('nav.settings') }
  ] as const;
  const [appearanceTheme, setAppearanceTheme] = useState<AppearanceTheme>('system');
  const [mountedTabs, setMountedTabs] = useState<Record<typeof navigationItems[number]['id'], boolean>>({
    chat: true,
    dashboard: false,
    plugins: false,
    skills: false,
    settings: false
  });

  const handleTabChange = useCallback((tab: typeof navigationItems[number]['id']) => {
    if (tab === 'settings' && navigationLocked) return;
    setMountedTabs((current) => (
      current[tab]
        ? current
        : { ...current, [tab]: true }
    ));
    startTransition(() => {
      setActiveTab(tab);
    });
  }, [navigationLocked, setActiveTab]);

  const isSettingsPage = activeTab !== 'chat';
  const wasSettingsPage = useRef(false);
  useEffect(() => {
    if (wasSettingsPage.current && !isSettingsPage) {
      const entry = document.querySelector<HTMLButtonElement>('.workbench-navigation:not(.is-collapsed) .workbench-settings-entry')
        || document.querySelector<HTMLButtonElement>('[data-toggle-sidebar]');
      entry?.focus();
    }
    wasSettingsPage.current = isSettingsPage;
  }, [isSettingsPage]);
  const handleSettingsSection = (section: string) => {
    if(section==='rules'){void refreshWorkbenchConfig().then(()=>openConfig('rules')).catch(error=>reportAppError(String(error),'rules_load'));}
    else if (['general', 'model', 'execution'].includes(section)) openConfig(section);
    else if (section === 'plugins' || section === 'skills' || section === 'dashboard') handleTabChange(section);
  };

  const clearPreviewPanel = useCallback(() => {
    setPreviewFilePath(null);
    setPreviewExpanded(false);
  }, [setPreviewFilePath]);

  const handleCreateSessionWithReset = useCallback(async () => {
    if (navigationLocked) return;
    clearPreviewPanel();
    setTaskFilter('open');
    setSessionSearch('');
    await handleCreateSession(activeSession?.projectId);
  }, [navigationLocked, clearPreviewPanel, handleCreateSession, activeSession?.projectId, setTaskFilter, setSessionSearch]);

  const handleCreateProjectSession = useCallback(async (projectId?: string) => {
    if (navigationLocked) return;
    clearPreviewPanel(); setTaskFilter('open'); setSessionSearch('');
    await handleCreateSession(projectId);
  }, [navigationLocked, clearPreviewPanel, setTaskFilter, setSessionSearch, handleCreateSession]);

  const handleSelectProject = useCallback(async (projectId?: string) => {
    if (navigationLocked) return;
    setTaskFilter('open');
    setSessionSearch('');
    const task = (await window.kairo.invoke(KAIRO_INVOKE.chatQuerySessions, { projectId: projectId || null, filter: 'open', limit: 1 })).items[0];
    if (task) await handleSelectSession(task.id);
    else await handleCreateSession(projectId);
  }, [navigationLocked, handleSelectSession, handleCreateSession, setTaskFilter, setSessionSearch]);
  const handleProjectError = useCallback((message: string) => reportAppError(message, 'project'), [reportAppError]);

  const handleSelectSessionWithReset = useCallback(async (sessionId: string) => {
    if (navigationLocked) return;
    await handleSelectSession(sessionId);
  }, [navigationLocked, handleSelectSession]);

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
      if (document.querySelector('.modal-overlay')) return;
      const modifierPressed = event.metaKey || event.ctrlKey;
      if (!modifierPressed || event.altKey) {
        return;
      }

      const key = event.key.toLowerCase();
      const tabByShortcut = ['chat', 'dashboard', 'plugins', 'skills', 'settings'] as const;

      if (/^[1-5]$/.test(key)) {
        event.preventDefault();
        handleTabChange(tabByShortcut[Number(key) - 1]);
        return;
      }

      if (key === 'n' && !event.shiftKey) {
        event.preventDefault();
        handleTabChange('chat');
        void handleCreateSessionWithReset();
        return;
      }

      if (key === 'k' && !event.shiftKey) {
        event.preventDefault();
        setIsSidebarCollapsed(false);
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
  }, [handleCreateSessionWithReset, handleTabChange, setIsSidebarCollapsed]);

  useEffect(() => {
    if (!resizeTarget) {
      return;
    }

    const handlePointerMove = (event: MouseEvent) => {
      if (resizeTarget === 'preview' && chatWorkspaceRef.current) {
        const bounds = chatWorkspaceRef.current.getBoundingClientRect();
        const nextWidth = Math.max(280, Math.min(720, bounds.right - event.clientX));
        setPreviewWidth(nextWidth);
      }
    };

    const handlePointerUp = () => {
      setResizeTarget(null);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
    };
  }, [resizeTarget, setPreviewWidth]);

  useEffect(() => { setPreviewExpanded(false); }, [taskKey]);

  useEffect(() => {
    const removeClipboard = window.kairo.on(KAIRO_EVENT.clipboardHint, (rawHint) => {
      const hint = rawHint as { kind: string; preview: string; length: number };
      setClipboardHint(hint);
      // Auto-dismiss after 8 seconds
      setTimeout(() => setClipboardHint(null), 8000);
    });
    const removeTrayChat = window.kairo.on(KAIRO_EVENT.trayNewChat, () => {
      handleTabChange('chat' as typeof navigationItems[number]['id']);
      void handleCreateSessionWithReset();
    });
    return () => {
      removeClipboard();
      removeTrayChat();
    };
  }, [handleCreateSessionWithReset, handleTabChange, setIsSidebarCollapsed]);

  const handleSendClipboardHint = useCallback(() => {
    if (!clipboardHint) return;
    setInput((prev) => {
      const separator = prev ? '\n' : '';
      return prev + separator + clipboardHint.preview;
    });
    setClipboardHint(null);
    handleTabChange('chat' as typeof navigationItems[number]['id']);
  }, [clipboardHint, setInput, handleTabChange]);

  return (
    <div className={`app-container workbench-app ${isSidebarCollapsed && !isSettingsPage ? 'is-navigation-collapsed' : ''} ${isSettingsPage ? 'is-settings-page' : ''}`} data-platform={navigator.platform.startsWith('Mac') ? 'mac' : 'other'} data-quitting={isQuitPending} aria-busy={isQuitPending}>

      <header className="workbench-topbar" data-global-titlebar aria-label={t('ui.windowBar')}>
        {!isSettingsPage&&<>
          <div className="workbench-sidebar-toolbar"><button type="button" data-toggle-sidebar className="workbench-icon-button" title={t('workbench.toggleSidebar')} aria-label={t('workbench.toggleSidebar')} aria-expanded={!isSidebarCollapsed} onClick={()=>setIsSidebarCollapsed(value=>!value)}><Menu size={18}/></button></div>
          <div className="workbench-main-toolbar">
          <div className="workbench-task-header"><FolderOpen size={18} aria-hidden="true"/><h1 title={workspacePath?`${activeSession?.title||t('workbench.newTask')} · ${workspacePath}`:activeSession?.title}>{activeSession?.title||t('workbench.newTask')}</h1>
          {activeSession&&<TaskTitleMenu key={activeSession.id} task={activeSession} disabled={navigationLocked} onRename={async title=>{const result=await window.kairo.invoke(KAIRO_INVOKE.chatUpdateSessionTitle,{sessionId:activeSession.id,title});if(!result.success)throw new Error(result.error);await refreshTasks();}} onArchive={()=>void handleArchiveTaskWithFilter(activeSession.id,!activeSession.archivedAt)} onDelete={event=>void handleDeleteSession(event,activeSession.id)}/>}</div>
          <span className="titlebar-spacer"/>
          <div className="workbench-panel-buttons">{([
            ['files',FolderOpen,t('workbench.files')],['results',FileCheck2,t('workbench.results')],['details',ListTree,t('workbench.details')]
          ] as const).map(([id,Icon,label])=><button key={id} type="button" aria-label={label} aria-controls={auxiliaryPanel===id?'workbench-auxiliary-panel':undefined} aria-expanded={auxiliaryPanel===id} aria-pressed={auxiliaryPanel===id} onClick={()=>{setPreviewExpanded(false);setAuxiliaryPanel(current=>current===id?null:id);}} title={label}><Icon size={18}/></button>)}</div>
          </div>
        </>}
      </header>
      <WorkbenchNavigation collapsed={isSidebarCollapsed} hidden={isSettingsPage} agentId={activeAgentId} name={activeAgentName} disabled={navigationLocked} onTabChange={handleTabChange} onOpenSettings={() => openConfig(activeConfigSection)}
        sidebar={{ projectNavigation: { agentId: activeAgentId, projectId: activeSession?.projectId, disabled: navigationLocked, onSelect: handleSelectProject, onCreateSession: handleCreateProjectSession, onError: handleProjectError, onBusyChange: setIsProjectPending }, refresh: sessions, filter: taskFilter, setFilter: setTaskFilter, searchText: sessionSearch, setSearchText: setSessionSearch, handleArchiveTask: handleArchiveTaskWithFilter, activeSessionId, disabled: navigationLocked, handleCreateSession: handleCreateSessionWithReset, handleSelectSession: handleSelectSessionWithReset, handleDeleteSession, handleUpdateSessionTitle, focusSearchToken: focusSessionSearchToken, shortcutModifierLabel }}/>
      {isSettingsPage && <SettingsSidebar activeSection={activeTab === 'settings' ? activeConfigSection : activeTab} disabled={navigationLocked} agentName={activeAgentName} onSelectSection={handleSettingsSection} onBack={() => handleTabChange('chat')} />}
      <div className="workbench-content"><Suspense fallback={<div className="workbench-loading" role="status">{t('workbench.loadingPanel')}</div>}>
        {document.documentElement.dataset.workbenchPreview && <div className="workbench-preview-banner">{t('workbench.preview')}</div>}

        <div className="workspace-area" ref={workspaceAreaRef}>
        {mountedTabs.chat && <main className={`workbench-task ${activeTab !== 'chat' ? 'app-panel-hidden' : ''}`}>
          {activeSession?.archivedAt && <div className="workbench-archive-banner"><span>{t('workbench.archivedHint')}</span><button type="button" disabled={navigationLocked} onClick={() => void handleArchiveTaskWithFilter(activeSession.id, false)}>{t('workbench.restoreTask')}</button></div>}
          <div ref={chatWorkspaceRef} className={`chat-workspace ${hasPreview ? 'has-preview' : ''} ${hasPreview && previewExpanded ? 'is-preview-expanded' : ''}`} style={{ ['--preview-width' as string]: `${previewWidth}px` }}>
            <div className="chat-workspace-main">
              <ChatInterface run={sessionContext.latestRun} runSteps={sessionContext.activeRunSteps} onCancelRun={handleCancelRun} onViewRun={()=>{setPreviewExpanded(false);setAuxiliaryPanel('details');}} approvalRequest={confirmationRequest?.sessionId===activeSessionId?confirmationRequest:null} onApprove={handleConfirm} onDeny={handleDeny} approvalBusy={isRequestPending} canQueue={!navigationLocked&&!isQuitPending&&!activeSession?.archivedAt} taskSettings={activeSession?.executionSettings} onTaskChanged={refreshTasks} isQuitPending={isQuitPending} composerRef={composerRef} onViewReference={handleViewReference} key={`${activeAgentId}:${activeSessionId}`} messages={messages} input={input} setInput={setInput} loading={loading} handleSend={handleSend} messagesEndRef={messagesEndRef} models={models} activeAgent={activeAgent} activeModelId={activeAgent?.model || null} activeAgentName={activeAgentName} focusInputToken={focusChatInputToken} onModelChange={model=>void updateTaskConfig({model})} onOpenModelSettings={() => openConfig('model')} onProfileChange={executionProfile=>void updateTaskConfig({executionProfile})} sessionId={activeSessionId} isRunBlocked={navigationLocked || isRequestPending || sessions.some(item=>['running','waiting_approval','paused'].includes(item.runStatus||'')) || isRunUnsettled(sessionContext.latestRun) || Boolean(activeSession?.archivedAt)} viewKey={taskKey} viewCache={taskViews.current} />
            </div>
            {hasPreview && !previewExpanded && <div className="workspace-divider workspace-divider-preview" onMouseDown={() => setResizeTarget('preview')} />}
            {hasPreview && <aside id="workbench-auxiliary-panel" className="workbench-auxiliary">
              <div className="workbench-auxiliary-header"><strong>{t(`workbench.${auxiliaryPanel}`)}</strong><button type="button" className="workbench-icon-button" onClick={() => setAuxiliaryPanel(null)} aria-label={t('common.close')}><X size={16} /></button></div>
              {auxiliaryPanel === 'files' && <WorkbenchFiles taskKey={taskKey} workspacePath={workspacePath} directoryPath={view.directoryPath} filePath={previewFilePath} expanded={previewExpanded} disabled={navigationLocked || !activeSessionId || Boolean(activeSession?.archivedAt)} onSelectFile={(path) => { setPreviewFilePath(path); setPreviewExpanded(false); }} onReference={handleReference} onRoot={() => updateView({ directoryPath: undefined })} onToggleExpand={() => setPreviewExpanded((value) => !value)}/>}
              {auxiliaryPanel === 'results' && <TaskResultsPanel onReference={navigationLocked||activeSession?.archivedAt?undefined:async(path)=>{await handleReference(path);setFocusChatInputToken(token=>token+1);}} acceptance={sessionContext.latestRun?.executionContext?.acceptance} key={taskKey} run={sessionContext.latestRun} sessionId={activeSessionId} onOpenFile={(path) => { setPreviewFilePath(path); setAuxiliaryPanel('files'); }} />}
              {auxiliaryPanel === 'details' && <RunDetailsPanel onPause={handlePauseRun} onResume={handleResumeRun} context={sessionContext} onRetryStep={handleRetryStep} disabled={isRequestPending} />}
            </aside>}
          </div>
        </main>}

        {mountedTabs.settings && (
          <>
            <div className={`workspace-panel-main ${activeTab === 'settings' ? '' : 'app-panel-hidden'}`}>
              <div className="main-content main-content-settings">
                <ConfigPanel
                  models={models}
                  workbench={workbench}
                  onSaveWorkbench={handleSaveWorkbench}
                  onClearNotice={clearAppNotice}
                  onReportNotice={reportAppNotice}
                  onSaveModel={handleSaveModel}
                  onDeleteModel={handleDeleteModel}
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


      </div>

      </Suspense></div>

      {clipboardHint && (
        <div className="clipboard-hint-toast">
          <div className="clipboard-hint-content">
            <span className="clipboard-hint-label">
              {clipboardHint.kind === 'code' ? '检测到代码' : clipboardHint.kind === 'error' ? '检测到错误信息' : '检测到链接'}
            </span>
            <span className="clipboard-hint-preview">{clipboardHint.preview}</span>
          </div>
          <div className="clipboard-hint-actions">
            <button type="button" className="btn btn-sm" onClick={handleSendClipboardHint}>
              发送给 Agent
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setClipboardHint(null)}>
              忽略
            </button>
          </div>
        </div>
      )}

      {sessionContext.appNotice && (
        <AppNoticeBanner notice={sessionContext.appNotice} onDismiss={clearAppNotice} />
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
