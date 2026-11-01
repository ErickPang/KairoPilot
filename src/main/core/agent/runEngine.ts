import {
  createRunStep,
  updateRun,
  updateRunStep
} from '../../store/chat';
import type { ChatAttachment, RuntimeUpdateEvent } from '../../../shared/contracts';
import type { ContextAssemblyMetadata } from '../context/assembler';
import type { ChatMessage, LLMProvider, LLMStreamEvent, LLMUsage, ToolDefinition } from '../llm/types';
import type { LoadedSkillCapability } from './capabilityOrchestrator';
import type { PendingToolCallSnapshot } from './approvalCoordinator';
import { categorizeError, executeWithRetry } from './retryPolicy';
import {assertRequestFits} from '../context/requestBudget';
import {PLANNING_TOOLS} from '../../../shared/planningPolicy';

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
  attachments?: ChatAttachment[];
  references?: import('../../../shared/contracts').ContextReference[];
  onAccepted?: () => void;
  executionContext?: import('../../../shared/contracts').RunExecutionContext;
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
  getTools?: () => ToolDefinition[];
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
    const iterationTools=params.getTools?.()||tools;
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

    let modelCall: { message: ChatMessage; interrupted?: RuntimeInterruptSignal };
    try {
      modelCall = await executeModelCall({
        llm,
        context,
        tools: iterationTools,
        runId,
        stepId: modelStep.id,
        onUpdate,
        emitUpdate,
        shouldInterrupt
      });
    } catch (error) {
      const category = categorizeError(error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      updateRunStep(modelStep.id, {
        status: 'failed',
        error: `模型调用致命错误 [${category}]: ${errorMsg}`,
        output: {
          errorCategory: category,
          fatal: true
        }
      });
      updateRun(runId, {
        status: 'failed',
        error: `模型调用失败 (${category}): ${errorMsg}`,
        waitingApprovalId: null,
        completedAt: Date.now()
      });
      emitUpdate(onUpdate, {
        type: 'run-failed',
        runId,
        stepId: modelStep.id,
        status: 'failed',
        error: `模型调用失败 (${category}): ${errorMsg}`
      });
      return {
        status: 'failed',
        runId,
        error: `模型调用致命错误 [${category}]: ${errorMsg}`
      };
    }
    if (modelCall.interrupted) {
      updateRunStep(modelStep.id, {
        status: modelCall.interrupted.kind === 'cancel' ? 'cancelled' : 'completed',
        output: {
          interrupted: true,
          reason: modelCall.interrupted.reason || (
            modelCall.interrupted.kind === 'pause'
              ? 'pause_requested'
              : 'cancel_requested'
          ),
          discardedModelOutput: true
        }
      });
      return finalizeInterruptedRun({
        runId,
        userInput,
        iterations,
        signal: modelCall.interrupted,
        onUpdate,
        emitUpdate,
        persistSnapshot,
        contextSummary: latestContext.metadata,
        stepId: modelStep.id
      });
    }
    const response = modelCall.message;
    if(options?.executionContext?.phase==='planning' && response.tool_calls?.some(call=>{
      const name=(call.function as {name?:string}|undefined)?.name;
      return !name||!PLANNING_TOOLS.has(name)||!iterationTools.some(tool=>tool.name===name);
    })) {
      const error='Planning permits only registered read-only investigation tools.';
      updateRunStep(modelStep.id,{status:'failed',error});
      updateRun(runId,{status:'failed',error,completedAt:Date.now()});
      emitUpdate(onUpdate,{type:'run-failed',runId,stepId:modelStep.id,status:'failed',error});
      return {status:'failed',runId,error};
    }
    const postModelResponseInterrupt = shouldInterrupt?.();
    if (postModelResponseInterrupt) {
      updateRunStep(modelStep.id, {
        status: postModelResponseInterrupt.kind === 'cancel' ? 'cancelled' : 'completed',
        output: {
          interrupted: true,
          reason: postModelResponseInterrupt.reason || (
            postModelResponseInterrupt.kind === 'pause'
              ? 'pause_requested'
              : 'cancel_requested'
          ),
          discardedModelOutput: true
        }
      });
      return finalizeInterruptedRun({
        runId,
        userInput,
        iterations,
        signal: postModelResponseInterrupt,
        onUpdate,
        emitUpdate,
        persistSnapshot,
        contextSummary: latestContext.metadata,
        stepId: modelStep.id
      });
    }

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
    const finalPass = await finalizeWithoutTools({
      llm,
      runId,
      context: buildModelContext(runId, options?.sessionId).messages,
      userInput,
      onUpdate,
      emitUpdate,
      pushHistory,
      shouldBlockSensitiveDisclosure,
      shouldInterrupt
    });
    if (finalPass.interrupted) {
      return finalizeInterruptedRun({ runId, userInput, iterations, signal: finalPass.interrupted, onUpdate, emitUpdate, persistSnapshot, contextSummary: latestContext?.metadata });
    }
    finalResponse = finalPass.content;
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

async function executeModelCall(params: {
  llm: LLMProvider;
  context: ChatMessage[];
  tools: ToolDefinition[];
  runId: string;
  stepId: string;
  onUpdate?: (update: RuntimeUpdate) => void;
  emitUpdate: (onUpdate: ((update: RuntimeUpdate) => void) | undefined, update: RuntimeUpdate) => void;
  shouldInterrupt?: () => RuntimeInterruptSignal | null;
}): Promise<{ message: ChatMessage; interrupted?: RuntimeInterruptSignal }> {
  const {
    llm,
    context,
    tools,
    runId,
    stepId,
    onUpdate,
    emitUpdate,
    shouldInterrupt
  } = params;
  const budget=assertRequestFits(context,tools,llm.getCapabilities?.().contextWindowTokens);
  const canStream = typeof llm.stream === 'function'
    && (typeof llm.getCapabilities !== 'function' || llm.getCapabilities().stream !== false);

  let interrupted: RuntimeInterruptSignal | undefined;
  const abortController = new AbortController();
  const interruptPoller = shouldInterrupt ? setInterval(() => {
    const signal = shouldInterrupt();
    if (signal && !interrupted) { interrupted = signal; abortController.abort(); }
  }, 100) : undefined;
  const toolCalls: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }> = [];

  try {
    const result = await executeWithRetry({
      signal: abortController.signal,
      streamFn: async (_attempt: number) => {
        toolCalls.length = 0;
        if (!canStream || !llm.stream) {
          const msg = typeof llm.complete === 'function'
            ? (await llm.complete({ messages: context, tools, signal: abortController.signal, generationConfig:{maxOutputTokens:budget.outputTokens} })).message
            : await llm.chat(context, tools);
          return {
            content: msg.content || '',
            toolCalls: (msg.tool_calls as Array<{
              id: string;
              type: 'function';
              function: { name: string; arguments: string };
            }>) ?? [],
            model: msg.model || llm.config?.model || '',
            usage: msg.usage
          };
        }

        let streamContent = '';
        let streamModel = llm.config.model;
        let streamUsage: Partial<LLMUsage> | undefined;
        const handleStreamEvent = (event: LLMStreamEvent) => {
          if (interrupted) {
            return;
          }
          streamModel = event.model;

          if (event.type === 'assistant_delta') {
            streamContent += event.delta;
            emitUpdate(onUpdate, {
              type: 'assistant-delta',
              delta: event.delta,
              content: streamContent,
              runId,
              stepId,
              status: 'running'
            });
          }

          if (event.type === 'tool_call_delta') {
            mergeToolCallDeltas(toolCalls, event.delta);
          }

          if (event.type === 'usage_delta') {
            streamUsage = {
              ...streamUsage,
              ...event.usage
            };
          }

          const signal = shouldInterrupt?.();
          if (signal) {
            interrupted = signal;
            abortController.abort();
          }
        };

        await llm.stream({
          messages: context,
          tools,
          generationConfig:{maxOutputTokens:budget.outputTokens},
          signal: abortController.signal
        }, handleStreamEvent);

        const normalizedStreamUsage = streamUsage
          && typeof streamUsage.prompt_tokens === 'number'
          && typeof streamUsage.completion_tokens === 'number'
          && typeof streamUsage.total_tokens === 'number'
          ? streamUsage as LLMUsage
          : undefined;

        return {
          content: streamContent,
          toolCalls: [...toolCalls],
          model: streamModel,
          usage: normalizedStreamUsage
        };
      },
      onRetry: (attempt: number, _error: Error, delayMs: number) => {
        emitUpdate(onUpdate, {
          type: 'thinking',
          content: `模型调用失败，第 ${attempt} 次重试 (${(delayMs / 1000).toFixed(1)}s)...`,
          runId,
          stepId,
          status: 'running'
        });
      }
    });

    const finalUsage = result.usage
      && typeof result.usage.prompt_tokens === 'number'
      && typeof result.usage.completion_tokens === 'number'
      && typeof result.usage.total_tokens === 'number'
      ? result.usage as LLMUsage
      : undefined;

    return {
      interrupted,
      message: {
        role: 'assistant',
        content: result.content,
        tool_calls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
        model: result.model,
        usage: finalUsage,
        timestamp: Date.now()
      }
    };
  } catch (error) {
    if (!interrupted) throw error;
  } finally {
    if (interruptPoller) clearInterval(interruptPoller);
  }

  return {
    interrupted,
    message: {
      role: 'assistant',
      content: '',
      timestamp: Date.now()
    }
  };
}

