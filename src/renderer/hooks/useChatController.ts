import { Dispatch, RefObject, SetStateAction, useCallback, useEffect, useState } from 'react';
import { ConfirmationRequest, Message, SessionContextState, SessionSummary } from '../types';
import { I18nContextValue } from '../components/layout/I18nContext';
import { KAIRO_EVENT, KAIRO_INVOKE } from '../../shared/ipc';

interface UseChatControllerOptions {
  agentCount: number;
  loadActiveSession: () => Promise<void>;
  loadRunState: (sessionId?: string | null) => Promise<void>;
  loadSessions: () => Promise<void>;
  messages: Message[];
  messagesEndRef: RefObject<HTMLDivElement>;
  sessionContext: SessionContextState;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setSessions: Dispatch<SetStateAction<SessionSummary[]>>;
  t: I18nContextValue['t'];
  updateSessionContext: (patch: Partial<SessionContextState>) => void;
}

export function useChatController(options: UseChatControllerOptions) {
  const {
    agentCount,
    loadActiveSession,
    loadRunState,
    loadSessions,
    messages,
    messagesEndRef,
    sessionContext,
    setMessages,
    setSessions,
    t,
    updateSessionContext
  } = options;
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const removeTrailingThinking = (items: Message[]) => {
      if (items[items.length - 1]?.role === 'thinking') {
        return items.slice(0, -1);
      }
      return items;
    };

    const removeListener = window.kairo.on(KAIRO_EVENT.agentUpdate, (update) => {
      const shouldRefreshRunState = typeof update.runId === 'string' && !!sessionContext.activeSessionId;
      if (update.type === 'thinking') {
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.role === 'thinking') {
            return [...prev.slice(0, -1), { role: 'thinking', content: update.content || '' }];
          }
          return [...prev, { role: 'thinking', content: update.content || '' }];
        });
        if (shouldRefreshRunState) {
          void loadRunState(sessionContext.activeSessionId);
        }
        return;
      }

      if (update.type === 'tool-call') {
        setMessages((prev) => [...removeTrailingThinking(prev), {
          role: 'tool',
          content: t('app.toolCall', { tool: update.tool || 'unknown' }),
          details: update.args
        }]);
        if (shouldRefreshRunState) {
          void loadRunState(sessionContext.activeSessionId);
        }
        return;
      }

      if (update.type === 'tool-result') {
        setMessages((prev) => [...removeTrailingThinking(prev), {
          role: 'tool',
          content: t('app.toolResult', { tool: update.tool || 'unknown' }),
          details: (update.result as Record<string, unknown>) || {}
        }]);
        if (shouldRefreshRunState) {
          void loadRunState(sessionContext.activeSessionId);
        }
        return;
      }

      if (update.type === 'tool-error') {
        setMessages((prev) => [...removeTrailingThinking(prev), {
          role: 'tool',
          content: t('app.toolError', { tool: update.tool || 'unknown' }),
          details: { error: update.error }
        }]);
        if (shouldRefreshRunState) {
          void loadRunState(sessionContext.activeSessionId);
        }
        return;
      }

      if (update.type === 'assistant-response') {
        setMessages((prev) => [...removeTrailingThinking(prev), {
          role: 'assistant',
          content: String(update.content || '')
        }]);
        if (shouldRefreshRunState) {
          void loadRunState(sessionContext.activeSessionId);
        }
        return;
      }

      if (update.type === 'approval-required') {
        if (shouldRefreshRunState) {
          void loadRunState(sessionContext.activeSessionId);
        }
        return;
      }

      if (update.type === 'run-paused' || update.type === 'run-cancelled') {
        setLoading(false);
        if (shouldRefreshRunState) {
          void loadRunState(sessionContext.activeSessionId);
        }
      }
    });

    return () => removeListener();
  }, [loadRunState, sessionContext.activeSessionId, setMessages, t]);

  useEffect(() => {
    const removeListener = window.kairo.on(KAIRO_EVENT.agentAskConfirmation, (request: ConfirmationRequest) => {
      updateSessionContext({ confirmationRequest: request });
      void loadRunState(request.sessionId || sessionContext.activeSessionId);
    });

    return () => removeListener();
  }, [loadRunState, sessionContext.activeSessionId, setMessages, setSessions, updateSessionContext]);

  const handleCreateSession = useCallback(async () => {
    try {
      const newSession = await window.kairo.invoke(KAIRO_INVOKE.chatCreateSession);
      setSessions((prev) => [newSession, ...prev]);
      updateSessionContext({ activeSessionId: newSession.id, latestContextSummary: null, latestRun: null, activeRunSteps: [], confirmationRequest: null });
      setMessages([]);
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  }, [setMessages, setSessions, updateSessionContext]);

  const handleSelectSession = useCallback(async (sessionId: string) => {
    try {
      const result = await window.kairo.invoke(KAIRO_INVOKE.chatSetActiveSession, sessionId);
      if (!result.success) {
        throw new Error(result.error || 'Failed to switch session');
      }

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
      console.error('Failed to switch session:', error);
    }
  }, [loadRunState, loadSessions, setMessages, updateSessionContext]);

  const handleDeleteSession = useCallback(async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (!confirm(t('app.deleteChatConfirm'))) {
      return;
    }

    try {
      await window.kairo.invoke(KAIRO_INVOKE.chatDeleteSession, sessionId);
      await loadSessions();
      await loadActiveSession();
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  }, [loadActiveSession, loadSessions, t]);

  const handleUpdateSessionTitle = useCallback(async (sessionId: string, title: string) => {
    try {
      await window.kairo.invoke(KAIRO_INVOKE.chatUpdateSessionTitle, { sessionId, title });
      setSessions((prev) => prev.map((session) => session.id === sessionId ? { ...session, title } : session));
    } catch (error) {
      console.error('Failed to update session title:', error);
    }
  }, [setSessions]);

  const handleConfirm = useCallback(async () => {
    if (!sessionContext.confirmationRequest) {
      return;
    }

    await window.kairo.invoke(KAIRO_INVOKE.agentConfirmResponse, {
      id: sessionContext.confirmationRequest.id,
      approved: true
    });
      updateSessionContext({ confirmationRequest: null });
    await loadRunState(sessionContext.confirmationRequest.sessionId || sessionContext.activeSessionId);
    await loadSessions();
  }, [loadRunState, loadSessions, sessionContext.activeSessionId, sessionContext.confirmationRequest, updateSessionContext]);

  const handleDeny = useCallback(async () => {
    if (!sessionContext.confirmationRequest) {
      return;
    }

    await window.kairo.invoke(KAIRO_INVOKE.agentConfirmResponse, {
      id: sessionContext.confirmationRequest.id,
      approved: false
    });
      updateSessionContext({ confirmationRequest: null });
    await loadRunState(sessionContext.confirmationRequest.sessionId || sessionContext.activeSessionId);
    await loadSessions();
  }, [loadRunState, loadSessions, sessionContext.activeSessionId, sessionContext.confirmationRequest, updateSessionContext]);

  const handleClear = useCallback(async () => {
    try {
      await window.kairo.invoke(KAIRO_INVOKE.chatClearAllSessions);
      setMessages([]);
      await loadSessions();
      updateSessionContext({ activeSessionId: null, latestContextSummary: null, latestRun: null, activeRunSteps: [], confirmationRequest: null });
    } catch (error) {
      console.error('Failed to clear history:', error);
    }
  }, [loadSessions, setMessages, updateSessionContext]);

  const handlePauseRun = useCallback(async () => {
    const runId = sessionContext.latestRun?.id;
    if (!runId) {
      return;
    }

    try {
      const result = await window.kairo.invoke(KAIRO_INVOKE.agentPauseRun, { runId });
      if (!result.success) {
        throw new Error(result.error || 'Failed to pause run');
      }
      setLoading(false);
      await loadRunState(sessionContext.activeSessionId);
      await loadSessions();
    } catch (error) {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `Error: ${(error as Error).message}`
      }]);
    }
  }, [loadRunState, loadSessions, sessionContext.activeSessionId, sessionContext.latestRun?.id, setMessages]);

  const handleResumeRun = useCallback(async () => {
    const runId = sessionContext.latestRun?.id;
    if (!runId) {
      return;
    }

    try {
      setLoading(true);
      const result = await window.kairo.invoke(KAIRO_INVOKE.agentResumeRun, { runId });
      if (!result.success) {
        throw new Error(result.error || 'Failed to resume run');
      }
      await loadRunState(sessionContext.activeSessionId);
      await loadSessions();
    } catch (error) {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `Error: ${(error as Error).message}`
      }]);
    } finally {
      setLoading(false);
    }
  }, [loadRunState, loadSessions, sessionContext.activeSessionId, sessionContext.latestRun?.id, setMessages]);

  const handleCancelRun = useCallback(async () => {
    const runId = sessionContext.latestRun?.id;
    if (!runId) {
      return;
    }

    try {
      const result = await window.kairo.invoke(KAIRO_INVOKE.agentCancelRun, { runId });
      if (!result.success) {
        throw new Error(result.error || 'Failed to cancel run');
      }
      setLoading(false);
      updateSessionContext({ confirmationRequest: null });
      await loadRunState(sessionContext.activeSessionId);
      await loadSessions();
    } catch (error) {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `Error: ${(error as Error).message}`
      }]);
    }
  }, [loadRunState, loadSessions, sessionContext.activeSessionId, sessionContext.latestRun?.id, setMessages, updateSessionContext]);

  const handleRetryStep = useCallback(async (stepId: string) => {
    const runId = sessionContext.latestRun?.id;
    if (!runId || !stepId) {
      return;
    }

    try {
      setLoading(true);
      const result = await window.kairo.invoke(KAIRO_INVOKE.agentRetryStep, { runId, stepId });
      if (!result.success) {
        throw new Error(result.error || 'Failed to retry step');
      }
      await loadRunState(sessionContext.activeSessionId);
      await loadSessions();
    } catch (error) {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `Error: ${(error as Error).message}`
      }]);
    } finally {
      setLoading(false);
    }
  }, [loadRunState, loadSessions, sessionContext.activeSessionId, sessionContext.latestRun?.id, setMessages]);

  const handleSend = useCallback(async () => {
    if (!input.trim()) {
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

    if (!sessionContext.activeSessionId) {
      const newSession = await window.kairo.invoke(KAIRO_INVOKE.chatCreateSession, input.substring(0, 30));
      setSessions((prev) => [newSession, ...prev]);
      updateSessionContext({ activeSessionId: newSession.id });
    }

    const userMessage: Message = { role: 'user', content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const result = await window.kairo.invoke(KAIRO_INVOKE.agentChat, input);
      if (result.error) {
        setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${result.error}` }]);
      } else if (result.status === 'completed' && result.content && messages[messages.length - 1]?.content !== result.content) {
        setMessages((prev) => [...prev, { role: 'assistant', content: result.content }]);
      }

      await loadRunState(sessionContext.activeSessionId);
      await loadSessions();
    } catch (error) {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `Error: ${(error as Error).message}`
      }]);
    } finally {
      setLoading(false);
    }
  }, [agentCount, input, loadRunState, loadSessions, messages, sessionContext.activeAgentId, sessionContext.activeSessionId, setMessages, setSessions, t, updateSessionContext]);

  return {
    handleCancelRun,
    handleClear,
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
    loading,
    messages,
    messagesEndRef,
    setInput
  };
}
