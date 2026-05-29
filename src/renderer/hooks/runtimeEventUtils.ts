import type { RuntimeUpdateEvent, RunStep, RunSummary } from '../types';
import type { ConfirmationRequest, Message, SessionContextState } from '../types';

export function appendRuntimeMessage(previous: Message[], nextMessage: Message) {
  const withoutTrailingThinking = previous[previous.length - 1]?.role === 'thinking'
    ? previous.slice(0, -1)
    : previous;
  return [...withoutTrailingThinking, nextMessage];
}

export function upsertThinkingMessage(previous: Message[], content: string): Message[] {
  const lastMessage = previous[previous.length - 1];
  if (lastMessage?.role === 'thinking') {
    return [...previous.slice(0, -1), { role: 'thinking' as const, content }];
  }

  return [...previous, { role: 'thinking' as const, content }];
}

export function upsertAssistantStreamMessage(previous: Message[], content: string): Message[] {
  const withoutTrailingThinking = previous[previous.length - 1]?.role === 'thinking'
    ? previous.slice(0, -1)
    : previous;
  const lastMessage = withoutTrailingThinking[withoutTrailingThinking.length - 1];
  if (lastMessage?.role === 'assistant') {
    return [...withoutTrailingThinking.slice(0, -1), {
      ...lastMessage,
      content
    }];
  }

  return [...withoutTrailingThinking, { role: 'assistant' as const, content }];
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

  if (update.type === 'run-paused' || update.type === 'run-cancelled') {
    return {
      ...current,
      status: update.status,
      error: update.error,
      waitingApprovalId: undefined,
      updatedAt: Date.now(),
      completedAt: update.status === 'cancelled' ? Date.now() : current.completedAt
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

function patchRunSteps(currentSteps: RunStep[], update: RuntimeUpdateEvent): RunStep[] {
  if (!('stepId' in update) || !update.stepId) {
    return currentSteps;
  }

  let changed = false;
  const nextSteps: RunStep[] = currentSteps.map((step): RunStep => {
    if (step.id !== update.stepId) {
      return step;
    }

    changed = true;

    if (update.type === 'tool-error') {
      return {
        ...step,
        status: 'failed',
        error: update.error,
        updatedAt: Date.now()
      };
    }

    if (update.type === 'approval-required') {
      return {
        ...step,
        status: 'waiting_approval',
        updatedAt: Date.now()
      };
    }

    if (update.type === 'run-paused' || update.type === 'run-cancelled') {
      return {
        ...step,
        status: update.status === 'paused' ? 'completed' : 'cancelled',
        error: update.error,
        updatedAt: Date.now()
      };
    }

    if (update.type === 'thinking' || update.type === 'assistant-delta' || update.type === 'tool-call') {
      return {
        ...step,
        status: 'running',
        updatedAt: Date.now()
      };
    }

    if (update.type === 'tool-result') {
      return {
        ...step,
        status: 'completed',
        updatedAt: Date.now()
      };
    }

    return step;
  });

  return changed ? nextSteps : currentSteps;
}

export function mapRuntimeApprovalToConfirmationRequest(update: Extract<RuntimeUpdateEvent, { type: 'approval-required' }>): ConfirmationRequest {
  return {
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
  const patch: Partial<SessionContextState> = {
    latestRun: patchRunSummary(current.latestRun, update),
    activeRunSteps: patchRunSteps(current.activeRunSteps, update)
  };

  if (update.type === 'approval-required') {
    patch.confirmationRequest = mapRuntimeApprovalToConfirmationRequest(update);
  }

  if (
    update.type === 'assistant-response'
    || update.type === 'run-cancelled'
    || update.type === 'run-paused'
    || (
      isProgressUpdate(update)
      && current.confirmationRequest?.runId === update.runId
    )
  ) {
    patch.confirmationRequest = null;
  }

  return patch;
}
