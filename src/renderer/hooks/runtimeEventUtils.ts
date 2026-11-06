import type { RuntimeUpdateEvent, RunSummary } from '../types';
import type { ConfirmationRequest, SessionContextState } from '../types';

export function isRuntimeUpdateForSession(current: SessionContextState, update: RuntimeUpdateEvent): boolean {
  if (current.latestRun && isRunUnsettled(current.latestRun) && current.latestRun.id !== update.runId) return false;
  if (update.sessionId) return update.sessionId === current.activeSessionId;
  return Boolean(current.latestRun && current.latestRun.id === update.runId);
}

export function isRunUnsettled(run: Pick<RunSummary, 'status'> | null | undefined): boolean {
  return Boolean(run && ['running', 'waiting_approval', 'paused'].includes(run.status));
}

function isProgressUpdate(update: RuntimeUpdateEvent) {
  return update.type === 'thinking'
    || update.type === 'assistant-delta'
    || update.type === 'tool-call'
    || update.type === 'tool-result'
    || update.type === 'tool-error';
}

function patchRunSummary(current: RunSummary | null, update: RuntimeUpdateEvent): RunSummary | null {
  if (!current || current.id !== update.runId) {
    return current;
  }

  if (['completed', 'failed', 'cancelled'].includes(current.status) && isProgressUpdate(update)) {
    return current;
  }

  if (update.type === 'approval-required') {
    return {
      ...current,
      status: 'waiting_approval',
      waitingApprovalId: update.approvalId,
      updatedAt: Date.now()
    };
  }

  if (update.type === 'assistant-response') {
    return {
      ...current,
      status: 'completed',
      finalResponse: update.content,
      waitingApprovalId: undefined,
      updatedAt: Date.now(),
      completedAt: Date.now()
    };
  }

  if (update.type === 'run-paused' || update.type === 'run-cancelled' || update.type === 'run-failed') {
    return {
      ...current,
      status: update.status,
      error: update.error,
      waitingApprovalId: undefined,
      updatedAt: Date.now(),
      completedAt: update.status !== 'paused' ? Date.now() : current.completedAt
    };
  }

  if (isProgressUpdate(update)) {
    return {
      ...current,
      status: 'running',
      waitingApprovalId: undefined,
      updatedAt: Date.now()
    };
  }

  return current;
}

export function mapRuntimeApprovalToConfirmationRequest(update: Extract<RuntimeUpdateEvent, { type: 'approval-required' }>): ConfirmationRequest {
  return {
    sessionApproval: update.sessionApproval,
    id: update.approvalId,
    tool: update.tool,
    args: update.args,
    sessionId: update.sessionId,
    runId: update.runId,
    riskLevel: update.riskLevel,
    approvalMode: update.approvalMode,
    policyTags: update.policyTags,
    redacted: update.redacted
  };
}

export function applyRuntimeUpdateToSessionContext(
  current: SessionContextState,
  update: RuntimeUpdateEvent
): Partial<SessionContextState> {
  if (!isRuntimeUpdateForSession(current, update)) return {};
  if (current.latestRun && current.latestRun.id !== update.runId) return {};
  const patch: Partial<SessionContextState> = {
    latestRun: patchRunSummary(current.latestRun, update),
  };

  if (update.type === 'approval-required') {
    patch.confirmationRequest = mapRuntimeApprovalToConfirmationRequest(update);
  }

  if (
    update.type === 'assistant-response'
    || update.type === 'run-cancelled'
    || update.type === 'run-paused'
    || update.type === 'run-failed'
    || (
      isProgressUpdate(update)
      && current.confirmationRequest?.runId === update.runId
    )
  ) {
    patch.confirmationRequest = null;
  }

  return patch;
}
