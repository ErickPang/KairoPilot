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
  buildAvailableSkillsPromptSummary,
  computeActiveSkillsUpdate,
  computeToolCatalogUpdate,
  computeSkillCatalogUpdate,
  createActiveSkillsSnapshot,
  createToolCatalogSnapshot,
  SessionActiveSkillState,
  RuntimeSupportSnapshot,
  SessionSkillCatalogState,
  SessionToolCatalogState,
  SkillCatalogSnapshot,
  shouldBlockSensitiveDisclosure
} from './runtimeHelpers';
import {
  handleToolCall,
  resumePendingToolCall
} from './toolCallCoordinator';
import { CapabilityOrchestrator } from './capabilityOrchestrator';

interface RuntimeSupportContext {
  availableSkillsCatalog?: SkillCatalogSnapshot;
}

export class AgentRuntime {
  private llm: LLMProvider;
  private tools: Map<string, ToolDefinition>;
  private capabilityOrchestrator: CapabilityOrchestrator;
  private history: ChatMessage[] = [];
  private systemPrompt: string;
  private workspace: string;
  private permissionGuard: PermissionGuard;
  private runControls = new Map<string, { pauseRequested: boolean; cancelRequested: boolean }>();
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
  private sessionActiveSkillStates = new Map<string, SessionActiveSkillState>();
  private sessionSkillCatalogStates = new Map<string, SessionSkillCatalogState>();
  private sessionToolCatalogStates = new Map<string, SessionToolCatalogState>();

