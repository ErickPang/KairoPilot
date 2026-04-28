import {
  createRun,
  createRunStep,
  getApprovalRecord,
  getLatestContextSnapshot,
  getLatestContextSnapshotByStep,
  getRecentSessionContextSummaries,
  getPendingApproval,
  getRunById,
  getRunSteps,
  resolveApprovalRecord,
  saveContextSnapshot,
  saveRunContextSummary,
  updateRun,
  updateRunStep,
  updateToolCallRecord
} from '../../store/chat';
import {
  prepareApprovalResume,
  RuntimeSnapshot
} from './approvalCoordinator';
import { assembleRuntimeContext } from '../context/assembler';
import { LLMProvider, ChatMessage, ToolDefinition } from '../llm/types';
import { PermissionGuard } from '../security/permissions';
import {
  executeRunEngine,
  RuntimeChatOptions,
  RuntimeExecutionResult,
  RuntimeModelContext,
  RuntimeSnapshotPatch,
  RuntimeUpdate
} from './runEngine';
import {
  SkillCatalogSnapshot,
  shouldBlockSensitiveDisclosure
} from './runtimeHelpers';
import {
  handleToolCall,
  resumePendingToolCall
} from './toolCallCoordinator';
import { CapabilityOrchestrator, type LoadedSkillCapability } from './capabilityOrchestrator';
import { RuntimeRunControl } from './runtimeRunControl';
import { RuntimeSupportState } from './runtimeSupportState';
import { skillsManager } from '../skills/manager';

interface RuntimeSupportContext {
  availableSkillsCatalog?: SkillCatalogSnapshot;
}

export function isSkillInventoryQuery(userInput: string) {
  const normalized = userInput.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    /((哪些|有什么|查看|列出|看看|显示).*(技能|skill))|((技能|skill).*(哪些|有什么|列表|可用|已安装))/.test(normalized)
    || /what skills|which skills|available skills|installed skills|list skills|show skills/.test(normalized)
  );
}

export async function buildSkillInventoryResponse(agentId: string) {
  const [publicSkills, agentSkills, mergedSkills] = await Promise.all([
    skillsManager.listPublicSkills(),
    skillsManager.listAgentSkills(agentId),
    skillsManager.listMergedSkills(agentId)
  ]);
  const visiblePublicSkills = publicSkills.filter((skill) => skill.userInvocable !== false);
  const visibleAgentSkills = agentSkills.filter((skill) => skill.userInvocable !== false);
  const visibleMergedSkills = mergedSkills.filter((skill) => skill.userInvocable !== false);
  const hiddenSkillsCount = mergedSkills.length - visibleMergedSkills.length;

  if (visibleMergedSkills.length === 0) {
    return '当前没有可用技能。公共区技能 0 个，当前 Agent 专属技能 0 个。';
  }

  const publicLines = visiblePublicSkills.length > 0
    ? visiblePublicSkills.map((skill) => `- ${skill.name} (${skill.id})`)
    : ['- 无'];
  const agentLines = visibleAgentSkills.length > 0
    ? visibleAgentSkills.map((skill) => `- ${skill.name} (${skill.id})`)
    : ['- 无'];

  return [
    `当前可用技能共 ${visibleMergedSkills.length} 个。公共区技能 ${visiblePublicSkills.length} 个，当前 Agent 专属技能 ${visibleAgentSkills.length} 个。${hiddenSkillsCount > 0 ? `另有 ${hiddenSkillsCount} 个仅供自动调用的隐藏技能。` : ''}`,
    '',
    '公共区技能：',
    ...publicLines,
    '',
    '当前 Agent 专属技能：',
    ...agentLines
  ].join('\n');
}

function isVisibleSessionMessage(message: ChatMessage) {
  const content = message.content.trim();
  if (!content) {
    return false;
  }

  if (message.role === 'user') {
    return true;
  }

  if (message.role !== 'assistant') {
    return false;
  }

  return !Array.isArray(message.tool_calls) || message.tool_calls.length === 0;
}

