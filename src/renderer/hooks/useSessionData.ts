import { useCallback, useEffect, useRef, useState } from 'react';
import { ApprovalRecord, ConfirmationRequest, Message, SessionContextState, SessionSummary } from '../types';
import { KAIRO_INVOKE } from '../../shared/ipc';

function getDisplayArgs(approval: ApprovalRecord): Record<string, unknown> {
  if (!approval.metadata?.redacted) {
    return approval.args;
  }

  const redactedArgs = approval.metadata.redactedArgs;
  if (typeof redactedArgs === 'object' && redactedArgs && !Array.isArray(redactedArgs)) {
    return redactedArgs as Record<string, unknown>;
  }

  return approval.args;
}

export function mapApprovalToConfirmationRequest(approval: ApprovalRecord): ConfirmationRequest {
  return {
    id: approval.id,
    tool: approval.toolName,
    args: getDisplayArgs(approval),
    sessionId: approval.sessionId,
    runId: approval.runId,
    riskLevel: typeof approval.metadata?.riskLevel === 'string' ? approval.metadata.riskLevel : undefined,
    approvalMode: typeof approval.metadata?.approvalMode === 'string' ? approval.metadata.approvalMode : undefined,
    policyTags: Array.isArray(approval.metadata?.policyTags)
      ? approval.metadata.policyTags.filter((item): item is string => typeof item === 'string')
      : undefined,
    redacted: typeof approval.metadata?.redacted === 'boolean' ? approval.metadata.redacted : undefined
  };
}

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
        const [latestRun, latestContextSummary, activeRunSteps, confirmationRequest] = await Promise.all([
          window.kairo.invoke(KAIRO_INVOKE.chatGetLatestRun, session.id),
          window.kairo.invoke(KAIRO_INVOKE.chatGetLatestContextSummary, session.id),
          window.kairo.invoke(KAIRO_INVOKE.chatGetSessionRuns, session.id),
          window.kairo.invoke(KAIRO_INVOKE.chatGetPendingApproval, session.id)
        ]);
        updateSessionContext({
          activeSessionId: session.id,
          latestContextSummary,
          latestRun,
          activeRunSteps,
          confirmationRequest: confirmationRequest ? mapApprovalToConfirmationRequest(confirmationRequest) : null
        });
      } else {
        setMessages([]);
        updateSessionContext({
          activeSessionId: null,
          latestContextSummary: null,
          latestRun: null,
          activeRunSteps: [],
          confirmationRequest: null
        });
      }
    } catch (error) {
      console.error('Failed to load active session:', error);
    }
  }, [updateSessionContext]);

  const loadRunState = useCallback(async (sessionId?: string | null) => {
    if (!sessionId) {
      updateSessionContext({
        latestContextSummary: null,
        latestRun: null,
        activeRunSteps: [],
        confirmationRequest: null
      });
      return;
    }

    try {
      const [latestRun, latestContextSummary, activeRunSteps, confirmationRequest] = await Promise.all([
        window.kairo.invoke(KAIRO_INVOKE.chatGetLatestRun, sessionId),
        window.kairo.invoke(KAIRO_INVOKE.chatGetLatestContextSummary, sessionId),
        window.kairo.invoke(KAIRO_INVOKE.chatGetSessionRuns, sessionId),
        window.kairo.invoke(KAIRO_INVOKE.chatGetPendingApproval, sessionId)
      ]);
      updateSessionContext({
        latestContextSummary,
        latestRun,
        activeRunSteps,
        confirmationRequest: confirmationRequest ? mapApprovalToConfirmationRequest(confirmationRequest) : null
      });
    } catch (error) {
      console.error('Failed to load run state:', error);
    }
  }, [updateSessionContext]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return {
    loadActiveSession,
    loadRunState,
    loadSessions,
    messages,
    messagesEndRef,
    sessions,
    setMessages,
    setSessions
  };
}
