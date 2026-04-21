import { useCallback, useRef, useState } from 'react';
import { ApprovalRecord, ConfirmationRequest, Message, SessionContextState, SessionContextUpdate, SessionSummary } from '../types';
import { KAIRO_INVOKE } from '../../shared/ipc';
import type { I18nContextValue } from '../components/layout/I18nContext';
import { getErrorMessage, logRendererError } from './errorUtils';

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

interface UseSessionDataOptions {
  onLoadActiveSessionError?: (message: string) => void;
  onLoadRunStateError?: (message: string) => void;
  onLoadSessionsError?: (message: string) => void;
  t: I18nContextValue['t'];
}

interface RunStatePatchInput {
  activeSessionId: string | null;
  targetSessionId: string;
  latestRun: SessionContextState['latestRun'];
  latestContextSummary: SessionContextState['latestContextSummary'];
  activeRunSteps: SessionContextState['activeRunSteps'];
  confirmationRequest: SessionContextState['confirmationRequest'];
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

export function createRunStatePatchForSession(input: RunStatePatchInput): Partial<SessionContextState> | null {
  if (input.activeSessionId && input.activeSessionId !== input.targetSessionId) {
    return null;
  }

  return {
    latestContextSummary: input.latestContextSummary,
    latestRun: input.latestRun,
    activeRunSteps: input.activeRunSteps,
    confirmationRequest: input.confirmationRequest
  };
}

export function sortSessionsByActivity(items: SessionSummary[]): SessionSummary[] {
  return [...items].sort((left, right) => {
    if (right.updatedAt !== left.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }

    if (right.createdAt !== left.createdAt) {
      return right.createdAt - left.createdAt;
    }

    return left.id.localeCompare(right.id);
  });
}

export function useSessionData(
  updateSessionContext: (patch: SessionContextUpdate) => void,
  options: UseSessionDataOptions
) {
  const { onLoadActiveSessionError, onLoadRunStateError, onLoadSessionsError, t } = options;
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadSessions = useCallback(async () => {
    try {
      const allSessions = await window.kairo.invoke(KAIRO_INVOKE.chatListSessions);
      setSessions(sortSessionsByActivity(allSessions));
    } catch (error) {
      logRendererError('Failed to load sessions', error);
      onLoadSessionsError?.(t('app.error.loadSessions', { error: getErrorMessage(error) }));
    }
  }, [onLoadSessionsError, t]);

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
      logRendererError('Failed to load active session', error);
      onLoadActiveSessionError?.(t('app.error.loadActiveSession', { error: getErrorMessage(error) }));
    }
  }, [onLoadActiveSessionError, t, updateSessionContext]);

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
      updateSessionContext((current) => createRunStatePatchForSession({
        activeSessionId: current.activeSessionId,
        targetSessionId: sessionId,
        latestContextSummary,
        latestRun,
        activeRunSteps,
        confirmationRequest: confirmationRequest ? mapApprovalToConfirmationRequest(confirmationRequest) : null
      }) ?? {});
    } catch (error) {
      logRendererError('Failed to load run state', error);
      onLoadRunStateError?.(t('app.error.loadRunState', { error: getErrorMessage(error) }));
    }
  }, [onLoadRunStateError, t, updateSessionContext]);

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
