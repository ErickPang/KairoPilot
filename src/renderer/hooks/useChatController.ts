import type { ContextReference } from '../../shared/contracts';
import { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { AppConfirmationOptions, ChatAttachment, SessionContextState, SessionContextUpdate, SessionSummary } from '../types';
import { I18nContextValue } from '../components/layout/I18nContext';
import { KAIRO_EVENT, KAIRO_INVOKE } from '../../shared/ipc';
import type { RuntimeUpdateEvent } from '../types';
import { createErrorNotice, getErrorMessage, logRendererError, withActionableErrorHint } from './errorUtils';
import { applyRuntimeUpdateToSessionContext, isRuntimeUpdateForSession, isRunUnsettled } from './runtimeEventUtils';

interface UseChatControllerOptions {
  beforeNavigate?: () => Promise<void>;
  getSessionContext: () => SessionContextState;
  loadActiveSession: () => Promise<void>;
  loadRunState: (sessionId?: string | null) => Promise<void>;
  loadSessions: () => Promise<void>;
  requestConfirmation: (request: AppConfirmationOptions) => Promise<boolean>;
  sessionContext: SessionContextState;
  setSessions: Dispatch<SetStateAction<SessionSummary[]>>;
  t: I18nContextValue['t'];
  updateSessionContext: (patch: SessionContextUpdate) => void;
}

export function useChatController(options: UseChatControllerOptions) {
  const {
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
  } = options;
  const [input, setInputState] = useState('');
  const [isRequestPending, setIsRequestPending] = useState(false);
  const requestPendingRef = useRef(false);
  const draftsRef = useRef(new Map<string, string>());
  const getDraftKey = useCallback(() => {
    const context = getSessionContext();
    return `${context.activeAgentId || ''}:${context.activeSessionId || ''}`;
  }, [getSessionContext]);
  const setInput = useCallback((value: SetStateAction<string>) => {
    const key = getDraftKey();
    const next = typeof value === 'function' ? value(draftsRef.current.get(key) || '') : value;
    draftsRef.current.set(key, next);
    setInputState(next);
  }, [getDraftKey]);
  useEffect(() => {
    setInputState(draftsRef.current.get(getDraftKey()) || '');
  }, [getDraftKey, sessionContext.activeAgentId, sessionContext.activeSessionId]);
  const beginRequest = useCallback(() => {
    if (requestPendingRef.current) return false;
    requestPendingRef.current = true;
    setIsRequestPending(true);
    return true;
  }, []);
  const finishRequest = useCallback(() => {
    requestPendingRef.current = false;
    setIsRequestPending(false);
  }, []);
  const navigationPendingRef=useRef(false);
  const canNavigate = useCallback(() => !navigationPendingRef.current, []);
  const [loading, setLoading] = useState(false);
  const activeSessionIdRef = useRef<string | null>(sessionContext.activeSessionId);
  useEffect(()=>{setLoading(sessionContext.latestRun?.status==='running');},[sessionContext.activeSessionId,sessionContext.latestRun?.status]);
  const runStateRefreshTimerRef = useRef<number | null>(null);
  const selectionVersionRef = useRef(0);

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
      if (update.type === 'session-title-updated') {
        setSessions(previous => previous.map(session => session.id === update.sessionId ? { ...session, title: update.title } : session));
        return;
      }
      if (update.type === 'queue-dispatched') {
        if (update.sessionId === getSessionContext().activeSessionId) {
          updateSessionContext({ latestRun: null });
          setLoading(true);
          scheduleRunStateRefresh('immediate');
        }
        void loadSessions();
        return;
      }
      if (!isRuntimeUpdateForSession(getSessionContext(), update)) {
        if (['assistant-response', 'run-failed', 'run-cancelled', 'approval-required', 'run-paused'].includes(update.type)) void loadSessions();
        return;
      }
      updateSessionContext(current => applyRuntimeUpdateToSessionContext(current, update));
      scheduleRunStateRefresh();
      if (update.type === 'assistant-response') {
        void loadSessions();
        setLoading(false);
        scheduleRunStateRefresh('immediate');
        return;
      }

      if (update.type === 'approval-required') {
        setLoading(false);
        scheduleRunStateRefresh();
        return;
      }

      if (update.type === 'run-paused' || update.type === 'run-cancelled' || update.type === 'run-failed') {
        void loadSessions();
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
  }, [getSessionContext, loadSessions, scheduleRunStateRefresh, setSessions, updateSessionContext]);

  useEffect(() => {
    if (sessionContext.latestRun?.status !== 'running' || !sessionContext.activeSessionId) return;
    const sessionId = sessionContext.activeSessionId;
    const timer = window.setInterval(() => { void loadRunState(sessionId); }, 1000);
    return () => window.clearInterval(timer);
  }, [loadRunState, sessionContext.activeSessionId, sessionContext.latestRun?.status]);

  const handleCreateSession = useCallback(async (projectId?: string) => {
    if (!canNavigate()) return;
    navigationPendingRef.current=true;
    const version = ++selectionVersionRef.current;
    try {
      await beforeNavigate?.();
      clearChatError(); setLoading(false);
      const newSession = await window.kairo.invoke(KAIRO_INVOKE.chatCreateSession, projectId ? { projectId } : undefined);
      if (version !== selectionVersionRef.current) return;
      setSessions((prev) => [newSession, ...prev]);
      activeSessionIdRef.current = newSession.id;
      updateSessionContext({ activeSessionId: newSession.id, latestRun: null, confirmationRequest: null, appNotice: null });
    } catch (error) {
      logRendererError('Failed to create session', error);
      reportChatError(t('app.error.createSession', { error: getErrorMessage(error) }), 'create_session');
    } finally { navigationPendingRef.current=false; }
  }, [beforeNavigate, canNavigate, clearChatError, reportChatError, setSessions, t, updateSessionContext]);

  const handleSelectSession = useCallback(async (sessionId: string) => {
    if (!canNavigate()) return;
    navigationPendingRef.current=true;
    const version = ++selectionVersionRef.current;
    const agentId = getSessionContext().activeAgentId;
    const isCurrent = () => version === selectionVersionRef.current && agentId === getSessionContext().activeAgentId;
    try {
      await beforeNavigate?.();
      clearChatError(); setLoading(false);
      const result = await window.kairo.invoke(KAIRO_INVOKE.chatSetActiveSession, sessionId);
      if (!result.success) {
        throw new Error(result.error || 'Failed to switch session');
      }

      if (!isCurrent()) return;
      activeSessionIdRef.current = sessionId;
      updateSessionContext({ activeSessionId: sessionId, latestRun: null, confirmationRequest: null });

      await loadRunState(sessionId);
      if (isCurrent() && getSessionContext().latestRun?.status === 'running') setLoading(true);
      await loadSessions();
    } catch (error) {
      logRendererError('Failed to switch session', error);
      reportChatError(t('app.error.selectSession', { error: getErrorMessage(error) }), 'select_session');
    } finally { navigationPendingRef.current=false; }
  }, [beforeNavigate, canNavigate, getSessionContext, clearChatError, loadRunState, loadSessions, reportChatError, t, updateSessionContext]);

  const handleDeleteSession = useCallback(async (e: React.MouseEvent, sessionId: string) => {
    if (!canNavigate()) return;
    e.stopPropagation();
    const confirmed = await requestConfirmation({
      title: t('common.confirm'),
      message: t('app.deleteChatConfirm'),
      confirmLabel: t('common.delete'),
      variant: 'danger'
    });

    if (!confirmed || !canNavigate()) {
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
  }, [canNavigate, clearChatError, loadActiveSession, loadSessions, reportChatError, requestConfirmation, t]);

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

  const handleConfirm = useCallback(async (scope: import('../../shared/contracts').ApprovalDecisionScope = 'once') => {
    const confirmationRequest = sessionContext.confirmationRequest;
    if (!confirmationRequest) {
      return;
    }

    if (!beginRequest()) return;
    try {
      clearChatError();
      updateSessionContext({ confirmationRequest: null });
      const result = await window.kairo.invoke(KAIRO_INVOKE.agentConfirmResponse, {
        id: confirmationRequest.id,
        approved: true,
        scope
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to confirm approval');
      }
      await loadRunState(confirmationRequest.sessionId || sessionContext.activeSessionId);
      await loadSessions();
    } catch (error) {
      updateSessionContext((current) => current.confirmationRequest || current.latestRun?.id !== confirmationRequest.runId
        ? {}
        : { confirmationRequest });
      logRendererError('Failed to confirm approval', error);
      reportChatError(t('app.error.confirmRequest', { error: getErrorMessage(error) }), 'confirm_request');
    } finally {
      finishRequest();
    }
  }, [beginRequest, finishRequest, clearChatError, loadRunState, loadSessions, reportChatError, sessionContext.activeSessionId, sessionContext.confirmationRequest, t, updateSessionContext]);

  const handleDeny = useCallback(async () => {
    const confirmationRequest = sessionContext.confirmationRequest;
    if (!confirmationRequest) {
      return;
    }

    if (!beginRequest()) return;
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
      updateSessionContext((current) => current.confirmationRequest || current.latestRun?.id !== confirmationRequest.runId
        ? {}
        : { confirmationRequest });
      logRendererError('Failed to deny approval', error);
      reportChatError(t('app.error.denyRequest', { error: getErrorMessage(error) }), 'deny_request');
    } finally {
      finishRequest();
    }
  }, [beginRequest, finishRequest, clearChatError, loadRunState, loadSessions, reportChatError, sessionContext.activeSessionId, sessionContext.confirmationRequest, t, updateSessionContext]);

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
      return true;
    } catch (error) {
      logRendererError('Failed to cancel run', error);
      reportChatError(t('app.error.cancelRun', { error: getErrorMessage(error) }), 'cancel_run');
      return false;
    }
  }, [clearChatError, loadRunState, loadSessions, reportChatError, sessionContext.activeSessionId, sessionContext.latestRun?.id, t, updateSessionContext]);

  const handleSend = useCallback(async (attachments: ChatAttachment[] = [], references: ContextReference[] = [], draftRevision?: number) => {
    if (requestPendingRef.current || isRunUnsettled(getSessionContext().latestRun)) return;
    if (!input.trim() && attachments.length === 0 && references.length === 0) {
      return;
    }

    const pendingInput = input.trim() || (references.length ? 'Please review the referenced context.' : 'Please review the attached file(s).');

    if (!beginRequest()) return;
    let wasAccepted = false;
    let sendingSessionId=sessionContext.activeSessionId;
    try {
      clearChatError();
      let targetSessionId = sessionContext.activeSessionId;

      if (!targetSessionId) {
        const newSession = await window.kairo.invoke(KAIRO_INVOKE.chatCreateSession);
        targetSessionId = newSession.id;
        setSessions((prev) => [newSession, ...prev.filter((session) => session.id !== newSession.id)]);
        updateSessionContext({
          activeSessionId: newSession.id,
          latestRun: null,
          confirmationRequest: null,
          appNotice: null
        });
      }

      sendingSessionId=targetSessionId;
      activeSessionIdRef.current = targetSessionId;
      updateSessionContext({latestRun:null,confirmationRequest:null});
      setInput('');
      setLoading(true);

      const result = await window.kairo.invoke(KAIRO_INVOKE.agentChat, {
        sessionId: targetSessionId,
        content: pendingInput,
        referenceIds: references.map((item) => item.id),
        draftRevision,
        attachments
      }) as { success: boolean; error?: string };
      wasAccepted = Boolean((result as { runId?: string }).runId);
      if (!result.success) {
        throw new Error(result.error || 'Failed to send message');
      }

      await loadRunState(activeSessionIdRef.current);
      await loadSessions();
      return true;
    } catch (error) {
      logRendererError('Failed to send message', error);
      if (activeSessionIdRef.current===sendingSessionId) reportChatError(t('app.error.sendMessage', { error: getErrorMessage(error) }), 'send_message');
      if (!wasAccepted) { if(activeSessionIdRef.current===sendingSessionId)setInput(draft=>draft||pendingInput);else draftsRef.current.set(`workbench:${sendingSessionId}`,pendingInput); }
      return wasAccepted;
    } finally {
      finishRequest();
      if(activeSessionIdRef.current===sendingSessionId)setLoading(false);
    }
  }, [beginRequest, finishRequest, getSessionContext, setInput, clearChatError, input, loadRunState, loadSessions, reportChatError, sessionContext.activeSessionId, setSessions, t, updateSessionContext]);

  return {
    handleCancelRun,
    handleConfirm,
    handleCreateSession,
    handleDeleteSession,
    handleDeny,
    handleSelectSession,
    handleSend,
    handleUpdateSessionTitle,
    input,
    isRequestPending,
    loading,
    setInput
  };
}
