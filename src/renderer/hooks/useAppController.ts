import { useCallback, useRef, useState } from 'react';
import type { AppConfirmationOptions, AppNotice } from '../types';
import { useTranslation } from './useTranslation';
import { useSessionContextState } from './useSessionContextState';
import { useChatController } from './useChatController';
import { useConfigController } from './useConfigController';
import { useSessionData } from './useSessionData';
import { createErrorNotice } from './errorUtils';

export function useAppController() {
  const [activeTab, setActiveTab] = useState<'chat' | 'plugins' | 'skills' | 'settings' | 'audit' | 'dashboard'>('chat');
  const [activeConfigSection, setActiveConfigSection] = useState<string>('general');
  const [actionConfirmation, setActionConfirmation] = useState<AppConfirmationOptions | null>(null);
  const { t } = useTranslation();
  const { sessionContext, updateSessionContext } = useSessionContextState();
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

  const { loadActiveSession, loadRunState, loadSessions, messages, messagesEndRef, sessions, setMessages, setSessions } = useSessionData(
    updateSessionContext,
    {
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
    handleDeleteAgent,
    handleDeleteModel,
    handleSaveAgent,
    handleSaveModel,
    handleSetActiveAgent: handleSetActiveAgentBase,
    models
  } = useConfigController({
    sessionContext,
    requestConfirmation,
    t,
    updateSessionContext,
    loadActiveSession,
    loadSessions
  });
  const [agentLoading, setAgentLoading] = useState(false);
  const {
    handleCancelRun,
    handleClear,
    handleConfirm,
    handleCreateSession,
    handleDeleteSession,
    handleDeleteSessions,
    handleDeny,
    handlePauseRun,
    handleResumeRun,
    handleRetryStep,
    handleSelectSession,
    handleSend,
    handleUpdateSessionTitle,
    input,
    loading: chatLoading,
    setInput
  } = useChatController({
    agentCount: agents.length,
    loadActiveSession,
    loadRunState,
    loadSessions,
    messages,
    messagesEndRef,
    requestConfirmation,
    sessionContext,
    setMessages,
    setSessions,
    t,
    updateSessionContext
  });

  const handleSetActiveAgent = async (id: string) => {
    try {
      setAgentLoading(true);
      await handleSetActiveAgentBase(id);
    } finally {
      setAgentLoading(false);
    }
  };

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
    handleCancelRun,
    handleClear,
    handleConfirm,
    handleCreateSession,
    handleDeleteAgent,
    handleDeleteModel,
    handleDeleteSession,
    handleDeleteSessions,
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
    loading: chatLoading || agentLoading,
    messages,
    messagesEndRef,
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
