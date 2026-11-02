import { useCallback, useRef, useState } from 'react';
import { ApprovalRecord, ConfirmationRequest, SessionContextState, SessionContextUpdate, SessionSummary } from '../types';
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
  getSessionContext: () => SessionContextState;
  onLoadActiveSessionError?: (message: string) => void;
  onLoadRunStateError?: (message: string) => void;
  onLoadSessionsError?: (message: string) => void;
  t: I18nContextValue['t'];
}

interface RunStatePatchInput {
  activeSessionId: string | null;
  targetSessionId: string;
  latestRun: SessionContextState['latestRun'];
  confirmationRequest: SessionContextState['confirmationRequest'];
}

export function mapApprovalToConfirmationRequest(approval: ApprovalRecord): ConfirmationRequest {
  return {
    sessionApproval: approval.metadata?.sessionApproval as ConfirmationRequest['sessionApproval'],
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
  if (input.activeSessionId !== input.targetSessionId) {
    return null;
  }

  return {
    latestRun: input.latestRun,
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
  const { getSessionContext, onLoadActiveSessionError, onLoadRunStateError, onLoadSessionsError, t } = options;
  const sessionLoadVersion = useRef(0);
  const runLoadVersion = useRef(0);
  const listLoadVersion = useRef(0);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  const loadSessions = useCallback(async (options?: { throwOnError?: boolean }) => {
    const version = ++listLoadVersion.current;
    const agentId = getSessionContext().activeAgentId;
    try {
      const page = await window.kairo.invoke(KAIRO_INVOKE.chatQuerySessions, { limit: 100, filter: 'all', includeActiveSession: true, includeSessionId: getSessionContext().activeSessionId || undefined });
      const allSessions = page.selectedSession && !page.items.some((item) => item.id === page.selectedSession!.id) ? [...page.items, page.selectedSession] : page.items;
      if (version !== listLoadVersion.current || agentId !== getSessionContext().activeAgentId) {
        if (options?.throwOnError) throw new Error('Task list context changed during refresh.');
        return;
      }
      setSessions(sortSessionsByActivity(allSessions));
    } catch (error) {
      if (version !== listLoadVersion.current || agentId !== getSessionContext().activeAgentId) {
        if (options?.throwOnError) throw new Error('Task list context changed during refresh.');
        return;
      }
      logRendererError('Failed to load sessions', error);
      onLoadSessionsError?.(t('app.error.loadSessions', { error: getErrorMessage(error) }));
      if (options?.throwOnError) throw error;
    }
  }, [getSessionContext, onLoadSessionsError, t]);

  const loadActiveSession = useCallback(async () => {
    const version = ++sessionLoadVersion.current;
    const initial = getSessionContext();
    const isCurrent = () => version === sessionLoadVersion.current && initial.activeAgentId === getSessionContext().activeAgentId && initial.activeSessionId === getSessionContext().activeSessionId;
    try {
      const session = await window.kairo.invoke(KAIRO_INVOKE.chatGetActiveSummary);
      if (!isCurrent()) return;
      if (session) {
        const [latestRun, confirmationRequest] = await Promise.all([
          window.kairo.invoke(KAIRO_INVOKE.chatGetLatestRun, session.id),
          window.kairo.invoke(KAIRO_INVOKE.chatGetPendingApproval, session.id)
        ]);
        if (!isCurrent()) return;
        setSessions((items) => items.some((item) => item.id === session.id) ? items : [...items, session]);
        updateSessionContext({
          activeSessionId: session.id,
          latestRun,
          confirmationRequest: confirmationRequest ? mapApprovalToConfirmationRequest(confirmationRequest) : null
        });
      } else {
        updateSessionContext({
          activeSessionId: null,
          latestRun: null,
          confirmationRequest: null
        });
      }
    } catch (error) {
      if (!isCurrent()) return;
      logRendererError('Failed to load active session', error);
      onLoadActiveSessionError?.(t('app.error.loadActiveSession', { error: getErrorMessage(error) }));
    }
  }, [getSessionContext, onLoadActiveSessionError, t, updateSessionContext]);

  const loadRunState = useCallback(async (sessionId?: string | null) => {
    const version = ++runLoadVersion.current;
    const agentId = getSessionContext().activeAgentId;
    if (!sessionId) {
      updateSessionContext({
        latestRun: null,
        confirmationRequest: null
      });
      return;
    }

    try {
      const [latestRun, confirmationRequest] = await Promise.all([
        window.kairo.invoke(KAIRO_INVOKE.chatGetLatestRun, sessionId),
        window.kairo.invoke(KAIRO_INVOKE.chatGetPendingApproval, sessionId)
      ]);
      if (version !== runLoadVersion.current || agentId !== getSessionContext().activeAgentId) return;
      updateSessionContext((current) => createRunStatePatchForSession({
        activeSessionId: current.activeSessionId,
        targetSessionId: sessionId,
        latestRun,
        confirmationRequest: confirmationRequest ? mapApprovalToConfirmationRequest(confirmationRequest) : null
      }) ?? {});
    } catch (error) {
      if (version !== runLoadVersion.current || agentId !== getSessionContext().activeAgentId) return;
      logRendererError('Failed to load run state', error);
      onLoadRunStateError?.(t('app.error.loadRunState', { error: getErrorMessage(error) }));
    }
  }, [getSessionContext, onLoadRunStateError, t, updateSessionContext]);

  return {
    loadActiveSession,
    loadRunState,
    loadSessions,
    sessions,
    setSessions
  };
}