export class AgentRuntime {
  private llm: LLMProvider;
  private tools: Map<string, ToolDefinition>;
  private capabilityOrchestrator: CapabilityOrchestrator;
  private history: ChatMessage[] = [];
  private systemPrompt: string;
  private workspace: string;
  private permissionGuard: PermissionGuard;
  private runControl = new RuntimeRunControl();
  private runtimeSupportState = new RuntimeSupportState();
  private auditLog?: (entry: {
    tool: string;
    args: Record<string, unknown>;
    result?: unknown;
    error?: string;
    policyTags?: string[];
    sessionId?: string;
    runId?: string;
    stepId?: string;
  }) => void;
  private refreshSystemPrompt?: () => string | Promise<string>;
  private getRuntimeSupportContext?: () => RuntimeSupportContext;
  private resolveInitialSkills?: (userInput: string, agentId: string) => Promise<LoadedSkillCapability[]>;
  private reloadRetainedSkills?: (skills: LoadedSkillCapability[], agentId: string) => Promise<LoadedSkillCapability[]>;

  private restoreSnapshotState(snapshot: RuntimeSnapshot) {
    this.systemPrompt = snapshot.systemPrompt || this.systemPrompt;
    this.history = Array.isArray(snapshot.history) ? snapshot.history : [];
    this.capabilityOrchestrator.setLoadedSkills(Array.isArray(snapshot.loadedSkills) ? snapshot.loadedSkills : []);
    this.runtimeSupportState.restore(snapshot.runtimeSupportSnapshot);
  }

  private createResumeOptions(run: { id: string; sessionId?: string; agentId: string }, iterations: number) {
    return {
      sessionId: run.sessionId,
      agentId: run.agentId,
      runId: run.id,
      maxIterations: undefined,
      iterations
    } as RuntimeChatOptions & { iterations: number };
  }

  constructor(
    llm: LLMProvider,
    permissionGuard: PermissionGuard,
    workspace: string,
    systemPrompt: string = 'You are a helpful AI assistant.',
    auditLog?: (entry: {
      tool: string;
      args: Record<string, unknown>;
      result?: unknown;
      error?: string;
      policyTags?: string[];
      sessionId?: string;
      runId?: string;
      stepId?: string;
    }) => void,
    refreshSystemPrompt?: () => string | Promise<string>,
    getRuntimeSupportContext?: () => RuntimeSupportContext,
    resolveInitialSkills?: (userInput: string, agentId: string) => Promise<LoadedSkillCapability[]>,
    reloadRetainedSkills?: (skills: LoadedSkillCapability[], agentId: string) => Promise<LoadedSkillCapability[]>
  ) {
    this.llm = llm;
    this.systemPrompt = systemPrompt;
    this.workspace = workspace;
    this.permissionGuard = permissionGuard;
    this.auditLog = auditLog;
    this.refreshSystemPrompt = refreshSystemPrompt;
    this.getRuntimeSupportContext = getRuntimeSupportContext;
    this.resolveInitialSkills = resolveInitialSkills;
    this.reloadRetainedSkills = reloadRetainedSkills;
    this.tools = new Map();
    this.capabilityOrchestrator = new CapabilityOrchestrator(permissionGuard);
  }

  registerTool(tool: ToolDefinition) {
    this.tools.set(tool.name, tool);
    this.capabilityOrchestrator.registerTool(tool);
  }

  getHistory(): ChatMessage[] {
    return this.history;
  }

  getSessionHistory(): ChatMessage[] {
    return this.history
      .filter((message) => isVisibleSessionMessage(message))
      .map((message) => ({ ...message }));
  }

  setHistory(history: ChatMessage[]) {
    this.history = history;
  }

  activateLoadedSkill(skillOrCapability: LoadedSkillCapability | string, allowedTools: string[] = [], loadedAt?: number) {
    this.capabilityOrchestrator.activateSkill(skillOrCapability, allowedTools, loadedAt);
  }

