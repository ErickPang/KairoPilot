import { Dispatch, RefObject, SetStateAction, useCallback, useEffect, useState } from 'react';
import { ConfirmationRequest, Message, Session, SessionContextState, SessionSummary } from '../types';
import { I18nContextValue } from '../components/layout/I18nContext';

interface AgentUpdate {
  type: string;
  content?: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

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
    const removeListener = window.kairo.on('agent:update', (...args: unknown[]) => {
      const update = args[0] as AgentUpdate;
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
    const removeListener = window.kairo.on('agent:ask-confirmation', (...args: unknown[]) => {
      const request = args[0] as ConfirmationRequest;
      updateSessionContext({ confirmationRequest: request });
    });

    return () => removeListener();
  }, [setMessages, setSessions, updateSessionContext]);

  const handleCreateSession = useCallback(async () => {
    try {
      const newSession = await window.kairo.invoke('chat:createSession') as Session;
      setSessions((prev) => [newSession, ...prev]);
      updateSessionContext({ activeSessionId: newSession.id });
      setMessages([]);
      await window.kairo.invoke('chat:setActiveSession', newSession.id);
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  }, [setMessages, setSessions, updateSessionContext]);

  const handleSelectSession = useCallback(async (sessionId: string) => {
    try {
      const result = await window.kairo.invoke('chat:setActiveSession', sessionId) as { success: boolean; error?: string };
      if (!result.success) {
        throw new Error(result.error || 'Failed to switch session');
      }

      updateSessionContext({ activeSessionId: sessionId });

      const active = await window.kairo.invoke('chat:getSession', sessionId) as Session | null;
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
      await window.kairo.invoke('chat:deleteSession', sessionId);
      await loadSessions();
      await loadActiveSession();
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  }, [loadActiveSession, loadSessions, t]);

  const handleUpdateSessionTitle = useCallback(async (sessionId: string, title: string) => {
    try {
      await window.kairo.invoke('chat:updateSessionTitle', { sessionId, title });
      setSessions((prev) => prev.map((session) => session.id === sessionId ? { ...session, title } : session));
    } catch (error) {
      console.error('Failed to update session title:', error);
    }
  }, [setSessions]);

  const handleConfirm = useCallback(async () => {
    if (!sessionContext.confirmationRequest) {
      return;
    }

    await window.kairo.invoke('agent:confirm-response', {
      id: sessionContext.confirmationRequest.id,
      approved: true
    });
    updateSessionContext({ confirmationRequest: null });
  }, [sessionContext.confirmationRequest, updateSessionContext]);

  const handleDeny = useCallback(async () => {
    if (!sessionContext.confirmationRequest) {
      return;
    }

    await window.kairo.invoke('agent:confirm-response', {
      id: sessionContext.confirmationRequest.id,
      approved: false
    });
    updateSessionContext({ confirmationRequest: null });
  }, [sessionContext.confirmationRequest, updateSessionContext]);

  const handleClear = useCallback(async () => {
    try {
      await window.kairo.invoke('chat:clearAllSessions');
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
      const newSession = await window.kairo.invoke('chat:createSession', input.substring(0, 30)) as Session;
      setSessions((prev) => [newSession, ...prev]);
      updateSessionContext({ activeSessionId: newSession.id });
      await window.kairo.invoke('chat:setActiveSession', newSession.id);
    }

    const userMessage: Message = { role: 'user', content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const result = await window.kairo.invoke('agent:chat', input) as { error?: string; content: string };
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
