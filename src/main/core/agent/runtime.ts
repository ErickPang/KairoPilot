import { cancelSuspendedRun } from './cancelSuspendedRun';
import { withReferenceContext } from '../context/references';
import {
  createRun,
  createRunStep,
  getLatestContextSnapshot,
  getLatestContextSnapshotByStep,
  getRecentSessionContextSummaries,
  getPendingApproval,
  getApprovalRecord,
  getRunById,
  getRunSteps,
  saveContextSnapshot,
  saveRunContextSummary,
  updateRun
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
import { checkPermission, createPermissionGuardedTool } from './toolPipeline';
import type { ApprovalDecisionScope } from '../../../shared/contracts';
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
import { formatAttachmentContext } from '../../store/attachments';

import type {DeferredToolSelection} from '../plugins/discovery';

interface RuntimeSupportContext {
  availableSkillsCatalog?: SkillCatalogSnapshot;
  availablePluginsSummary?: string;
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
  private activeSessionId: string | null = null;
  private activeRunId: string | null = null;
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
  private deferredToolLoader?: (selection:DeferredToolSelection)=>Promise<unknown>;
  setDeferredToolLoader(loader:(selection:DeferredToolSelection)=>Promise<unknown>){this.deferredToolLoader=loader;}
  private clearDeferredTools(){for(const [name,tool] of this.tools)if(tool.metadata?.source==='plugin'){this.tools.delete(name);this.capabilityOrchestrator.unregisterTool(name);}}
  private async restoreDeferredTools(snapshot:RuntimeSnapshot){this.clearDeferredTools();for(const item of snapshot.deferredTools||[])await this.deferredToolLoader?.(item);}
  private cachedSystemPrompt: string | null = null;
  private lastPromptFingerprint: string | null = null;

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
    private agentMemoryWorkspace: string = workspace
  ) {
    this.llm = llm;
    this.systemPrompt = systemPrompt;
    this.workspace = workspace;
    this.permissionGuard = permissionGuard;
    this.auditLog = auditLog;
    this.refreshSystemPrompt = refreshSystemPrompt;
    this.getRuntimeSupportContext = getRuntimeSupportContext;
    this.resolveInitialSkills = resolveInitialSkills;
    this.tools = new Map();
    this.capabilityOrchestrator = new CapabilityOrchestrator(permissionGuard);
  }

  registerTool(tool: ToolDefinition) {
    const guardedTool = createPermissionGuardedTool(tool, this.permissionGuard);
    this.tools.set(guardedTool.name, guardedTool);
    this.capabilityOrchestrator.registerTool(guardedTool);
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

  getActiveSessionId() {
    return this.activeSessionId;
  }

  activateLoadedSkill(skillOrCapability: LoadedSkillCapability | string, allowedTools: string[] = [], loadedAt?: number) {
    this.capabilityOrchestrator.activateSkill(skillOrCapability, allowedTools, loadedAt);
    const skillReference = typeof skillOrCapability === 'string'
      ? skillOrCapability
      : skillOrCapability.skillId || skillOrCapability.skillName;
    const loadedSkill = this.capabilityOrchestrator.getLoadedSkillCapability(skillReference);
    if (loadedSkill) {
      this.recordSkillActivation(loadedSkill);
    }
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

  getActiveRunId() {
    return this.activeRunId;
  }

  async chat(
    userInput: string,
    onUpdate?: (update: RuntimeUpdate) => void,
    options?: RuntimeChatOptions
  ): Promise<RuntimeExecutionResult> {
    if (!options?.sessionId) {
      throw new Error('Session id is required for chat runs.');
    }
    this.activeSessionId = options.sessionId;

    this.clearDeferredTools();
    await this.refreshPromptIfNeeded();
    this.capabilityOrchestrator.clearLoadedSkills();
    const attachments = Array.isArray(options.attachments) ? options.attachments : [];
    const attachmentContext = formatAttachmentContext(attachments);
    const modelUserInput = attachmentContext ? `${attachmentContext}\n\n${userInput}` : userInput;
    const userMessage: ChatMessage = {
      role: 'user',
      content: modelUserInput,
      attachments,
      references: options.references,
      timestamp: Date.now()
    };
    this.history.push(userMessage);

    const run = createRun(options.sessionId, options.agentId || 'mainAgent', userInput, userInput, options.executionContext || {
      agentId: options.agentId || 'mainAgent', agentWorkspace: this.agentMemoryWorkspace,
      executionRoot: this.workspace, model: this.llm.config?.model || '', provider: this.llm.config?.provider || 'custom', permissionsHash: ''
    });
    this.activeRunId = run.id;
    this.runControl.start(run.id);
    try {
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

    options.onAccepted?.();

    let initialSkillsLoaded = false;
    if (this.resolveInitialSkills) {
      const initialSkills = await this.resolveInitialSkills(userInput, options.agentId || 'mainAgent');
      for (const skill of initialSkills) {
        this.activateLoadedSkill(skill);
      }
      initialSkillsLoaded = initialSkills.length > 0;
    }
    if (initialSkillsLoaded) {
      this.persistSnapshot(run.id, {
        iterations: 0,
        lastUserInput: userInput,
        contextSummary: this.buildModelContext(run.id, options.sessionId, {
          consumeRuntimeSupportSummary: false
        }).metadata
      });
    }

      return await this.executeRun({
        runId: run.id,
        userInput: modelUserInput,
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
      this.runControl.reconcile(run.id, 'failed');
      this.emitUpdate(onUpdate, { type: 'run-failed', runId: run.id, status: 'failed', error: message });
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
    onUpdate?: (update: RuntimeUpdate) => void,
    scope: ApprovalDecisionScope = 'once'
  ): Promise<RuntimeExecutionResult> {
    if (scope === 'session') {
      const approval = getApprovalRecord(approvalId);
      if (!approved || !approval || !this.permissionGuard.getSessionApprovalScope(approval.toolName, approval.args)) throw new Error('This approval does not support conversation permission.');
    }
    const resumeState = prepareApprovalResume(approvalId, approved);
    if (resumeState.status === 'failed') {
      return resumeState;
    }
    const { approval, run, snapshot, pendingToolCall } = resumeState;

    this.restoreSnapshotState(snapshot);
    await this.restoreDeferredTools(snapshot);
    this.activeRunId = run.id;
    this.activeSessionId = run.sessionId || this.activeSessionId;
    this.runControl.start(run.id);

    if (scope === 'session' && this.tools.has(pendingToolCall.toolName) && checkPermission(this.permissionGuard, pendingToolCall.toolName, approval.args).kind !== 'deny') {
      this.permissionGuard.rememberSessionApproval(pendingToolCall.toolName, approval.args, approval.id);
      this.auditLog?.({ tool: pendingToolCall.toolName, args: approval.args, sessionId: run.sessionId, runId: run.id, policyTags: ['approval:session_granted'], result: { approvalId: approval.id } });
    }

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

    if (run.status !== 'running') { cancelSuspendedRun(runId); this.runControl.clear(runId); return; }

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
    await this.restoreDeferredTools(snapshot);
    this.activeRunId = run.id;
    this.activeSessionId = run.sessionId || this.activeSessionId;
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

    if (run.status !== 'failed' || run.error?.startsWith('RUN_INTERRUPTED_BY_RESTART:')) {
      throw new Error('Only failed, non-interrupted runs can retry a checkpoint.');
    }

    const snapshot = getLatestContextSnapshotByStep<RuntimeSnapshot>(runId, stepId);
    if (!snapshot) {
      throw new Error(`Context snapshot not found for step ${stepId}.`);
    }

    this.restoreSnapshotState(snapshot);
    await this.restoreDeferredTools(snapshot);
    this.activeRunId = run.id;
    this.activeSessionId = run.sessionId || this.activeSessionId;
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
      getTools: () => this.capabilityOrchestrator.getExposedTools(),
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
        shouldInterrupt: () => this.runControl.consume(runId),
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
        this.history.push({...message,timestamp:message.timestamp || Date.now()});
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
      runtimeSupportSnapshot: this.runtimeSupportState.snapshot(),
      deferredTools: Array.from(this.tools.values()).filter(tool=>tool.metadata?.source==='plugin').map(tool=>({pluginId:tool.metadata!.pluginId!,scope:tool.metadata!.pluginScope!,names:[tool.metadata!.originalToolName||tool.name]}))
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

  private recordSkillActivation(skill: LoadedSkillCapability) {
    if (!this.activeRunId) {
      return;
    }

    const payload = {
      skillId: skill.skillId || skill.skillName,
      skillName: skill.skillName,
      contentHash: skill.contentHash,
      source: skill.source,
      activationSource: skill.activationSource || 'manual',
      resolverScore: skill.resolverScore,
      resolverReasons: skill.resolverReasons ?? [],
      explicitMention: skill.explicitMention,
      executionMode: skill.executionMode || 'inline',
      allowedTools: skill.allowedTools,
      resolvedArguments: skill.resolvedArguments ?? {},
      resources: skill.resourcePaths ?? [],
      scripts: skill.scriptPaths ?? []
    };

    const step = createRunStep(this.activeRunId, 'summary', `激活技能 ${skill.skillName}`, {
      status: 'completed',
      output: payload,
      metadata: {
        kind: 'skill_activation',
        skillId: payload.skillId,
        activationSource: payload.activationSource,
        contentHash: payload.contentHash
      }
    });

    this.auditLog?.({
      tool: 'skill_activation',
      args: payload,
      result: {
        status: 'loaded'
      },
      policyTags: [
        'policy:skill_used',
        'tool_category:skill',
        `skill:${payload.skillId}`,
        `activation:${payload.activationSource}`
      ],
      sessionId: this.activeSessionId || undefined,
      runId: this.activeRunId,
      stepId: step.id
    });
  }

  private async refreshPromptIfNeeded() {
    if (!this.refreshSystemPrompt) {
      return;
    }
    const latestSystemPrompt = await this.refreshSystemPrompt();
    if (typeof latestSystemPrompt !== 'string' || latestSystemPrompt.trim().length === 0) {
      return;
    }
    // 基于内容指纹缓存：相同内容跳过 systemPrompt 更新与 orchestra 重建
    const fingerprint = latestSystemPrompt.trim();
    if (this.cachedSystemPrompt === fingerprint && this.lastPromptFingerprint !== null) {
      return;
    }
    this.cachedSystemPrompt = fingerprint;
    this.lastPromptFingerprint = fingerprint;
    this.systemPrompt = fingerprint;
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
    // 可用技能列表必须始终可见，不使用 delta 追踪避免后续迭代丢失
    const availableSkillsSummary = runtimeSupportContext.availableSkillsCatalog?.fullSummary||'';
    const availableToolsSummary = [this.resolveAvailableToolsSummary(
      runId,
      sessionId,
      availableToolNames,
      options?.consumeRuntimeSupportSummary === true
    ),runtimeSupportContext.availablePluginsSummary].filter(Boolean).join('\n');

    const capabilities = this.llm.getCapabilities();
    const modelContextWindowTokens = typeof capabilities.contextWindowTokens === 'number' && capabilities.contextWindowTokens > 0
      ? capabilities.contextWindowTokens
      : undefined;

    return assembleRuntimeContext({
      systemPrompt: this.systemPrompt,
      workspace: this.workspace,
      memoryWorkspace: this.agentMemoryWorkspace,
      canReadWorkspacePath: (target) => run?.executionContext?.phase!=='planning' && this.permissionGuard.checkFileSystem(target, 'read'),
      history: this.history.map((message) => withReferenceContext(message, (target) => this.permissionGuard.checkFileSystem(target, 'read'))),
      activeSkillsSummary,
      loadedSkills,
      availableSkillsSummary,
      availableToolsSummary,
      availableToolNames,
      run,
      runSteps,
      pendingApproval,
      episodicSummaries,
      modelContextWindowTokens,
      tools: this.capabilityOrchestrator.getExposedTools()
    });
  }
}