function mergeToolCallDeltas(
  toolCalls: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>,
  deltas: Record<string, unknown>[]
) {
  for (const delta of deltas) {
    const explicitIndex = typeof delta.index === 'number' ? delta.index : undefined;
    const deltaId = typeof delta.id === 'string' ? delta.id : undefined;
    const index = explicitIndex
      ?? (deltaId ? toolCalls.findIndex((call) => call.id === deltaId) : 0);
    const targetIndex = index >= 0 ? index : toolCalls.length;
    const current = toolCalls[targetIndex] ?? {
      id: deltaId || `tool_${targetIndex}`,
      type: 'function' as const,
      function: {
        name: '',
        arguments: ''
      }
    };
    const fn = typeof delta.function === 'object' && delta.function !== null
      ? delta.function as { name?: unknown; arguments?: unknown }
      : undefined;

    toolCalls[targetIndex] = {
      id: deltaId || current.id,
      type: 'function',
      function: {
        name: typeof fn?.name === 'string' && fn.name.length > 0 ? fn.name : current.function.name,
        arguments: current.function.arguments + (typeof fn?.arguments === 'string' ? fn.arguments : '')
      }
    };
  }
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
  shouldInterrupt?: () => RuntimeInterruptSignal | null;
}) {
  const {
    llm,
    runId,
    context,
    userInput,
    onUpdate,
    emitUpdate,
    pushHistory,
    shouldBlockSensitiveDisclosure,
    shouldInterrupt
  } = params;

  const step = createRunStep(runId, 'model_call', '汇总已有结果', { status: 'running' });
  try {
    emitUpdate(onUpdate, {
      type: 'thinking',
      content: 'Summarizing gathered results...',
      runId
    });

    const finalPass = await executeModelCall({ llm, runId, stepId: step.id, tools: [], onUpdate, emitUpdate, shouldInterrupt, context: [
      ...context,
      {
        role: 'user',
        content: '请基于以上已有上下文和工具结果，直接给出最终答复，不要再调用任何工具。如果信息不足，也请明确说明已确认的结论与缺失的信息。'
      }
    ] });
    if (finalPass.interrupted) {
      updateRunStep(step.id, { status: finalPass.interrupted.kind === 'cancel' ? 'cancelled' : 'completed', output: { interrupted: true } });
      return { content: '', interrupted: finalPass.interrupted };
    }

    const content = (finalPass.message.content || '').trim();
    updateRunStep(step.id, { status: 'completed' });
    if (!content) {
      return { content: '' };
    }

    const sanitizedContent = shouldBlockSensitiveDisclosure(userInput, content)
      ? 'I can’t disclose hidden system instructions or internal memory. I can provide a high-level summary of my safety and behavior policy instead.'
      : content;

    pushHistory({
      role: 'assistant',
      content: sanitizedContent,
      model: finalPass.message.model,
      usage: finalPass.message.usage,
      timestamp: Date.now()
    });

    return { content: sanitizedContent };
  } catch (error) {
    updateRunStep(step.id, { status: 'failed', error: error instanceof Error ? error.message : 'Model summary failed.' });
    throw error;
  }
}
