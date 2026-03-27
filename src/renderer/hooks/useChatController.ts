import { Dispatch, RefObject, SetStateAction, useCallback, useEffect, useState } from 'react';
import { ConfirmationRequest, Message, SessionContextState, SessionSummary } from '../types';
import { I18nContextValue } from '../components/layout/I18nContext';
import { KAIRO_EVENT, KAIRO_INVOKE } from '../../shared/ipc';

interface UseChatControllerOptions {
  agentCount: number;
  loadActiveSession: () => Promise<void>;
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
    const removeListener = window.kairo.on(KAIRO_EVENT.agentUpdate, (update) => {
      if (update.type === 'thinking') {
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.role === 'thinking') {
            return [...prev.slice(0, -1), { role: 'thinking', content: update.content || '' }];
          }
          return [...prev, { role: 'thinking', content: update.content || '' }];
        });
        return;
      }

      if (update.type === 'tool-call') {
        setMessages((prev) => [...prev, {
          role: 'tool',
          content: t('app.toolCall', { tool: update.tool || 'unknown' }),
          details: update.args
        }]);
        return;
      }

      if (update.type === 'tool-result') {
        setMessages((prev) => [...prev, {
          role: 'tool',
          content: t('app.toolResult', { tool: update.tool || 'unknown' }),
          details: (update.result as Record<string, unknown>) || {}
        }]);
        return;
      }

      if (update.type === 'tool-error') {
        setMessages((prev) => [...prev, {
          role: 'tool',
          content: t('app.toolError', { tool: update.tool || 'unknown' }),
          details: { error: update.error }
        }]);
      }
    });

    return () => removeListener();
  }, [setMessages, t]);

  useEffect(() => {
    const removeListener = window.kairo.on(KAIRO_EVENT.agentAskConfirmation, (request: ConfirmationRequest) => {
      updateSessionContext({ confirmationRequest: request });
    });

    return () => removeListener();
  }, [setMessages, setSessions, updateSessionContext]);

  const handleCreateSession = useCallback(async () => {
    try {
      const newSession = await window.kairo.invoke(KAIRO_INVOKE.chatCreateSession);
      setSessions((prev) => [newSession, ...prev]);
      updateSessionContext({ activeSessionId: newSession.id });
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

      await loadSessions();
    } catch (error) {
      console.error('Failed to switch session:', error);
    }
  }, [loadSessions, setMessages, updateSessionContext]);

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
  }, [sessionContext.confirmationRequest, updateSessionContext]);

  const handleDeny = useCallback(async () => {
    if (!sessionContext.confirmationRequest) {
      return;
    }

    await window.kairo.invoke(KAIRO_INVOKE.agentConfirmResponse, {
      id: sessionContext.confirmationRequest.id,
      approved: false
    });
    updateSessionContext({ confirmationRequest: null });
  }, [sessionContext.confirmationRequest, updateSessionContext]);

  const handleClear = useCallback(async () => {
    try {
      await window.kairo.invoke(KAIRO_INVOKE.chatClearAllSessions);
      setMessages([]);
      await loadSessions();
      updateSessionContext({ activeSessionId: null });
    } catch (error) {
      console.error('Failed to clear history:', error);
    }
  }, [loadSessions, setMessages, updateSessionContext]);

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
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', content: result.content }]);
      }

      await loadSessions();
    } catch (error) {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `Error: ${(error as Error).message}`
      }]);
    } finally {
      setLoading(false);
    }
  }, [agentCount, input, loadSessions, sessionContext.activeAgentId, sessionContext.activeSessionId, setMessages, setSessions, t, updateSessionContext]);

  return {
    handleClear,
    handleConfirm,
    handleCreateSession,
    handleDeleteSession,
    handleDeny,
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
