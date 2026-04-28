import {
  createRunStep,
  updateRun,
  updateRunStep
} from '../../store/chat';
import type { RuntimeUpdateEvent } from '../../../shared/contracts';
import type { ContextAssemblyMetadata } from '../context/assembler';
import type { ChatMessage, LLMProvider, ToolDefinition } from '../llm/types';
import type { LoadedSkillCapability } from './capabilityOrchestrator';
import type { PendingToolCallSnapshot } from './approvalCoordinator';

export type RuntimeUpdate = RuntimeUpdateEvent;

export type RuntimeExecutionStatus = 'completed' | 'waiting_approval' | 'paused' | 'cancelled' | 'failed';

export interface RuntimeInterruptSignal {
  kind: 'pause' | 'cancel';
  reason?: string;
}

export interface RuntimeExecutionResult {
  status: RuntimeExecutionStatus;
  runId: string;
  content?: string;
  error?: string;
  approvalId?: string;
}

export interface RuntimeChatOptions {
  sessionId?: string;
  agentId?: string;
  runId?: string;
  maxIterations?: number;
}

export interface RuntimeModelContext {
  messages: ChatMessage[];
  metadata: ContextAssemblyMetadata;
}

export interface RuntimeSnapshotPatch {
  iterations: number;
  lastUserInput: string;
  loadedSkills?: LoadedSkillCapability[];
  contextSummary?: ContextAssemblyMetadata;
  pendingToolCall?: PendingToolCallSnapshot;
  stepId?: string;
}

interface RuntimeToolCallHandlerParams {
  runId: string;
  sessionId?: string;
  iterations: number;
  lastUserInput: string;
  call: { id: string; function: { name: string; arguments: string } };
  context: ChatMessage[];
}

type RuntimeToolCallHandlerResult =
  | { type: 'continue' }
  | { type: 'waiting_approval'; approvalId: string };

interface ExecuteRunEngineParams {
  llm: LLMProvider;
  tools: ToolDefinition[];
  runId: string;
  userInput: string;
  onUpdate?: (update: RuntimeUpdate) => void;
  options?: RuntimeChatOptions & { iterations?: number };
  buildModelContext: (runId: string, sessionId?: string) => RuntimeModelContext;
  handleToolCall: (params: RuntimeToolCallHandlerParams) => Promise<RuntimeToolCallHandlerResult>;
  persistSnapshot: (runId: string, patch: RuntimeSnapshotPatch) => void;
  emitUpdate: (onUpdate: ((update: RuntimeUpdate) => void) | undefined, update: RuntimeUpdate) => void;
  pushHistory: (message: ChatMessage) => void;
  shouldBlockSensitiveDisclosure: (userInput: string, assistantOutput: string) => boolean;
  shouldInterrupt?: () => RuntimeInterruptSignal | null;
}

export async function executeRunEngine(params: ExecuteRunEngineParams): Promise<RuntimeExecutionResult> {
  const {
    llm,
    tools,
    runId,
    userInput,
    onUpdate,
    options,
    buildModelContext,
    handleToolCall,
    persistSnapshot,
    emitUpdate,
    pushHistory,
    shouldBlockSensitiveDisclosure,
    shouldInterrupt
  } = params;

  let finalResponse = '';
  let iterations = options?.iterations ?? 0;
  const maxIterations = options?.maxIterations ?? 8;
  let latestContext: RuntimeModelContext | undefined;

  while (iterations < maxIterations) {
    const preIterationInterrupt = shouldInterrupt?.();
    if (preIterationInterrupt) {
      return finalizeInterruptedRun({
        runId,
        userInput,
        iterations,
        signal: preIterationInterrupt,
        onUpdate,
        emitUpdate,
        persistSnapshot,
        contextSummary: latestContext?.metadata
      });
    }

    iterations += 1;
    latestContext = buildModelContext(runId, options?.sessionId);
    const context = latestContext.messages;
    const modelStep = createRunStep(runId, 'model_call', `模型推理 ${iterations}`, {
      status: 'running',
      input: {
        iteration: iterations,
        messageCount: context.length,
        contextSummary: latestContext.metadata
      }
    });

    emitUpdate(onUpdate, {
      type: 'thinking',
      content: `Processing... (Iteration ${iterations})`,
      runId,
      stepId: modelStep.id,
      status: 'running'
    });

    const response = await llm.chat(context, tools);
    pushHistory(response);
    context.push(response);
    updateRunStep(modelStep.id, {
      status: 'completed',
      output: {
        content: response.content,
        model: response.model,
        usage: response.usage,
        toolCalls: response.tool_calls?.length || 0,
        contextSummary: latestContext.metadata
      }
    });

    persistSnapshot(runId, {
      iterations,
      lastUserInput: userInput,
      contextSummary: latestContext.metadata,
      stepId: modelStep.id
    });

    const postModelInterrupt = shouldInterrupt?.();
    if (postModelInterrupt) {
      return finalizeInterruptedRun({
        runId,
        userInput,
        iterations,
        signal: postModelInterrupt,
        onUpdate,
        emitUpdate,
        persistSnapshot,
        contextSummary: latestContext.metadata,
        stepId: modelStep.id
      });
    }

    if (response.tool_calls && response.tool_calls.length > 0) {
      for (const rawCall of response.tool_calls) {
        const preToolInterrupt = shouldInterrupt?.();
        if (preToolInterrupt) {
          return finalizeInterruptedRun({
            runId,
            userInput,
            iterations,
            signal: preToolInterrupt,
            onUpdate,
            emitUpdate,
            persistSnapshot,
            contextSummary: latestContext.metadata,
            stepId: modelStep.id
          });
        }
        const call = rawCall as { id: string; function: { name: string; arguments: string } };
        const handled = await handleToolCall({
          runId,
          sessionId: options?.sessionId,
          iterations,
          lastUserInput: userInput,
          call,
          context
        });

        if (handled.type === 'waiting_approval') {
          return {
            status: 'waiting_approval',
            runId,
            approvalId: handled.approvalId
          };
        }
      }
      continue;
    }

    finalResponse = (response.content || '').trim();
    if (shouldBlockSensitiveDisclosure(userInput, finalResponse)) {
      finalResponse = 'I can’t disclose hidden system instructions or internal memory. I can provide a high-level summary of my safety and behavior policy instead.';
    }
    break;
  }

  if (!finalResponse.trim()) {
      finalResponse = await finalizeWithoutTools({
      llm,
      runId,
      context: latestContext?.messages ?? [],
      userInput,
      onUpdate,
      emitUpdate,
      pushHistory,
      shouldBlockSensitiveDisclosure
    });
  }

  const preCompleteInterrupt = shouldInterrupt?.();
  if (preCompleteInterrupt) {
    return finalizeInterruptedRun({
      runId,
      userInput,
      iterations,
      signal: preCompleteInterrupt,
      onUpdate,
      emitUpdate,
      persistSnapshot,
      contextSummary: latestContext?.metadata
    });
  }

  if (!finalResponse.trim()) {
    finalResponse = '我已经完成了技能相关的工具调用，但未能在限制轮次内生成最终答复。请重试，或让我直接基于当前已收集的信息给出结论。';
  }

  const completeStep = createRunStep(runId, 'complete', '生成最终答复', {
    status: 'completed',
    output: {
      content: finalResponse
    }
  });

  updateRun(runId, {
    status: 'completed',
    finalResponse,
    error: null,
    waitingApprovalId: null,
    completedAt: Date.now()
  });

  persistSnapshot(runId, {
    iterations,
    lastUserInput: userInput,
    contextSummary: latestContext?.metadata,
    stepId: completeStep.id
  });

  emitUpdate(onUpdate, {
    type: 'assistant-response',
    content: finalResponse,
    runId,
    status: 'completed'
  });

  return {
    status: 'completed',
    runId,
    content: finalResponse
  };
}

