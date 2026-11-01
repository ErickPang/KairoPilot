import {
  getApprovalRecord,
  getLatestRun,
  getLatestRunSteps,
  getLatestSessionContextSummary,
  getPendingApproval,
  getRunById,
  RESTART_INTERRUPTED_ERROR,
  getRetryableRunStepIds,
  getRunTrace,
  getSessionById,
  queryRuns
} from '../store/chat';
import type { RunQuery, RunTraceQuery } from '../../shared/contracts';
import { getSessionForActiveAgent } from './chatService';
import { redactSensitiveValue, redactSensitiveText } from '../core/security/permissions';

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
  const steps = getLatestRunSteps(sessionId);
  const run = getLatestRun(sessionId);
  const retryableIds = new Set(run?.executionContext && run.executionContext.phase!=='planning' && run.status === 'failed' && run.error !== RESTART_INTERRUPTED_ERROR ? getRetryableRunStepIds(run.id) : []);
  return steps.map((step) => ({
    ...step,
    input: redactSensitiveValue(step.input),
    output: redactSensitiveValue(step.output),
    error: step.error ? redactSensitiveText(step.error) : undefined,
    metadata: { ...step.metadata, retryable: retryableIds.has(step.id) }
  }));
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
  return queryRuns({...query,agentId:undefined});
}

export function getRunTraceForActiveAgent(query: RunTraceQuery) {
  const run = getRunById(query.runId);
  if (!run) {
    return null;
  }

  const session = getSessionById(run.sessionId);
  if (!session) {
    return null;
  }

  return getRunTrace(query);
}
