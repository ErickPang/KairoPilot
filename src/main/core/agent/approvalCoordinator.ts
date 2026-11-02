import {
  createApprovalRecord,
  createRunStep,
  getApprovalRecord,
  getLatestContextSnapshot,
  getRunById,
  resolveApprovalRecord,
  updateRun,
  updateRunStep,
  updateToolCallRecord
} from '../../store/chat';
import type { RuntimeUpdateEvent, SessionApprovalScope } from '../../../shared/contracts';
import type { ContextAssemblyMetadata } from '../context/assembler';
import type { ChatMessage } from '../llm/types';
import type { LoadedSkillCapability } from './capabilityOrchestrator';
import type { RuntimeSupportSnapshot } from './runtimeHelpers';

export interface PendingToolCallSnapshot {
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  toolRecordId?: string;
  toolStepId?: string;
  approvalStepId?: string;
}

export interface RuntimeSnapshot {
  systemPrompt: string;
  history: ChatMessage[];
  iterations: number;
  lastUserInput: string;
  loadedSkills?: LoadedSkillCapability[];
  contextSummary?: ContextAssemblyMetadata;
  pendingToolCall?: PendingToolCallSnapshot;
  runtimeSupportSnapshot?: RuntimeSupportSnapshot;
  deferredTools?: import('../plugins/discovery').DeferredToolSelection[];
}

interface RuntimeSnapshotPatch {
  iterations: number;
  lastUserInput: string;
  loadedSkills?: LoadedSkillCapability[];
  contextSummary?: ContextAssemblyMetadata;
  pendingToolCall?: PendingToolCallSnapshot;
  stepId?: string;
}

interface CreateApprovalRequestParams {
  sessionApproval?: SessionApprovalScope;
  runId: string;
  sessionId?: string;
  toolName: string;
  args: Record<string, unknown>;
  displayArgs: Record<string, unknown>;
  riskLevel?: string;
  approvalMode?: string;
  policyTags?: string[];
  redacted?: boolean;
  callId: string;
  toolRecordId: string;
  toolStepId: string;
  iterations: number;
  lastUserInput: string;
  contextSummary?: ContextAssemblyMetadata;
  persistSnapshot: (patch: RuntimeSnapshotPatch) => void;
  emitUpdate: (update: RuntimeUpdateEvent) => void;
}

type ApprovalRecord = NonNullable<ReturnType<typeof getApprovalRecord>>;
type RunRecord = NonNullable<ReturnType<typeof getRunById>>;

export function createApprovalRequest(params: CreateApprovalRequestParams) {
  const {
    runId,
    sessionId,
    toolName,
    args,
    displayArgs,
    riskLevel,
    approvalMode,
    policyTags,
    redacted,
    sessionApproval,
    callId,
    toolRecordId,
    toolStepId,
    iterations,
    lastUserInput,
    contextSummary,
    persistSnapshot,
    emitUpdate
  } = params;

  updateRunStep(toolStepId, {
    status: 'waiting_approval',
    metadata: {
      callId,
      toolRecordId
    }
  });
  updateToolCallRecord(toolRecordId, {
    status: 'waiting_approval'
  });

  const approvalStep = createRunStep(runId, 'approval_wait', `等待确认 ${toolName}`, {
    status: 'waiting_approval',
    input: {
      tool: toolName,
      args: displayArgs
    },
    metadata: {
      callId,
      toolRecordId,
      toolStepId,
      redactedArgs: displayArgs,
      sessionApproval,
      riskLevel,
      approvalMode,
      policyTags,
      redacted
    }
  });

  const approval = createApprovalRecord({
    runId,
    stepId: approvalStep.id,
    sessionId,
    toolName,
    toolArgs: args,
    metadata: {
      callId,
      toolRecordId,
      toolStepId,
      approvalStepId: approvalStep.id,
      redactedArgs: displayArgs,
      sessionApproval,
      riskLevel,
      approvalMode,
      policyTags,
      redacted
    }
  });

  updateRun(runId, {
    status: 'waiting_approval',
    waitingApprovalId: approval.id
  });

  persistSnapshot({
    iterations,
    lastUserInput,
    contextSummary,
    stepId: approvalStep.id,
    pendingToolCall: {
      callId,
      toolName,
      args,
      toolRecordId,
      toolStepId,
      approvalStepId: approvalStep.id
    }
  });

  emitUpdate({
    type: 'approval-required',
    sessionApproval,
    tool: toolName,
    args: displayArgs,
    sessionId,
    runId,
    stepId: approvalStep.id,
    approvalId: approval.id,
    riskLevel,
    approvalMode,
    policyTags,
    redacted,
    status: 'waiting_approval'
  });

  return {
    approvalId: approval.id
  };
}

export function prepareApprovalResume(approvalId: string, approved: boolean):
  | {
    status: 'ready';
    approval: ApprovalRecord;
    run: RunRecord;
    snapshot: RuntimeSnapshot;
    pendingToolCall: PendingToolCallSnapshot;
  }
  | {
    status: 'failed';
    runId: string;
    error: string;
  } {
  const approval = getApprovalRecord(approvalId);
  if (!approval) {
    throw new Error(`Approval record not found: ${approvalId}`);
  }
  if (approval.status !== 'pending') {
    throw new Error(`Approval ${approvalId} has already been resolved.`);
  }

  const run = getRunById(approval.runId);
  if (!run) {
    throw new Error(`Run not found: ${approval.runId}`);
  }
  if (run.status !== 'waiting_approval' || run.waitingApprovalId !== approval.id
    || (approval.sessionId && approval.sessionId !== run.sessionId)) {
    throw new Error('Approval is stale or does not belong to the waiting run.');
  }

  const snapshot = getLatestContextSnapshot<RuntimeSnapshot>(run.id);
  if (!snapshot) {
    throw new Error(`Context snapshot not found for run ${run.id}`);
  }
  const pending = snapshot.pendingToolCall;
  if (!pending || pending.toolName !== approval.toolName
    || JSON.stringify(pending.args) !== JSON.stringify(approval.args)
    || (approval.metadata?.callId && approval.metadata.callId !== pending.callId)
    || (pending.approvalStepId && pending.approvalStepId !== approval.stepId)) {
    throw new Error('Approval does not match its pending tool checkpoint.');
  }

  resolveApprovalRecord(approvalId, approved);
  updateRun(run.id, {
    status: 'running',
    error: null,
    waitingApprovalId: null,
    completedAt: null
  });

  if (approval.stepId) {
    updateRunStep(approval.stepId, {
      status: 'completed',
      output: {
        approved
      },
      metadata: {
        ...(approval.metadata || {}),
        approvalId
      }
    });
  }

  if (!snapshot.pendingToolCall) {
    const error = 'Pending tool call snapshot not found.';
    updateRun(run.id, {
      status: 'failed',
      error,
      completedAt: Date.now()
    });
    return {
      status: 'failed',
      runId: run.id,
      error
    };
  }

  return {
    status: 'ready',
    approval,
    run,
    snapshot,
    pendingToolCall: snapshot.pendingToolCall
  };
}