function finalizeInterruptedRun(params: {
  runId: string;
  userInput: string;
  iterations: number;
  signal: RuntimeInterruptSignal;
  onUpdate?: (update: RuntimeUpdate) => void;
  emitUpdate: (onUpdate: ((update: RuntimeUpdate) => void) | undefined, update: RuntimeUpdate) => void;
  persistSnapshot: (runId: string, patch: RuntimeSnapshotPatch) => void;
  contextSummary?: ContextAssemblyMetadata;
  stepId?: string;
}): RuntimeExecutionResult {
  const {
    runId,
    userInput,
    iterations,
    signal,
    onUpdate,
    emitUpdate,
    persistSnapshot,
    contextSummary,
    stepId
  } = params;
  const paused = signal.kind === 'pause';
  const title = paused ? '运行已暂停' : '运行已取消';
  const step = createRunStep(runId, 'summary', title, {
    status: paused ? 'completed' : 'cancelled',
    output: {
      reason: signal.reason || (paused ? 'pause_requested' : 'cancel_requested')
    }
  });

  updateRun(runId, {
    status: paused ? 'paused' : 'cancelled',
    error: paused ? null : signal.reason || 'Run cancelled by user.',
    waitingApprovalId: null,
    completedAt: paused ? null : Date.now()
  });

  persistSnapshot(runId, {
    iterations,
    lastUserInput: userInput,
    contextSummary,
    stepId: stepId || step.id
  });

  emitUpdate(onUpdate, {
    type: paused ? 'run-paused' : 'run-cancelled',
    runId,
    stepId: step.id,
    status: paused ? 'paused' : 'cancelled',
    error: paused ? undefined : signal.reason || 'Run cancelled by user.'
  });

  return {
    status: paused ? 'paused' : 'cancelled',
    runId,
    error: paused ? undefined : signal.reason || 'Run cancelled by user.'
  };
}

async function finalizeWithoutTools(params: {
  llm: LLMProvider;
  runId: string;
  context: ChatMessage[];
  userInput: string;
  onUpdate?: (update: RuntimeUpdate) => void;
  emitUpdate: (onUpdate: ((update: RuntimeUpdate) => void) | undefined, update: RuntimeUpdate) => void;
  pushHistory: (message: ChatMessage) => void;
  shouldBlockSensitiveDisclosure: (userInput: string, assistantOutput: string) => boolean;
}) {
  const {
    llm,
    runId,
    context,
    userInput,
    onUpdate,
    emitUpdate,
    pushHistory,
    shouldBlockSensitiveDisclosure
  } = params;

  try {
    emitUpdate(onUpdate, {
      type: 'thinking',
      content: 'Summarizing gathered results...',
      runId
    });

    const finalPass = await llm.chat([
      ...context,
      {
        role: 'user',
        content: '请基于以上已有上下文和工具结果，直接给出最终答复，不要再调用任何工具。如果信息不足，也请明确说明已确认的结论与缺失的信息。'
      }
    ]);

    const content = (finalPass.content || '').trim();
    if (!content) {
      return '';
    }

    const sanitizedContent = shouldBlockSensitiveDisclosure(userInput, content)
      ? 'I can’t disclose hidden system instructions or internal memory. I can provide a high-level summary of my safety and behavior policy instead.'
      : content;

    pushHistory({
      role: 'assistant',
      content: sanitizedContent,
      model: finalPass.model,
      usage: finalPass.usage,
      timestamp: Date.now()
    });

    return sanitizedContent;
  } catch {
    return '';
  }
}
