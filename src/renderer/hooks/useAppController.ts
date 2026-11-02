import { archiveTaskWithFeedback } from './taskActions';
import { KAIRO_INVOKE } from '../../shared/ipc';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppConfirmationOptions, AppNotice } from '../types';
import { useTranslation } from './useTranslation';
import { useSessionContextState } from './useSessionContextState';
import { useChatController } from './useChatController';
import { useConfigController } from './useConfigController';
import { useSessionData } from './useSessionData';
import { createErrorNotice } from './errorUtils';
import { isRunUnsettled } from './runtimeEventUtils';

export function useAppController(beforeNavigate?: () => Promise<void>) {
  const [activeTab, setActiveTab] = useState<'chat' | 'plugins' | 'skills' | 'settings' | 'dashboard'>('chat');
  const [activeConfigSection, setActiveConfigSection] = useState<string>('general');
  const [actionConfirmation, setActionConfirmation] = useState<AppConfirmationOptions | null>(null);
  const { t } = useTranslation();
  const { sessionContext, getSessionContext, updateSessionContext } = useSessionContextState();
  const actionConfirmationResolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const reportAppNotice = useCallback((notice: AppNotice) => {
    updateSessionContext({ appNotice: notice });
  }, [updateSessionContext]);

  const reportAppError = useCallback((message: string, source: string) => {
    updateSessionContext({ appNotice: createErrorNotice(message, source) });
  }, [updateSessionContext]);

  const clearAppNotice = useCallback(() => {
    updateSessionContext({ appNotice: null });
  }, [updateSessionContext]);

  const handleLoadActiveSessionError = useCallback((message: string) => {
    reportAppError(message, 'load_active_session');
  }, [reportAppError]);

  const handleLoadRunStateError = useCallback((message: string) => {
    reportAppError(message, 'load_run_state');
  }, [reportAppError]);

  const handleLoadSessionsError = useCallback((message: string) => {
    reportAppError(message, 'load_sessions');
  }, [reportAppError]);

  const requestConfirmation = useCallback((request: AppConfirmationOptions) => {
    if (actionConfirmationResolverRef.current) {
      actionConfirmationResolverRef.current(false);
    }

    setActionConfirmation({
      cancelLabel: t('common.cancel'),
      confirmLabel: t('common.confirm'),
      variant: 'default',
      ...request
    });

    return new Promise<boolean>((resolve) => {
      actionConfirmationResolverRef.current = resolve;
    });
  }, [t]);

  const resolveActionConfirmation = useCallback((confirmed: boolean) => {
    const resolve = actionConfirmationResolverRef.current;
    actionConfirmationResolverRef.current = null;
    setActionConfirmation(null);
    resolve?.(confirmed);
  }, []);

  const { loadActiveSession, loadRunState, loadSessions, sessions, setSessions } = useSessionData(
    updateSessionContext,
    {
      getSessionContext,
      onLoadActiveSessionError: handleLoadActiveSessionError,
      onLoadRunStateError: handleLoadRunStateError,
      onLoadSessionsError: handleLoadSessionsError,
      t
    }
  );
  const {
    activeAgentName,
    agents,
    availableModels,
    describeProvider,
    fetchModels,
    handleDeleteModel,
    handleSaveModel,
    workbench,
    handleSaveWorkbench,
    refreshWorkbenchConfig,
    initializing,
    models
  } = useConfigController({
    sessionContext,
    requestConfirmation,
    t,
    updateSessionContext,
    loadActiveSession,
    loadSessions
  });
  const {
    handleCancelRun,
    handleConfirm,
    handleCreateSession,
    handleDeleteSession,
    handleDeny,
    handleSelectSession,
    handleSend,
    handleUpdateSessionTitle,
    input,
    loading: chatLoading,
    isRequestPending,
    setInput
  } = useChatController({
    beforeNavigate,
    getSessionContext,
    loadActiveSession,
    loadRunState,
    loadSessions,
    requestConfirmation,
    sessionContext,
    setSessions,
    t,
    updateSessionContext
  });

  const handleArchiveTask = async (sessionId: string, archived: boolean) => {
    if (isRequestPending || isRunUnsettled(getSessionContext().latestRun)) return false;
    const success = await archiveTaskWithFeedback({
      saveDraft: async () => { await beforeNavigate?.(); },
      archive: async () => { await window.kairo.invoke(KAIRO_INVOKE.chatArchiveTask, { sessionId, archived }); },
      refresh: () => loadSessions({ throwOnError: true }),
      reportError: (error) => reportAppError(String(error), 'archive_task')
    });
    if (success) updateSessionContext((current) => current.appNotice?.source === 'archive_task' ? { appNotice: null } : {});
    return success;
  };
  const activeSummary = sessions.find((session) => session.id === sessionContext.activeSessionId);
  const activityVersion = activeSummary?.activityVersion || 0;
  const readVersion = activeSummary?.readVersion || 0;
  useEffect(() => {
    const agentId = sessionContext.activeAgentId;
    const sessionId = sessionContext.activeSessionId;
    if (!sessionId || activeTab !== 'chat' || activityVersion <= readVersion) return;
    const markRead = () => {
      if (document.visibilityState !== 'visible') return;
      void window.kairo.invoke(KAIRO_INVOKE.chatReadTask, { sessionId, version: activityVersion }).then(() => {
        if (getSessionContext().activeAgentId !== agentId) return;
        setSessions((items) => items.map((session) => session.id === sessionId ? { ...session, readVersion: Math.max(session.readVersion || 0, activityVersion) } : session));
      }).catch((error: unknown) => reportAppError(String(error), 'read_task'));
    };
    markRead();
    document.addEventListener('visibilitychange', markRead);
    return () => document.removeEventListener('visibilitychange', markRead);
  }, [sessionContext.activeAgentId, sessionContext.activeSessionId, activeTab, activityVersion, readVersion, getSessionContext, reportAppError, setSessions]);

  const refreshTasks=useCallback(async()=>{await loadSessions();await loadActiveSession();},[loadSessions,loadActiveSession]);

  return {
    activeAgentName,
    activeConfigSection,
    activeTab,
    agents,
    actionConfirmation,
    availableModels,
    confirmationRequest: sessionContext.confirmationRequest,
    reportAppError,
    reportAppNotice,
    describeProvider,
    fetchModels,
    handleArchiveTask,
    handleCancelRun,
    handleConfirm,
    handleCreateSession,
    handleDeleteModel,
    handleDeleteSession,
    handleDeny,
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
    loading: chatLoading,
    isRequestPending,
    models,
    clearAppNotice,
    sessionContext,
    sessions,
    setActiveConfigSection,
    setActiveTab,
    setInput,
    requestConfirmation,
    resolveActionConfirmation
  };
}