  clearLoadedSkills() {
    this.capabilityOrchestrator.clearLoadedSkills();
  }

  canAccessLoadedSkillResource(skillReference: string, resourcePath: string) {
    return this.capabilityOrchestrator.canAccessLoadedSkillResource(skillReference, resourcePath);
  }

  canRunLoadedSkillScript(skillReference: string, scriptPath: string) {
    return this.capabilityOrchestrator.canRunLoadedSkillScript(skillReference, scriptPath);
  }

  getLoadedSkillCapability(skillReference: string) {
    return this.capabilityOrchestrator.getLoadedSkillCapability(skillReference);
  }

  async chat(
    userInput: string,
    onUpdate?: (update: RuntimeUpdate) => void,
    options?: RuntimeChatOptions
  ): Promise<RuntimeExecutionResult> {
    if (!options?.sessionId) {
      throw new Error('Session id is required for chat runs.');
    }

    await this.refreshPromptIfNeeded();
    if (this.reloadRetainedSkills) {
      const retainedSkills = this.capabilityOrchestrator.getLoadedSkills()
        .filter((skill) => skill.activationSource !== 'automatic');
      if (retainedSkills.length > 0) {
        const refreshedSkills = await this.reloadRetainedSkills(retainedSkills, options.agentId || 'mainAgent');
        this.capabilityOrchestrator.clearLoadedSkills({ activationSource: 'manual' });
        for (const skill of refreshedSkills) {
          this.capabilityOrchestrator.activateSkill(skill);
        }
      }
    }
    this.capabilityOrchestrator.clearLoadedSkills({ activationSource: 'automatic' });
    if (this.resolveInitialSkills) {
      const initialSkills = await this.resolveInitialSkills(userInput, options.agentId || 'mainAgent');
      for (const skill of initialSkills) {
        this.capabilityOrchestrator.activateSkill(skill);
      }
    }
    const userMessage: ChatMessage = {
      role: 'user',
      content: userInput,
      timestamp: Date.now()
    };
    this.history.push(userMessage);

    const run = createRun(options.sessionId, options.agentId || 'mainAgent', userInput, userInput);
    this.runControl.start(run.id);
    const planStep = createRunStep(run.id, 'plan', '接收用户输入', {
      status: 'completed',
      input: {
        userInput
      },
      output: {
        historyLength: this.history.length
      }
    });
    this.persistSnapshot(run.id, {
      iterations: 0,
      lastUserInput: userInput,
      contextSummary: this.buildModelContext(run.id, options.sessionId, {
        consumeRuntimeSupportSummary: false
      }).metadata,
      stepId: planStep.id
    });

    if (isSkillInventoryQuery(userInput)) {
      const content = await buildSkillInventoryResponse(options.agentId || 'mainAgent');
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content,
        timestamp: Date.now()
      };
      this.history.push(assistantMessage);

      const completeStep = createRunStep(run.id, 'complete', '直接返回技能清单', {
        status: 'completed',
        output: {
          content
        }
      });

      updateRun(run.id, {
        status: 'completed',
        finalResponse: content,
        error: null,
        waitingApprovalId: null,
        completedAt: Date.now()
      });

      this.persistSnapshot(run.id, {
        iterations: 0,
        lastUserInput: userInput,
        contextSummary: this.buildModelContext(run.id, options.sessionId, {
          consumeRuntimeSupportSummary: false
        }).metadata,
        stepId: completeStep.id
      });

      this.emitUpdate(onUpdate, {
        type: 'assistant-response',
        content,
        runId: run.id,
        status: 'completed'
      });

      return {
        status: 'completed',
        runId: run.id,
        content
      };
    }

