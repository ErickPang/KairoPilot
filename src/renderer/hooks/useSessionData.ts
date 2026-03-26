import { useCallback, useEffect, useRef, useState } from 'react';
import { Message, SessionContextState, SessionSummary } from '../types';
import { KAIRO_INVOKE } from '../../shared/ipc';

export function useSessionData(updateSessionContext: (patch: Partial<SessionContextState>) => void) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadSessions = useCallback(async () => {
    try {
      const allSessions = await window.kairo.invoke(KAIRO_INVOKE.chatListSessions);
      setSessions(allSessions);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  }, []);

  const loadActiveSession = useCallback(async () => {
    try {
      const session = await window.kairo.invoke(KAIRO_INVOKE.chatGetActiveSession);
      if (session) {
        setMessages(session.messages);
        updateSessionContext({ activeSessionId: session.id });
      } else {
        setMessages([]);
        updateSessionContext({ activeSessionId: null });
      }
    } catch (error) {
      console.error('Failed to load active session:', error);
    }
  }, [updateSessionContext]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return {
    loadActiveSession,
    loadSessions,
    messages,
    messagesEndRef,
    sessions,
    setMessages,
    setSessions
  };
}
