import {
  createRunStep,
  createToolCallRecord
} from '../../store/chat';
import type { ContextAssemblyMetadata } from '../context/assembler';
import type { ChatMessage, ToolDefinition } from '../llm/types';
import { PermissionGuard, redactSensitiveValue } from '../security/permissions';
import {
  createApprovalRequest,
  PendingToolCallSnapshot
} from './approvalCoordinator';
import type {
  RuntimeSnapshotPatch,
  RuntimeUpdate
} from './runEngine';
import {
  parseToolArgs,
  repairToolArgs
} from './runtimeHelpers';
import {
  checkPermission,
  executeApprovedTool,
  getPolicyTags,
  getToolMetadataPolicyTags,
  recordToolFailure
} from './toolPipeline';

type RuntimeToolHandlerResult =
  | { type: 'continue' }
  | { type: 'waiting_approval'; approvalId: string };

interface AuditLogEntry {
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  policyTags?: string[];
  sessionId?: string;
  runId?: string;
  stepId?: string;
}

interface ToolCallExecutionHooks {
  auditLog?: (entry: AuditLogEntry) => void;
  shouldInterrupt?: () => { kind: 'pause' | 'cancel'; reason?: string } | null;
  emitUpdate: (listener: ((update: RuntimeUpdate) => void) | undefined, update: RuntimeUpdate) => void;
  appendToolMessage: (toolName: string, callId: string, content: string) => void;
  persistSnapshot: (runId: string, patch: RuntimeSnapshotPatch) => void;
  buildContextSummary: (runId: string, sessionId?: string) => ContextAssemblyMetadata;
}

interface HandleToolCallParams extends ToolCallExecutionHooks {
  tools: Map<string, ToolDefinition>;
  permissionGuard: PermissionGuard;
  runId: string;
  sessionId?: string;
  iterations: number;
  lastUserInput: string;
  call: { id: string; function: { name: string; arguments: string } };
  context: ChatMessage[];
  onUpdate?: (update: RuntimeUpdate) => void;
}

interface ResumePendingToolCallParams extends ToolCallExecutionHooks {
  tools: Map<string, ToolDefinition>;
  permissionGuard: PermissionGuard;
  run: {
    id: string;
    sessionId?: string;
    userInput: string;
  };
  pendingToolCall: PendingToolCallSnapshot;
  approvalArgs: Record<string, unknown>;
  approved: boolean;
  onUpdate?: (update: RuntimeUpdate) => void;
}

