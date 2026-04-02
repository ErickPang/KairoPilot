import type { RunStep } from '../types';

export type TraceSelectionReason = 'preserve' | 'waiting_approval' | 'failed' | 'running' | 'pending' | 'latest';

export function resolvePreferredTraceSelection(steps: RunStep[], currentSelectedStepId?: string | null) {
  if (steps.length === 0) {
    return {
      stepId: null,
      reason: 'latest' as TraceSelectionReason
    };
  }

  if (currentSelectedStepId && steps.some((step) => step.id === currentSelectedStepId)) {
    return {
      stepId: currentSelectedStepId,
      reason: 'preserve' as TraceSelectionReason
    };
  }

  const waitingApprovalStep = steps.find((step) => step.status === 'waiting_approval');
  if (waitingApprovalStep) {
    return {
      stepId: waitingApprovalStep.id,
      reason: 'waiting_approval' as TraceSelectionReason
    };
  }

  const failedStep = steps.find((step) => step.status === 'failed');
  if (failedStep) {
    return {
      stepId: failedStep.id,
      reason: 'failed' as TraceSelectionReason
    };
  }

  const runningStep = steps.find((step) => step.status === 'running');
  if (runningStep) {
    return {
      stepId: runningStep.id,
      reason: 'running' as TraceSelectionReason
    };
  }

  const pendingStep = steps.find((step) => step.status === 'pending');
  if (pendingStep) {
    return {
      stepId: pendingStep.id,
      reason: 'pending' as TraceSelectionReason
    };
  }

  return {
    stepId: steps[steps.length - 1]?.id || null,
    reason: 'latest' as TraceSelectionReason
  };
}
