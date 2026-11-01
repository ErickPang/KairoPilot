import type { ContextReference } from '../../shared/contracts';
import { Dispatch, RefObject, SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { AppConfirmationOptions, ChatAttachment, Message, SessionContextState, SessionContextUpdate, SessionSummary } from '../types';
import { I18nContextValue } from '../components/layout/I18nContext';
import { KAIRO_EVENT, KAIRO_INVOKE } from '../../shared/ipc';
import type { RuntimeUpdateEvent } from '../types';
import { createErrorNotice, getErrorMessage, logRendererError, withActionableErrorHint } from './errorUtils';
import {
  appendRuntimeMessage,
  applyRuntimeUpdateToSessionContext,
  isRuntimeUpdateForSession,
  isRunUnsettled,
  upsertAssistantStreamMessage,
  upsertThinkingMessage
} from './runtimeEventUtils';

interface UseChatControllerOptions {
  beforeNavigate?: () => Promise<void>;
  getSessionContext: () => SessionContextState;
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
    beforeNavigate,
    getSessionContext,
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
  const bufferedOwnerRef = useRef<RuntimeUpdateEvent | null>(null);
  const latestStreams=useRef(new Map<string,{assistant?:string;thinking?:string}>());
  const selectionVersionRef = useRef(0);
  const bufferedAssistantContentRef = useRef<string | null>(null);
  const bufferedThinkingContentRef = useRef<string | null>(null);
  const messageFlushTimerRef = useRef<number | null>(null);
  const contextFlushTimerRef = useRef<number | null>(null);
  const pendingProgressUpdateRef = useRef<RuntimeUpdateEvent | null>(null);

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

  const flushBufferedMessages = useCallback(() => {
    if (messageFlushTimerRef.current !== null) {
      window.clearTimeout(messageFlushTimerRef.current);
      messageFlushTimerRef.current = null;
    }

    const thinkingContent = bufferedThinkingContentRef.current;
    const assistantContent = bufferedAssistantContentRef.current;
    bufferedThinkingContentRef.current = null;
    bufferedAssistantContentRef.current = null;

    if (!bufferedOwnerRef.current || !isRuntimeUpdateForSession(getSessionContext(), bufferedOwnerRef.current)) return;

    if (thinkingContent === null && assistantContent === null) {
      return;
    }

    setMessages((prev) => {
      let next = prev;
      if (thinkingContent !== null) {
        next = upsertThinkingMessage(next, thinkingContent);
      }
      if (assistantContent !== null) {
        next = upsertAssistantStreamMessage(next, assistantContent);
      }
      return next;
    });
  }, [getSessionContext, setMessages]);

  const scheduleBufferedMessageFlush = useCallback(() => {
    if (messageFlushTimerRef.current !== null) {
      return;
    }

    messageFlushTimerRef.current = window.setTimeout(() => {
      messageFlushTimerRef.current = null;
      flushBufferedMessages();
    }, 33);
  }, [flushBufferedMessages]);

  const flushProgressContextUpdate = useCallback(() => {
    if (contextFlushTimerRef.current !== null) {
      window.clearTimeout(contextFlushTimerRef.current);
      contextFlushTimerRef.current = null;
    }

    const update = pendingProgressUpdateRef.current;
    pendingProgressUpdateRef.current = null;
    if (!update) {
      return;
    }

    updateSessionContext((current) => applyRuntimeUpdateToSessionContext(current, update));
  }, [updateSessionContext]);

  const scheduleProgressContextUpdate = useCallback((update: RuntimeUpdateEvent) => {
    pendingProgressUpdateRef.current = update;
    if (contextFlushTimerRef.current !== null) {
      return;
    }

    contextFlushTimerRef.current = window.setTimeout(() => {
      contextFlushTimerRef.current = null;
      flushProgressContextUpdate();
    }, 250);
  }, [flushProgressContextUpdate]);

  useEffect(() => {
    const removeListener = window.kairo.on(KAIRO_EVENT.agentUpdate, (rawUpdate) => {
      const update = rawUpdate as RuntimeUpdateEvent;
      if (update.type === 'session-title-updated') {
        setSessions(previous => previous.map(session => session.id === update.sessionId ? { ...session, title: update.title } : session));
        return;
      }
      if(update.type==='queue-dispatched'){
        if(update.sessionId===getSessionContext().activeSessionId){
          flushBufferedMessages();flushProgressContextUpdate();
          updateSessionContext({latestRun:null,latestContextSummary:null,activeRunSteps:[]});
          setMessages(previous=>appendRuntimeMessage(previous,{role:'user',content:update.content,attachments:update.attachments,references:update.references}));
          setLoading(true);scheduleRunStateRefresh('immediate');
        }
        void loadSessions();return;
      }
      if(update.sessionId && (update.type==='assistant-delta' || update.type==='thinking')) {
        const current=latestStreams.current.get(update.sessionId)||{};
        latestStreams.current.set(update.sessionId,{...current,...(update.type==='assistant-delta'?{assistant:update.content,thinking:undefined}:{thinking:update.content})});
        if(latestStreams.current.size>20)latestStreams.current.delete(latestStreams.current.keys().next().value!);
      }
      if (!isRuntimeUpdateForSession(getSessionContext(), update)) {
        if(['assistant-response','run-failed','run-cancelled','approval-required','run-paused'].includes(update.type))void loadSessions();
        return;
      }
      bufferedOwnerRef.current = update;

      if (update.type === 'thinking') {
        bufferedThinkingContentRef.current = update.content || '';
        scheduleBufferedMessageFlush();
        scheduleProgressContextUpdate(update);
        scheduleRunStateRefresh();
        return;
      }

      if (update.type === 'assistant-delta') {
        bufferedAssistantContentRef.current = update.content || '';
        bufferedThinkingContentRef.current = null;
        scheduleBufferedMessageFlush();
        scheduleProgressContextUpdate(update);
        scheduleRunStateRefresh();
        return;
      }

      flushBufferedMessages();
      flushProgressContextUpdate();
      updateSessionContext((current) => applyRuntimeUpdateToSessionContext(current, update));

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
        void loadSessions();
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
      if (messageFlushTimerRef.current !== null) {
        window.clearTimeout(messageFlushTimerRef.current);
        messageFlushTimerRef.current = null;
      }
      if (contextFlushTimerRef.current !== null) {
        window.clearTimeout(contextFlushTimerRef.current);
        contextFlushTimerRef.current = null;
      }
    };
  }, [getSessionContext, loadSessions, flushBufferedMessages, flushProgressContextUpdate, scheduleBufferedMessageFlush, scheduleProgressContextUpdate, scheduleRunStateRefresh, setMessages, setSessions, t, updateSessionContext]);

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
      updateSessionContext({ activeSessionId: newSession.id, latestContextSummary: null, latestRun: null, activeRunSteps: [], confirmationRequest: null, appNotice: null });
      setMessages([]);
    } catch (error) {
      logRendererError('Failed to create session', error);
      reportChatError(t('app.error.createSession', { error: getErrorMessage(error) }), 'create_session');
    } finally { navigationPendingRef.current=false; }
  }, [beforeNavigate, canNavigate, clearChatError, reportChatError, setMessages, setSessions, t, updateSessionContext]);

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
      updateSessionContext({ activeSessionId: sessionId, latestRun: null, latestContextSummary: null, activeRunSteps: [], confirmationRequest: null });
      setMessages([]);

      const active = await window.kairo.invoke(KAIRO_INVOKE.chatGetMessagePage, { sessionId, limit: 100 });
      if (!isCurrent()) return;
      if (active) {
        setMessages(active.messages);
        setSessions((items) => items.some((item) => item.id === active.session.id) ? items : [...items, active.session]);
      } else {
        setMessages([]);
      }

      await loadRunState(sessionId);
      if(isCurrent() && getSessionContext().latestRun?.status==='running') {
        const stream=latestStreams.current.get(sessionId);
        if(stream)setMessages(previous=>stream.assistant?upsertAssistantStreamMessage(previous,stream.assistant):stream.thinking?upsertThinkingMessage(previous,stream.thinking):previous);
        setLoading(true);
      }
      await loadSessions();
    } catch (error) {
      logRendererError('Failed to switch session', error);
      reportChatError(t('app.error.selectSession', { error: getErrorMessage(error) }), 'select_session');
    } finally { navigationPendingRef.current=false; }
  }, [beforeNavigate, canNavigate, getSessionContext, clearChatError, loadRunState, loadSessions, reportChatError, setMessages, setSessions, t, updateSessionContext]);

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

  const handleConfirm = useCallback(async () => {
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
        approved: true
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
      return true;
    } catch (error) {
      logRendererError('Failed to pause run', error);
      reportChatError(t('app.error.pauseRun', { error: getErrorMessage(error) }), 'pause_run');
      return false;
    }
  }, [clearChatError, loadRunState, loadSessions, reportChatError, sessionContext.activeSessionId, sessionContext.latestRun?.id, t]);

  const handleResumeRun = useCallback(async () => {
    const runId = sessionContext.latestRun?.id;
    if (!runId) {
      return;
    }

    if (!beginRequest()) return;
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
      finishRequest();
      setLoading(false);
    }
  }, [beginRequest, finishRequest, clearChatError, loadRunState, loadSessions, reportChatError, sessionContext.activeSessionId, sessionContext.latestRun?.id, t]);

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

  const handleRetryStep = useCallback(async (stepId: string) => {
    const runId = sessionContext.latestRun?.id;
    if (!runId || !stepId) {
      return;
    }

    if (!beginRequest()) return;
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
      finishRequest();
      setLoading(false);
    }
  }, [beginRequest, finishRequest, clearChatError, loadRunState, loadSessions, reportChatError, sessionContext.activeSessionId, sessionContext.latestRun?.id, t]);

  const handleSend = useCallback(async (attachments: ChatAttachment[] = [], references: ContextReference[] = [], draftRevision?: number) => {
    if (requestPendingRef.current || isRunUnsettled(getSessionContext().latestRun)) return;
    if (!input.trim() && attachments.length === 0 && references.length === 0) {
      return;
    }

    const pendingInput = input.trim() || (references.length ? 'Please review the referenced context.' : 'Please review the attached file(s).');

    const userMessage: Message = { role: 'user', content: pendingInput, attachments, references };

    if (!beginRequest()) return;
    let wasAccepted = false;
    let sendingSessionId=sessionContext.activeSessionId;
    try {
      clearChatError();
      let targetSessionId = sessionContext.activeSessionId;
      let createdNewSession = false;

      if (!targetSessionId) {
        const newSession = await window.kairo.invoke(KAIRO_INVOKE.chatCreateSession);
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

      sendingSessionId=targetSessionId;
      activeSessionIdRef.current = targetSessionId;
      updateSessionContext({latestRun:null,latestContextSummary:null,activeRunSteps:[],confirmationRequest:null});
      setMessages((prev) => createdNewSession ? [userMessage] : [...prev, userMessage]);
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
  }, [beginRequest, finishRequest, getSessionContext, setInput, clearChatError, input, loadRunState, loadSessions, reportChatError, sessionContext.activeSessionId, setMessages, setSessions, t, updateSessionContext]);

  return {
    handleCancelRun,
    handleConfirm,
    handleCreateSession,
    handleDeleteSession,
    handleDeny,
    handlePauseRun,
    handleResumeRun,
    handleRetryStep,
    handleSelectSession,
    handleSend,
    handleUpdateSessionTitle,
    input,
    isRequestPending,
    loading,
    messages,
    messagesEndRef,
    setInput
  };
}