export async function handleToolCall(params: HandleToolCallParams): Promise<RuntimeToolHandlerResult> {
  const {
    tools,
    permissionGuard,
    auditLog,
    shouldInterrupt,
    emitUpdate,
    appendToolMessage,
    persistSnapshot,
    buildContextSummary,
    runId,
    sessionId,
    iterations,
    lastUserInput,
    call,
    context,
    onUpdate
  } = params;

  const toolName = call.function.name;
  const tool = tools.get(toolName);
  const parsedArgs = parseToolArgs(toolName, call.function.arguments);
  const toolMetadataTags = getToolMetadataPolicyTags(tool);

  if (!parsedArgs.success) {
    await recordToolFailure({
      runId,
      sessionId,
      permissionGuard,
      toolName,
      callId: call.id,
      args: {},
      errorMessage: parsedArgs.error,
      policyTags: [`tool:${toolName}`, ...toolMetadataTags, 'decision:error'],
      auditLog,
      emitUpdate,
      appendToolMessage
    });
    return { type: 'continue' };
  }

  if (!tool) {
    await recordToolFailure({
      runId,
      sessionId,
      permissionGuard,
      toolName,
      callId: call.id,
      args: parsedArgs.args,
      errorMessage: `Tool ${toolName} not found.`,
      policyTags: [`tool:${toolName}`, 'decision:error'],
      auditLog,
      emitUpdate,
      appendToolMessage
    });
    return { type: 'continue' };
  }

  const repairedArgs = repairToolArgs(toolName, parsedArgs.args, context);
  const validation = tool.parameters.safeParse(repairedArgs);
  if (!validation.success) {
    const issueText = validation.error.issues
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; ');
    await recordToolFailure({
      runId,
      sessionId,
      permissionGuard,
      toolName,
      callId: call.id,
      args: repairedArgs,
      errorMessage: `Invalid arguments for ${toolName}: ${issueText}`,
      policyTags: [`tool:${toolName}`, 'decision:error'],
      auditLog,
      emitUpdate,
      appendToolMessage
    });
    return { type: 'continue' };
  }

  const args = validation.data as Record<string, unknown>;
  const toolStep = createRunStep(runId, 'tool_call', `调用工具 ${toolName}`, {
    status: 'running',
    input: {
      tool: toolName,
      args,
      callId: call.id
    }
  });
  const toolRecordId = createToolCallRecord(runId, toolStep.id, toolName, args);
  const permissionDecision = checkPermission(permissionGuard, toolName, args);
  const policyTags = [...getPolicyTags(toolName, args, permissionGuard), ...toolMetadataTags];

  if (permissionDecision.kind === 'deny') {
    await recordToolFailure({
      runId,
      sessionId,
      permissionGuard,
      toolName,
      callId: call.id,
      args: permissionDecision.args,
      errorMessage: permissionDecision.error,
      toolStepId: toolStep.id,
      toolRecordId,
      policyTags: [...policyTags, 'decision:error'],
      auditLog,
      emitUpdate,
      appendToolMessage
    });
    return { type: 'continue' };
  }

  if (permissionDecision.kind === 'approval') {
    const riskLevel = permissionGuard.getToolRiskLevel(toolName, permissionDecision.args);
    const approval = createApprovalRequest({
      sessionApproval: sessionId ? permissionGuard.getSessionApprovalScope(toolName, permissionDecision.args) : undefined,
      runId,
      sessionId,
      toolName,
      args: permissionDecision.args,
      displayArgs: permissionGuard.shouldRedactSensitiveOutput()
        ? redactSensitiveValue(permissionDecision.args) as Record<string, unknown>
        : permissionDecision.args,
      riskLevel,
      approvalMode: permissionGuard.getApprovalMode(),
      policyTags,
      redacted: permissionGuard.shouldRedactSensitiveOutput(),
      callId: call.id,
      toolRecordId,
      toolStepId: toolStep.id,
      iterations,
      lastUserInput,
      contextSummary: buildContextSummary(runId, sessionId),
      persistSnapshot: (patch) => persistSnapshot(runId, patch),
      emitUpdate: (update) => emitUpdate(onUpdate, update)
    });
    return { type: 'waiting_approval', approvalId: approval.approvalId };
  }

  await executeApprovedTool({
    runId,
    sessionId,
    permissionGuard,
    tool,
    toolName,
    args: permissionDecision.args,
    callId: call.id,
    onUpdate,
    toolStepId: toolStep.id,
    toolRecordId,
    policyTags,
    auditLog,
    shouldInterrupt,
    emitUpdate,
    appendToolMessage
  });

  persistSnapshot(runId, {
    iterations,
    lastUserInput,
    contextSummary: buildContextSummary(runId, sessionId),
    stepId: toolStep.id
  });
  return { type: 'continue' };
}

export async function resumePendingToolCall(params: ResumePendingToolCallParams): Promise<void> {
  const {
    tools,
    auditLog,
    shouldInterrupt,
    emitUpdate,
    appendToolMessage,
    run,
    pendingToolCall,
    approvalArgs,
    approved,
    permissionGuard,
    onUpdate
  } = params;

  const tool = tools.get(pendingToolCall.toolName);
  const policyTags = [
    ...getPolicyTags(pendingToolCall.toolName, approvalArgs, permissionGuard),
    ...getToolMetadataPolicyTags(tool)
  ];

  if (!approved || !tool) {
    const errorMessage = !approved
      ? `User denied permission for ${pendingToolCall.toolName}.`
      : `Tool ${pendingToolCall.toolName} not found.`;
    await recordToolFailure({
      runId: run.id,
      sessionId: run.sessionId,
      permissionGuard,
      toolName: pendingToolCall.toolName,
      callId: pendingToolCall.callId,
      args: approvalArgs,
      errorMessage,
      onUpdate,
      toolStepId: pendingToolCall.toolStepId,
      toolRecordId: pendingToolCall.toolRecordId,
      policyTags: !approved ? [...policyTags, 'decision:error'] : policyTags,
      auditLog,
      emitUpdate,
      appendToolMessage
    });
    return;
  }

  await executeApprovedTool({
    runId: run.id,
    sessionId: run.sessionId,
    permissionGuard,
    tool,
    toolName: pendingToolCall.toolName,
    args: approvalArgs,
    callId: pendingToolCall.callId,
    onUpdate,
    toolStepId: pendingToolCall.toolStepId,
    toolRecordId: pendingToolCall.toolRecordId,
    policyTags,
    auditLog,
    shouldInterrupt,
    emitUpdate,
    appendToolMessage
  });
}