    try {
      return await this.executeRun({
        runId: run.id,
        userInput,
        onUpdate,
        options: {
          ...options,
          runId: run.id
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      updateRun(run.id, {
        status: 'failed',
        error: message,
        waitingApprovalId: null,
        completedAt: Date.now()
      });
      return {
        status: 'failed',
        runId: run.id,
        error: message
      };
    }
  }

  async resumeRun(
    approvalId: string,
    approved: boolean,
    onUpdate?: (update: RuntimeUpdate) => void
  ): Promise<RuntimeExecutionResult> {
    const resumeState = prepareApprovalResume(approvalId, approved);
    if (resumeState.status === 'failed') {
      return resumeState;
    }
    const { approval, run, snapshot, pendingToolCall } = resumeState;

    this.restoreSnapshotState(snapshot);
    this.runControl.start(run.id);

    await resumePendingToolCall({
      tools: this.tools,
      permissionGuard: this.permissionGuard,
      run,
      pendingToolCall,
      approvalArgs: approval.args,
      approved,
      onUpdate,
      auditLog: this.auditLog,
      emitUpdate: (listener, update) => this.emitUpdate(listener, update),
      appendToolMessage: (name, callId, content) => this.appendToolMessage(name, callId, content),
      persistSnapshot: (currentRunId, patch) => this.persistSnapshot(currentRunId, patch),
      buildContextSummary: (currentRunId, sessionId) => this.buildModelContext(currentRunId, sessionId, {
        consumeRuntimeSupportSummary: false
      }).metadata
    });

    this.persistSnapshot(run.id, {
      iterations: snapshot.iterations,
      lastUserInput: snapshot.lastUserInput
    });

    try {
      return await this.executeRun({
        runId: run.id,
        userInput: snapshot.lastUserInput || run.userInput,
        onUpdate,
        options: this.createResumeOptions(run, snapshot.iterations)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      updateRun(run.id, {
        status: 'failed',
        error: message,
        completedAt: Date.now()
      });
      return {
        status: 'failed',
        runId: run.id,
        error: message
      };
    }
  }

  async pauseRun(runId: string) {
    const run = getRunById(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    if (run.status !== 'running') {
      throw new Error(`Run ${runId} is not running.`);
    }

    this.runControl.requestPause(runId);
  }

  async cancelRun(runId: string) {
    const run = getRunById(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    if (run.status === 'waiting_approval' && run.waitingApprovalId) {
      const approval = getApprovalRecord(run.waitingApprovalId);
      resolveApprovalRecord(run.waitingApprovalId, false);
      if (approval?.stepId) {
        updateRunStep(approval.stepId, {
          status: 'cancelled',
          output: {
            approved: false,
            cancelled: true
          },
          metadata: {
            ...(approval.metadata || {}),
            approvalId: approval.id
          }
        });
      }
      const toolStepId = typeof approval?.metadata?.toolStepId === 'string' ? approval.metadata.toolStepId : null;
      const toolRecordId = typeof approval?.metadata?.toolRecordId === 'string' ? approval.metadata.toolRecordId : null;
      if (toolStepId) {
        updateRunStep(toolStepId, {
          status: 'cancelled',
          error: 'Run cancelled by user.'
        });
      }
      if (toolRecordId) {
        updateToolCallRecord(toolRecordId, {
          status: 'cancelled'
        });
      }
      createRunStep(run.id, 'summary', '运行已取消', {
        status: 'cancelled',
        output: {
          reason: 'cancel_requested'
        }
      });
      updateRun(run.id, {
        status: 'cancelled',
        error: 'Run cancelled by user.',
        waitingApprovalId: null,
        completedAt: Date.now()
      });
      this.runControl.clear(runId);
      return;
    }

    if (run.status === 'paused') {
      createRunStep(run.id, 'summary', '运行已取消', {
        status: 'cancelled',
        output: {
          reason: 'cancel_requested'
        }
      });
      updateRun(run.id, {
        status: 'cancelled',
        error: 'Run cancelled by user.',
        waitingApprovalId: null,
        completedAt: Date.now()
      });
      this.runControl.clear(runId);
      return;
    }

    if (run.status !== 'running') {
      throw new Error(`Run ${runId} cannot be cancelled from status ${run.status}.`);
    }

    this.runControl.requestCancel(runId);
  }

  async resumeInterruptedRun(
    runId: string,
    onUpdate?: (update: RuntimeUpdate) => void
  ): Promise<RuntimeExecutionResult> {
    const run = getRunById(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    if (run.status !== 'paused') {
      throw new Error(`Run ${runId} is not paused.`);
    }

    const snapshot = getLatestContextSnapshot<RuntimeSnapshot>(runId);
    if (!snapshot) {
      throw new Error(`Context snapshot not found for run ${runId}`);
    }

    this.restoreSnapshotState(snapshot);
    this.runControl.start(run.id);
    updateRun(run.id, {
      status: 'running',
      error: null,
      waitingApprovalId: null,
      completedAt: null
    });

    return this.executeRun({
      runId: run.id,
      userInput: snapshot.lastUserInput || run.userInput,
      onUpdate,
      options: this.createResumeOptions(run, snapshot.iterations)
    });
  }

  async retryStep(
    runId: string,
    stepId: string,
    onUpdate?: (update: RuntimeUpdate) => void
  ): Promise<RuntimeExecutionResult> {
    const run = getRunById(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    const snapshot = getLatestContextSnapshotByStep<RuntimeSnapshot>(runId, stepId);
    if (!snapshot) {
      throw new Error(`Context snapshot not found for step ${stepId}.`);
    }

    this.restoreSnapshotState(snapshot);
    this.runControl.start(run.id);
    createRunStep(run.id, 'summary', '从检查点重试执行', {
      status: 'completed',
      input: {
        stepId
      }
    });
    updateRun(run.id, {
      status: 'running',
      error: null,
      waitingApprovalId: null,
      completedAt: null
    });

    return this.executeRun({
      runId: run.id,
      userInput: snapshot.lastUserInput || run.userInput,
      onUpdate,
      options: this.createResumeOptions(run, snapshot.iterations)
    });
  }

  private async executeRun(params: {
    runId: string;
    userInput: string;
    onUpdate?: (update: RuntimeUpdate) => void;
    options?: RuntimeChatOptions & { iterations?: number };
  }) {
    const { runId, userInput, onUpdate, options } = params;
    const result = await executeRunEngine({
      llm: this.llm,
      tools: this.capabilityOrchestrator.getExposedTools(),
      runId,
      userInput,
      onUpdate,
      options,
      buildModelContext: (currentRunId, sessionId) => this.buildModelContext(currentRunId, sessionId, {
        consumeRuntimeSupportSummary: true
      }),
      handleToolCall: (params) => handleToolCall({
        ...params,
        onUpdate,
        tools: this.tools,
        permissionGuard: this.permissionGuard,
        auditLog: this.auditLog,
        emitUpdate: (listener, update) => this.emitUpdate(listener, update),
        appendToolMessage: (name, callId, content) => this.appendToolMessage(name, callId, content),
        persistSnapshot: (currentRunId, patch) => this.persistSnapshot(currentRunId, patch),
        buildContextSummary: (currentRunId, sessionId) => this.buildModelContext(currentRunId, sessionId, {
          consumeRuntimeSupportSummary: false
        }).metadata
      }),
      persistSnapshot: (currentRunId, patch) => this.persistSnapshot(currentRunId, patch),
      emitUpdate: (listener, update) => this.emitUpdate(listener, update),
      pushHistory: (message) => {
        this.history.push(message);
      },
      shouldBlockSensitiveDisclosure: (input, output) => shouldBlockSensitiveDisclosure(this.systemPrompt, input, output),
      shouldInterrupt: () => this.runControl.consume(runId)
    });
    this.runControl.reconcile(runId, result.status);
    return result;
  }

  private appendToolMessage(toolName: string, callId: string, content: string) {
    this.history.push({
      role: 'tool',
      content,
      name: toolName,
      tool_call_id: callId,
      timestamp: Date.now()
    });
  }

  private persistSnapshot(
    runId: string,
    patch: RuntimeSnapshotPatch
  ) {
    saveContextSnapshot(runId, {
      systemPrompt: this.systemPrompt,
      history: this.history,
      iterations: patch.iterations,
      lastUserInput: patch.lastUserInput,
      loadedSkills: patch.loadedSkills ?? this.capabilityOrchestrator.getLoadedSkills(),
      contextSummary: patch.contextSummary,
      pendingToolCall: patch.pendingToolCall,
      runtimeSupportSnapshot: this.runtimeSupportState.snapshot()
    } satisfies RuntimeSnapshot, patch.stepId);

    if (patch.contextSummary) {
      saveRunContextSummary(runId, patch.contextSummary, patch.stepId);
    }
  }

  private emitUpdate(onUpdate: ((update: RuntimeUpdate) => void) | undefined, update: RuntimeUpdate) {
    if (onUpdate) {
      onUpdate(update);
    }
  }

  private async refreshPromptIfNeeded() {
    if (!this.refreshSystemPrompt) {
      return;
    }
    const latestSystemPrompt = await this.refreshSystemPrompt();
    if (typeof latestSystemPrompt === 'string' && latestSystemPrompt.trim().length > 0) {
      this.systemPrompt = latestSystemPrompt;
    }
  }

  private resolveAvailableSkillsSummary(
    runId: string,
    sessionId: string | undefined,
    availableSkillsCatalog: SkillCatalogSnapshot | undefined,
    consumeRuntimeSupportSummary: boolean
  ) {
    return this.runtimeSupportState.resolveAvailableSkillsSummary(
      runId,
      sessionId,
      availableSkillsCatalog,
      consumeRuntimeSupportSummary
    );
  }

  private resolveActiveSkillsSummary(
    runId: string,
    sessionId: string | undefined,
    loadedSkills: ReturnType<CapabilityOrchestrator['getLoadedSkills']>,
    consumeRuntimeSupportSummary: boolean
  ) {
    return this.runtimeSupportState.resolveActiveSkillsSummary(
      runId,
      sessionId,
      loadedSkills,
      consumeRuntimeSupportSummary
    );
  }

  private resolveAvailableToolsSummary(
    runId: string,
    sessionId: string | undefined,
    availableToolNames: string[] | undefined,
    consumeToolSummary: boolean
  ) {
    return this.runtimeSupportState.resolveAvailableToolsSummary(
      runId,
      sessionId,
      availableToolNames,
      consumeToolSummary
    );
  }

  private buildModelContext(
    runId: string,
    sessionId?: string,
    options?: { consumeRuntimeSupportSummary?: boolean }
  ): RuntimeModelContext {
    const run = getRunById(runId);
    const runSteps = getRunSteps(runId);
    const pendingApproval = getPendingApproval(sessionId);
    const episodicSummaries = sessionId
      ? getRecentSessionContextSummaries(sessionId, 4, runId)
      : [];
    const loadedSkills = this.capabilityOrchestrator.getLoadedSkills();
    const availableToolNames = this.capabilityOrchestrator.getExposedTools().map((tool) => tool.name);
    const runtimeSupportContext = this.getRuntimeSupportContext?.() || {};
    const activeSkillsSummary = this.resolveActiveSkillsSummary(
      runId,
      sessionId,
      loadedSkills,
      options?.consumeRuntimeSupportSummary === true
    );
    const availableSkillsSummary = this.resolveAvailableSkillsSummary(
      runId,
      sessionId,
      runtimeSupportContext.availableSkillsCatalog,
      options?.consumeRuntimeSupportSummary === true
    );
    const availableToolsSummary = this.resolveAvailableToolsSummary(
      runId,
      sessionId,
      availableToolNames,
      options?.consumeRuntimeSupportSummary === true
    );

    return assembleRuntimeContext({
      systemPrompt: this.systemPrompt,
      workspace: this.workspace,
      history: this.history,
      activeSkillsSummary,
      loadedSkills,
      availableSkillsSummary,
      availableToolsSummary,
      run,
      runSteps,
      pendingApproval,
      episodicSummaries
    });
  }
}
