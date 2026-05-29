import {
  getApprovalRecord,
  getLatestRun,
  getLatestRunSteps,
  getLatestSessionContextSummary,
  getPendingApproval,
  getRunById,
  getRunTrace,
  getSessionById,
  queryRuns
} from '../store/chat';
import { getActiveAgentId } from '../store/config';
import type { RunQuery, RunTraceQuery } from '../../shared/contracts';
import { getSessionForActiveAgent } from './chatService';

export function getLatestRunForActiveAgentSession(sessionId: string) {
  if (!getSessionForActiveAgent(sessionId)) {
    return null;
  }
  return getLatestRun(sessionId);
}

export function getLatestContextSummaryForActiveAgentSession(sessionId: string) {
  if (!getSessionForActiveAgent(sessionId)) {
    return null;
  }
  return getLatestSessionContextSummary(sessionId);
}

export function getRunStepsForActiveAgentSession(sessionId: string) {
  if (!getSessionForActiveAgent(sessionId)) {
    return [];
  }
  return getLatestRunSteps(sessionId);
}

export function getPendingApprovalForActiveAgentSession(sessionId?: string) {
  if (sessionId) {
    if (!getSessionForActiveAgent(sessionId)) {
      return null;
    }
    return getPendingApproval(sessionId);
  }

  const approval = getPendingApproval();
  if (!approval?.id) {
    return null;
  }
  return getApprovalRecord(approval.id);
}

export function queryRunsForActiveAgent(query: RunQuery) {
  const agentId = getActiveAgentId();
  return queryRuns({
    ...query,
    agentId: agentId || undefined
  });
}

export function getRunTraceForActiveAgent(query: RunTraceQuery) {
  const run = getRunById(query.runId);
  if (!run) {
    return null;
  }

  const session = getSessionById(run.sessionId);
  const agentId = getActiveAgentId();
  if (!session || (agentId && session.agentId !== agentId)) {
    return null;
  }

  return getRunTrace(query);
}
