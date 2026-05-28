import { Dispatch, RefObject, SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { AppConfirmationOptions, ChatAttachment, Message, SessionContextState, SessionContextUpdate, SessionSummary } from '../types';
import { I18nContextValue } from '../components/layout/I18nContext';
import { KAIRO_EVENT, KAIRO_INVOKE } from '../../shared/ipc';
import type { RuntimeUpdateEvent } from '../types';
import { createErrorNotice, getErrorMessage, logRendererError, withActionableErrorHint } from './errorUtils';
import {
  appendRuntimeMessage,
  applyRuntimeUpdateToSessionContext,
  upsertAssistantStreamMessage,
  upsertThinkingMessage
} from './runtimeEventUtils';

interface UseChatControllerOptions {
  agentCount: number;
  loadActiveSession: () => Promise<void>;
  loadRunState: (sessionId?: string | null) => Promise<void>;
  loadSessions: () => Promise<void>;
  messages: Message[];
  messagesEndRef: RefObject<HTMLDivElement>;
  requestConfirmation: (request: AppConfirmationOptions) => Promise<boolean>;
  sessionContext: SessionContextState;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setSessions: Dispatch<SetStateAction<SessionSummary[]>>;
  t: I18nContextValue['t'];
  updateSessionContext: (patch: SessionContextUpdate) => void;
}

export function useChatController(options: UseChatControllerOptions) {
  const {
    agentCount,
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
  } = options;
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const activeSessionIdRef = useRef<string | null>(sessionContext.activeSessionId);
  const runStateRefreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    activeSessionIdRef.current = sessionContext.activeSessionId;
  }, [sessionContext.activeSessionId]);

  const reportChatError = useCallback((message: string, source: string) => {
    updateSessionContext({
      appNotice: createErrorNotice(withActionableErrorHint(message, t), source)
    });
  }, [t, updateSessionContext]);

  const clearChatError = useCallback(() => {
    updateSessionContext({ appNotice: null });
  }, [updateSessionContext]);

  const flushRunStateRefresh = useCallback(async (sessionId?: string | null) => {
    const nextSessionId = sessionId ?? activeSessionIdRef.current;
    if (runStateRefreshTimerRef.current !== null) {
      window.clearTimeout(runStateRefreshTimerRef.current);
      runStateRefreshTimerRef.current = null;
    }

    if (!nextSessionId) {
      return;
    }

    await loadRunState(nextSessionId);
  }, [loadRunState]);

  const scheduleRunStateRefresh = useCallback((mode: 'debounced' | 'immediate' = 'debounced') => {
    const nextSessionId = activeSessionIdRef.current;
    if (!nextSessionId) {
      return;
    }

    if (mode === 'immediate') {
      void flushRunStateRefresh(nextSessionId);
      return;
    }

    if (runStateRefreshTimerRef.current !== null) {
      return;
    }

    runStateRefreshTimerRef.current = window.setTimeout(() => {
      runStateRefreshTimerRef.current = null;
      void loadRunState(activeSessionIdRef.current);
    }, 250);
  }, [flushRunStateRefresh, loadRunState]);

  useEffect(() => {
    const removeListener = window.kairo.on(KAIRO_EVENT.agentUpdate, (rawUpdate) => {
      const update = rawUpdate as RuntimeUpdateEvent;
      updateSessionContext((current) => applyRuntimeUpdateToSessionContext(current, update));

      if (update.type === 'thinking') {
        setMessages((prev) => upsertThinkingMessage(prev, update.content || ''));
        scheduleRunStateRefresh();
        return;
      }

      if (update.type === 'assistant-delta') {
        setMessages((prev) => upsertAssistantStreamMessage(prev, update.content || ''));
        scheduleRunStateRefresh();
        return;
      }

      if (update.type === 'tool-call') {
        setMessages((prev) => appendRuntimeMessage(prev, {
          role: 'tool',
          content: t('app.toolCall', { tool: update.tool || 'unknown' }),
          details: update.args
        }));
        scheduleRunStateRefresh();
        return;
      }

      if (update.type === 'tool-result') {
        setMessages((prev) => appendRuntimeMessage(prev, {
          role: 'tool',
          content: t('app.toolResult', { tool: update.tool || 'unknown' }),
          details: (update.result as Record<string, unknown>) || {}
        }));
        scheduleRunStateRefresh();
        return;
      }

      if (update.type === 'tool-error') {
        setMessages((prev) => appendRuntimeMessage(prev, {
          role: 'tool',
          content: t('app.toolError', { tool: update.tool || 'unknown' }),
          details: { error: update.error }
        }));
        scheduleRunStateRefresh();
        return;
      }

      if (update.type === 'assistant-response') {
        setMessages((prev) => upsertAssistantStreamMessage(prev, String(update.content || '')));
        setLoading(false);
        scheduleRunStateRefresh('immediate');
        return;
      }

      if (update.type === 'approval-required') {
        setLoading(false);
        scheduleRunStateRefresh();
        return;
      }

      if (update.type === 'run-paused' || update.type === 'run-cancelled') {
        setLoading(false);
        scheduleRunStateRefresh('immediate');
      }
    });

    return () => {
      removeListener();
      if (runStateRefreshTimerRef.current !== null) {
        window.clearTimeout(runStateRefreshTimerRef.current);
        runStateRefreshTimerRef.current = null;
      }
    };
  }, [scheduleRunStateRefresh, setMessages, t, updateSessionContext]);

  const handleCreateSession = useCallback(async () => {
    try {
      clearChatError();
      const newSession = await window.kairo.invoke(KAIRO_INVOKE.chatCreateSession);
      setSessions((prev) => [newSession, ...prev]);
      activeSessionIdRef.current = newSession.id;
      updateSessionContext({ activeSessionId: newSession.id, latestContextSummary: null, latestRun: null, activeRunSteps: [], confirmationRequest: null, appNotice: null });
      setMessages([]);
    } catch (error) {
      logRendererError('Failed to create session', error);
      reportChatError(t('app.error.createSession', { error: getErrorMessage(error) }), 'create_session');
    }
  }, [clearChatError, reportChatError, setMessages, setSessions, t, updateSessionContext]);

  const handleSelectSession = useCallback(async (sessionId: string) => {
    try {
      clearChatError();
      const result = await window.kairo.invoke(KAIRO_INVOKE.chatSetActiveSession, sessionId);
      if (!result.success) {
        throw new Error(result.error || 'Failed to switch session');
      }

      activeSessionIdRef.current = sessionId;
      updateSessionContext({ activeSessionId: sessionId });

      const active = await window.kairo.invoke(KAIRO_INVOKE.chatGetSession, sessionId);
      if (active) {
        setMessages(active.messages);
      } else {
        setMessages([]);
      }

      await loadRunState(sessionId);
      await loadSessions();
    } catch (error) {
      logRendererError('Failed to switch session', error);
      reportChatError(t('app.error.selectSession', { error: getErrorMessage(error) }), 'select_session');
    }
  }, [clearChatError, loadRunState, loadSessions, reportChatError, setMessages, t, updateSessionContext]);

  const handleDeleteSession = useCallback(async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    const confirmed = await requestConfirmation({
      title: t('common.confirm'),
      message: t('app.deleteChatConfirm'),
      confirmLabel: t('common.delete'),
      variant: 'danger'
    });

    if (!confirmed) {
      return;
    }

    try {
      clearChatError();
      await window.kairo.invoke(KAIRO_INVOKE.chatDeleteSession, sessionId);
      await loadSessions();
      await loadActiveSession();
    } catch (error) {
      logRendererError('Failed to delete session', error);
      reportChatError(t('app.error.deleteSession', { error: getErrorMessage(error) }), 'delete_session');
    }
  }, [clearChatError, loadActiveSession, loadSessions, reportChatError, requestConfirmation, t]);

  const handleDeleteSessions = useCallback(async (sessionIds: string[]) => {
    const uniqueSessionIds = Array.from(new Set(sessionIds.filter(Boolean)));
    if (uniqueSessionIds.length === 0) {
      return false;
    }

    const confirmed = await requestConfirmation({
      title: t('common.confirm'),
      message: uniqueSessionIds.length === 1
        ? t('app.deleteChatConfirm')
        : t('app.deleteChatsConfirm', { count: uniqueSessionIds.length }),
      confirmLabel: t('common.delete'),
      variant: 'danger'
    });

    if (!confirmed) {
      return false;
    }

    try {
      clearChatError();
      await Promise.all(uniqueSessionIds.map((sessionId) => window.kairo.invoke(KAIRO_INVOKE.chatDeleteSession, sessionId)));
      await loadSessions();
      await loadActiveSession();
      return true;
    } catch (error) {
      logRendererError('Failed to delete sessions', error);
      reportChatError(t('app.error.deleteSession', { error: getErrorMessage(error) }), 'delete_session');
      return false;
    }
  }, [clearChatError, loadActiveSession, loadSessions, reportChatError, requestConfirmation, t]);

  const handleUpdateSessionTitle = useCallback(async (sessionId: string, title: string) => {
    try {
      clearChatError();
      await window.kairo.invoke(KAIRO_INVOKE.chatUpdateSessionTitle, { sessionId, title });
      setSessions((prev) => prev.map((session) => session.id === sessionId ? { ...session, title } : session));
    } catch (error) {
      logRendererError('Failed to update session title', error);
      reportChatError(t('app.error.updateSessionTitle', { error: getErrorMessage(error) }), 'update_session_title');
    }
  }, [clearChatError, reportChatError, setSessions, t]);

  const handleConfirm = useCallback(async () => {
    const confirmationRequest = sessionContext.confirmationRequest;
    if (!confirmationRequest) {
      return;
    }

    try {
      clearChatError();
      updateSessionContext({ confirmationRequest: null });
      const result = await window.kairo.invoke(KAIRO_INVOKE.agentConfirmResponse, {
        id: confirmationRequest.id,
        approved: true
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to confirm approval');
      }
      await loadRunState(confirmationRequest.sessionId || sessionContext.activeSessionId);
      await loadSessions();
    } catch (error) {
      updateSessionContext((current) => current.confirmationRequest
        ? {}
        : { confirmationRequest });
      logRendererError('Failed to confirm approval', error);
      reportChatError(t('app.error.confirmRequest', { error: getErrorMessage(error) }), 'confirm_request');
    }
  }, [clearChatError, loadRunState, loadSessions, reportChatError, sessionContext.activeSessionId, sessionContext.confirmationRequest, t, updateSessionContext]);

  const handleDeny = useCallback(async () => {
    const confirmationRequest = sessionContext.confirmationRequest;
    if (!confirmationRequest) {
      return;
    }

    try {
      clearChatError();
      updateSessionContext({ confirmationRequest: null });
      const result = await window.kairo.invoke(KAIRO_INVOKE.agentConfirmResponse, {
        id: confirmationRequest.id,
        approved: false
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to deny approval');
      }
      await loadRunState(confirmationRequest.sessionId || sessionContext.activeSessionId);
      await loadSessions();
    } catch (error) {
      updateSessionContext((current) => current.confirmationRequest
        ? {}
        : { confirmationRequest });
      logRendererError('Failed to deny approval', error);
      reportChatError(t('app.error.denyRequest', { error: getErrorMessage(error) }), 'deny_request');
    }
  }, [clearChatError, loadRunState, loadSessions, reportChatError, sessionContext.activeSessionId, sessionContext.confirmationRequest, t, updateSessionContext]);

  const handleClear = useCallback(async () => {
    const confirmed = await requestConfirmation({
      title: t('common.confirm'),
      message: t('app.clearHistoryConfirm'),
      confirmLabel: t('common.delete'),
      variant: 'danger'
    });

    if (!confirmed) {
      return;
    }

    try {
      clearChatError();
      await window.kairo.invoke(KAIRO_INVOKE.chatClearAllSessions);
      setMessages([]);
      await loadSessions();
      updateSessionContext({ activeSessionId: null, latestContextSummary: null, latestRun: null, activeRunSteps: [], confirmationRequest: null, appNotice: null });
    } catch (error) {
      logRendererError('Failed to clear history', error);
      reportChatError(t('app.error.clearHistory', { error: getErrorMessage(error) }), 'clear_history');
    }
  }, [clearChatError, loadSessions, reportChatError, requestConfirmation, setMessages, t, updateSessionContext]);

  const handlePauseRun = useCallback(async () => {
    const runId = sessionContext.latestRun?.id;
    if (!runId) {
      return;
    }

    try {
      clearChatError();
      const result = await window.kairo.invoke(KAIRO_INVOKE.agentPauseRun, { runId });
      if (!result.success) {
        throw new Error(result.error || 'Failed to pause run');
      }
      setLoading(false);
      await loadRunState(sessionContext.activeSessionId);
      await loadSessions();
    } catch (error) {
      logRendererError('Failed to pause run', error);
      reportChatError(t('app.error.pauseRun', { error: getErrorMessage(error) }), 'pause_run');
    }
  }, [clearChatError, loadRunState, loadSessions, reportChatError, sessionContext.activeSessionId, sessionContext.latestRun?.id, t]);

  const handleResumeRun = useCallback(async () => {
    const runId = sessionContext.latestRun?.id;
    if (!runId) {
      return;
    }

    try {
      clearChatError();
      setLoading(true);
      const result = await window.kairo.invoke(KAIRO_INVOKE.agentResumeRun, { runId });
      if (!result.success) {
        throw new Error(result.error || 'Failed to resume run');
      }
      await loadRunState(sessionContext.activeSessionId);
      await loadSessions();
    } catch (error) {
      logRendererError('Failed to resume run', error);
      reportChatError(t('app.error.resumeRun', { error: getErrorMessage(error) }), 'resume_run');
    } finally {
      setLoading(false);
    }
  }, [clearChatError, loadRunState, loadSessions, reportChatError, sessionContext.activeSessionId, sessionContext.latestRun?.id, t]);

  const handleCancelRun = useCallback(async () => {
    const runId = sessionContext.latestRun?.id;
    if (!runId) {
      return;
    }

    try {
      clearChatError();
      const result = await window.kairo.invoke(KAIRO_INVOKE.agentCancelRun, { runId });
      if (!result.success) {
        throw new Error(result.error || 'Failed to cancel run');
      }
      setLoading(false);
      updateSessionContext({ confirmationRequest: null });
      await loadRunState(sessionContext.activeSessionId);
      await loadSessions();
    } catch (error) {
      logRendererError('Failed to cancel run', error);
      reportChatError(t('app.error.cancelRun', { error: getErrorMessage(error) }), 'cancel_run');
    }
  }, [clearChatError, loadRunState, loadSessions, reportChatError, sessionContext.activeSessionId, sessionContext.latestRun?.id, t, updateSessionContext]);

  const handleRetryStep = useCallback(async (stepId: string) => {
    const runId = sessionContext.latestRun?.id;
    if (!runId || !stepId) {
      return;
    }

    try {
      clearChatError();
      setLoading(true);
      const result = await window.kairo.invoke(KAIRO_INVOKE.agentRetryStep, { runId, stepId });
      if (!result.success) {
        throw new Error(result.error || 'Failed to retry step');
      }
      await loadRunState(sessionContext.activeSessionId);
      await loadSessions();
    } catch (error) {
      logRendererError('Failed to retry step', error);
      reportChatError(t('app.error.retryStep', { error: getErrorMessage(error) }), 'retry_step');
    } finally {
      setLoading(false);
    }
  }, [clearChatError, loadRunState, loadSessions, reportChatError, sessionContext.activeSessionId, sessionContext.latestRun?.id, t]);

  const handleSend = useCallback(async (attachments: ChatAttachment[] = []) => {
    if (!input.trim() && attachments.length === 0) {
      return;
    }

    if (!sessionContext.activeAgentId && agentCount > 0) {
      setMessages((prev) => [...prev, { role: 'assistant', content: t('app.selectAgentWarn') }]);
      return;
    }

    if (agentCount === 0) {
      setMessages((prev) => [...prev, { role: 'assistant', content: t('app.configureAgentWarn') }]);
      return;
    }

    const pendingInput = input.trim() || 'Please review the attached file(s).';

    const userMessage: Message = { role: 'user', content: pendingInput, attachments };

    try {
      clearChatError();
      let targetSessionId = sessionContext.activeSessionId;
      let createdNewSession = false;

      if (!targetSessionId) {
        const newSession = await window.kairo.invoke(KAIRO_INVOKE.chatCreateSession, pendingInput.substring(0, 30));
        targetSessionId = newSession.id;
        createdNewSession = true;
        setSessions((prev) => [newSession, ...prev.filter((session) => session.id !== newSession.id)]);
        updateSessionContext({
          activeSessionId: newSession.id,
          latestContextSummary: null,
          latestRun: null,
          activeRunSteps: [],
          confirmationRequest: null,
          appNotice: null
        });
      }

      activeSessionIdRef.current = targetSessionId;
      setMessages((prev) => createdNewSession ? [userMessage] : [...prev, userMessage]);
      setInput('');
      setLoading(true);

      const result = await window.kairo.invoke(KAIRO_INVOKE.agentChat, {
        content: pendingInput,
        attachments
      }) as { success: boolean; error?: string };
      if (!result.success) {
        throw new Error(result.error || 'Failed to send message');
      }

      await loadRunState(activeSessionIdRef.current);
      await loadSessions();
    } catch (error) {
      logRendererError('Failed to send message', error);
      reportChatError(t('app.error.sendMessage', { error: getErrorMessage(error) }), 'send_message');
    } finally {
      setLoading(false);
    }
  }, [agentCount, clearChatError, input, loadRunState, loadSessions, reportChatError, sessionContext.activeAgentId, sessionContext.activeSessionId, setMessages, setSessions, t, updateSessionContext]);

  return {
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
    loading,
    messages,
    messagesEndRef,
    setInput
  };
}