  private restoreSnapshotState(snapshot: RuntimeSnapshot) {
    this.systemPrompt = snapshot.systemPrompt || this.systemPrompt;
    this.history = Array.isArray(snapshot.history) ? snapshot.history : [];
    this.capabilityOrchestrator.setLoadedSkills(Array.isArray(snapshot.loadedSkills) ? snapshot.loadedSkills : []);
    this.setRuntimeSupportSnapshot(snapshot.runtimeSupportSnapshot);
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
    getRuntimeSupportContext?: () => RuntimeSupportContext
  ) {
    this.llm = llm;
    this.systemPrompt = systemPrompt;
    this.workspace = workspace;
    this.permissionGuard = permissionGuard;
    this.auditLog = auditLog;
    this.refreshSystemPrompt = refreshSystemPrompt;
    this.getRuntimeSupportContext = getRuntimeSupportContext;
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

  setHistory(history: ChatMessage[]) {
    this.history = history;
  }

  activateLoadedSkill(skillName: string, allowedTools: string[], loadedAt?: number) {
    this.capabilityOrchestrator.activateSkill(skillName, allowedTools, loadedAt);
  }

  clearLoadedSkills() {
    this.capabilityOrchestrator.clearLoadedSkills();
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
    this.clearLoadedSkills();
    const userMessage: ChatMessage = {
      role: 'user',
      content: userInput,
      timestamp: Date.now()
    };
    this.history.push(userMessage);

    const run = createRun(options.sessionId, options.agentId || 'mainAgent', userInput, userInput);
    this.runControls.set(run.id, {
      pauseRequested: false,
      cancelRequested: false
    });
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
    this.runControls.set(run.id, {
      pauseRequested: false,
      cancelRequested: false
    });

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

    const current = this.runControls.get(runId) || {
      pauseRequested: false,
      cancelRequested: false
    };
    current.pauseRequested = true;
    this.runControls.set(runId, current);
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
      this.runControls.delete(runId);
      return;
    }

    const current = this.runControls.get(runId) || {
      pauseRequested: false,
      cancelRequested: false
    };
    current.cancelRequested = true;
    this.runControls.set(runId, current);
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
    this.runControls.set(run.id, {
      pauseRequested: false,
      cancelRequested: false
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
    this.runControls.set(run.id, {
      pauseRequested: false,
      cancelRequested: false
    });
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
      shouldInterrupt: () => this.consumeInterruptSignal(runId)
    });
    if (result.status !== 'waiting_approval' && result.status !== 'paused') {
      this.runControls.delete(runId);
    }
    if (result.status === 'paused') {
      const current = this.runControls.get(runId);
      if (current) {
        current.pauseRequested = false;
        this.runControls.set(runId, current);
      }
    }
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
      runtimeSupportSnapshot: this.getRuntimeSupportSnapshot()
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

  private consumeInterruptSignal(runId: string) {
    const control = this.runControls.get(runId);
    if (!control) {
      return null;
    }
    if (control.cancelRequested) {
      control.cancelRequested = false;
      this.runControls.set(runId, control);
      return {
        kind: 'cancel' as const,
        reason: 'Run cancelled by user.'
      };
    }
    if (control.pauseRequested) {
      control.pauseRequested = false;
      this.runControls.set(runId, control);
      return {
        kind: 'pause' as const,
        reason: 'Run paused by user.'
      };
    }
    return null;
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

  private getRuntimeSupportSessionKey(runId: string, sessionId?: string) {
    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    return normalizedSessionId || `run:${runId}`;
  }

  private getRuntimeSupportSnapshot(): RuntimeSupportSnapshot | undefined {
    if (
      this.sessionActiveSkillStates.size === 0
      && this.sessionSkillCatalogStates.size === 0
      && this.sessionToolCatalogStates.size === 0
    ) {
      return undefined;
    }

    return {
      activeSkillSessions: Object.fromEntries(this.sessionActiveSkillStates.entries()),
      skillCatalogSessions: Object.fromEntries(this.sessionSkillCatalogStates.entries()),
      toolCatalogSessions: Object.fromEntries(this.sessionToolCatalogStates.entries())
    };
  }

  private setRuntimeSupportSnapshot(snapshot?: RuntimeSupportSnapshot) {
    this.sessionActiveSkillStates.clear();
    this.sessionSkillCatalogStates.clear();
    this.sessionToolCatalogStates.clear();
    const activeSkillSessions = snapshot?.activeSkillSessions;
    if (activeSkillSessions) {
      for (const [key, value] of Object.entries(activeSkillSessions)) {
        if (!value || typeof value.fingerprint !== 'string' || !Array.isArray(value.announcedSkillNames)) {
          continue;
        }
        this.sessionActiveSkillStates.set(key, {
          fingerprint: value.fingerprint,
          announcedSkillNames: value.announcedSkillNames
            .map((skillName) => String(skillName).trim())
            .filter(Boolean)
        });
      }
    }

    const skillCatalogSessions = snapshot?.skillCatalogSessions;
    if (skillCatalogSessions) {
      for (const [key, value] of Object.entries(skillCatalogSessions)) {
        if (!value || typeof value.fingerprint !== 'string' || !Array.isArray(value.announcedSkillIds)) {
          continue;
        }
        this.sessionSkillCatalogStates.set(key, {
          fingerprint: value.fingerprint,
          announcedSkillIds: value.announcedSkillIds
            .map((skillId) => String(skillId).trim())
            .filter(Boolean)
        });
      }
    }

    const toolCatalogSessions = snapshot?.toolCatalogSessions;
    if (!toolCatalogSessions) {
      return;
    }

    for (const [key, value] of Object.entries(toolCatalogSessions)) {
      if (!value || typeof value.fingerprint !== 'string' || !Array.isArray(value.announcedToolNames)) {
        continue;
      }
      this.sessionToolCatalogStates.set(key, {
        fingerprint: value.fingerprint,
        announcedToolNames: value.announcedToolNames
          .map((toolName) => String(toolName).trim())
          .filter(Boolean)
      });
    }
  }

  private resolveAvailableSkillsSummary(
    runId: string,
    sessionId: string | undefined,
    availableSkillsCatalog: SkillCatalogSnapshot | undefined,
    consumeRuntimeSupportSummary: boolean
  ) {
    const sessionKey = this.getRuntimeSupportSessionKey(runId, sessionId);
    const currentState = this.sessionSkillCatalogStates.get(sessionKey);
    const update = computeSkillCatalogUpdate(availableSkillsCatalog, currentState);
    if (consumeRuntimeSupportSummary && update.nextState) {
      this.sessionSkillCatalogStates.set(sessionKey, update.nextState);
    }
    return buildAvailableSkillsPromptSummary(availableSkillsCatalog);
  }

  private resolveActiveSkillsSummary(
    runId: string,
    sessionId: string | undefined,
    loadedSkills: ReturnType<CapabilityOrchestrator['getLoadedSkills']>,
    consumeRuntimeSupportSummary: boolean
  ) {
    const sessionKey = this.getRuntimeSupportSessionKey(runId, sessionId);
    const currentState = this.sessionActiveSkillStates.get(sessionKey);
    const activeSkillSnapshot = createActiveSkillsSnapshot(loadedSkills);
    const update = computeActiveSkillsUpdate(activeSkillSnapshot, currentState);
    if (consumeRuntimeSupportSummary && update.nextState) {
      this.sessionActiveSkillStates.set(sessionKey, update.nextState);
    }
    return update.summary;
  }

  private resolveAvailableToolsSummary(
    runId: string,
    sessionId: string | undefined,
    availableToolNames: string[] | undefined,
    consumeToolSummary: boolean
  ) {
    const sessionKey = this.getRuntimeSupportSessionKey(runId, sessionId);
    const currentState = this.sessionToolCatalogStates.get(sessionKey);
    const toolCatalogSnapshot = createToolCatalogSnapshot(availableToolNames || []);
    const update = computeToolCatalogUpdate(toolCatalogSnapshot, currentState);
    if (consumeToolSummary && update.nextState) {
      this.sessionToolCatalogStates.set(sessionKey, update.nextState);
    }
    return update.summary;
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
