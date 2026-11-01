import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextAssemblyMetadata } from '../context/assembler';

type RuntimeSnapshot = {
  systemPrompt: string;
  history: Array<{ role: string; content: string; timestamp: number }>;
  iterations: number;
  lastUserInput: string;
  contextSummary?: ContextAssemblyMetadata;
  pendingToolCall?: {
    callId: string;
    toolName: string;
    args: Record<string, unknown>;
    toolRecordId?: string;
    toolStepId?: string;
    approvalStepId?: string;
  };
};

const chatState = vi.hoisted(() => {
  let sequence = 0;

  const state = {
    sessions: new Map<string, Record<string, unknown>>(),
    runs: new Map<string, Record<string, unknown>>(),
    runSteps: new Map<string, Record<string, unknown>>(),
    toolCallRecords: new Map<string, Record<string, unknown>>(),
    approvals: new Map<string, Record<string, unknown>>(),
    contextSnapshots: [] as Array<Record<string, unknown>>,
    contextSummaries: [] as Array<Record<string, unknown>>,
    nextId(prefix: string) {
      sequence += 1;
      return `${prefix}-${sequence}`;
    },
    reset() {
      sequence = 0;
      this.sessions.clear();
      this.runs.clear();
      this.runSteps.clear();
      this.toolCallRecords.clear();
      this.approvals.clear();
      this.contextSnapshots = [];
      this.contextSummaries = [];
    }
  };

  return state;
});

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function touchRun(runId: string, updatedAt: number) {
  const run = chatState.runs.get(runId);
  if (!run) {
    return;
  }

  run.updatedAt = updatedAt;
  const sessionId = run.sessionId as string | undefined;
  if (sessionId) {
    const session = chatState.sessions.get(sessionId);
    if (session) {
      session.updatedAt = updatedAt;
    }
  }
}

function getRunStepsForRun(runId: string) {
  return [...chatState.runSteps.values()]
    .filter((step) => step.runId === runId)
    .sort((left, right) => Number(left.stepIndex) - Number(right.stepIndex));
}

vi.mock('../../store/chat', () => ({
  createSession(title = 'New Chat', agentId = 'mainAgent') {
    const now = Date.now();
    const session = {
      id: chatState.nextId('session'),
      title,
      agentId,
      messages: [],
      createdAt: now,
      updatedAt: now
    };
    chatState.sessions.set(session.id, session);
    return clone(session);
  },

  createRun(sessionId: string, agentId: string, goal: string, userInput?: string) {
    const now = Date.now();
    const run = {
      id: chatState.nextId('run'),
      sessionId,
      agentId,
      goal,
      userInput: userInput || goal,
      status: 'running',
      finalResponse: null,
      error: null,
      waitingApprovalId: null,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      completedAt: null
    };
    chatState.runs.set(run.id, run);
    touchRun(run.id, now);
    return clone(run);
  },

  getRunById(runId: string) {
    const run = chatState.runs.get(runId);
    return run ? clone(run) : null;
  },

  updateRun(runId: string, patch: Record<string, unknown>) {
    const run = chatState.runs.get(runId);
    if (!run) {
      return null;
    }

    const now = Date.now();
    Object.assign(run, patch);
    run.updatedAt = now;
    touchRun(runId, now);
    return clone(run);
  },

  createRunStep(runId: string, type: string, title: string, options: Record<string, unknown> = {}) {
    const now = Date.now();
    const step = {
      id: chatState.nextId('step'),
      runId,
      stepIndex: getRunStepsForRun(runId).length,
      type,
      title,
      status: options.status || 'pending',
      input: options.input,
      output: options.output,
      error: options.error || null,
      metadata: options.metadata,
      createdAt: now,
      updatedAt: now
    };
    chatState.runSteps.set(step.id, step);
    touchRun(runId, now);
    return clone(step);
  },

  updateRunStep(stepId: string, patch: Record<string, unknown>) {
    const step = chatState.runSteps.get(stepId);
    if (!step) {
      return null;
    }

    const now = Date.now();
    Object.assign(step, patch);
    step.updatedAt = now;
    touchRun(step.runId as string, now);
    return clone(step);
  },

  createToolCallRecord(runId: string, stepId: string | null, toolName: string, args: unknown) {
    const now = Date.now();
    const record = {
      id: chatState.nextId('tool'),
      runId,
      stepId,
      toolName,
      args,
      result: null,
      error: null,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      order: chatState.toolCallRecords.size
    };
    chatState.toolCallRecords.set(record.id, record);
    touchRun(runId, now);
    return record.id;
  },

  updateToolCallRecord(recordId: string, patch: Record<string, unknown>) {
    const record = chatState.toolCallRecords.get(recordId);
    if (!record) {
      return;
    }

    const now = Date.now();
    Object.assign(record, patch);
    record.updatedAt = now;
    touchRun(record.runId as string, now);
  },

  getToolCallRecords(runId: string) {
    return [...chatState.toolCallRecords.values()]
      .filter((record) => record.runId === runId)
      .sort((left, right) => Number(left.createdAt) - Number(right.createdAt))
      .map((record) => clone(record));
  },

  createApprovalRecord(args: {
    runId: string;
    stepId?: string;
    sessionId?: string;
    toolName: string;
    toolArgs: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }) {
    const now = Date.now();
    const approval = {
      id: chatState.nextId('approval'),
      runId: args.runId,
      stepId: args.stepId || null,
      sessionId: args.sessionId || null,
      toolName: args.toolName,
      args: args.toolArgs,
      status: 'pending',
      metadata: args.metadata || null,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
      order: chatState.approvals.size
    };
    chatState.approvals.set(approval.id, approval);
    touchRun(args.runId, now);
    return clone(approval);
  },

  getApprovalRecord(approvalId: string) {
    const approval = chatState.approvals.get(approvalId);
    return approval ? clone(approval) : null;
  },

  resolveApprovalRecord(approvalId: string, approved: boolean) {
    const approval = chatState.approvals.get(approvalId);
    if (!approval) {
      return null;
    }

    const now = Date.now();
    approval.status = approved ? 'approved' : 'denied';
    approval.updatedAt = now;
    approval.resolvedAt = now;
    touchRun(approval.runId as string, now);
    return clone(approval);
  },

  getPendingApproval(sessionId?: string) {
    const approvals = [...chatState.approvals.values()]
      .filter((approval) => approval.status === 'pending' && (!sessionId || approval.sessionId === sessionId))
      .sort((left, right) => {
        const updatedDelta = Number(right.updatedAt) - Number(left.updatedAt);
        if (updatedDelta !== 0) {
          return updatedDelta;
        }
        const createdDelta = Number(right.createdAt) - Number(left.createdAt);
        if (createdDelta !== 0) {
          return createdDelta;
        }
        return Number(right.order) - Number(left.order);
      });

    return approvals[0] ? clone(approvals[0]) : null;
  },

  saveContextSnapshot(runId: string, snapshot: RuntimeSnapshot, stepId?: string) {
    const entry = {
      id: chatState.nextId('snapshot'),
      runId,
      stepId: stepId || null,
      snapshot: clone(snapshot),
      createdAt: Date.now()
    };
    chatState.contextSnapshots.push(entry);
    touchRun(runId, entry.createdAt as number);
  },

  getLatestContextSnapshot(runId: string) {
    const snapshots = chatState.contextSnapshots
      .filter((entry) => entry.runId === runId)
      .sort((left, right) => Number(right.createdAt) - Number(left.createdAt));
    return snapshots[0] ? clone(snapshots[0].snapshot) : null;
  },

  saveRunContextSummary(runId: string, summary: ContextAssemblyMetadata, stepId?: string) {
    const run = chatState.runs.get(runId);
    const entry = {
      id: chatState.nextId('summary'),
      runId,
      sessionId: (run?.sessionId as string | undefined) || null,
      stepId: stepId || null,
      createdAt: Date.now(),
      ...summary
    };
    chatState.contextSummaries.push(entry);
    touchRun(runId, entry.createdAt as number);
  },

  getLatestRunContextSummary(runId: string) {
    const summaries = chatState.contextSummaries
      .filter((entry) => entry.runId === runId)
      .sort((left, right) => Number(right.createdAt) - Number(left.createdAt));
    return summaries[0] ? clone(summaries[0]) : null;
  },

  getRunTrace(query: { runId: string }) {
    const run = chatState.runs.get(query.runId);
    if (!run) {
      return null;
    }

    const steps = getRunStepsForRun(query.runId).map((step) => clone(step));
    const toolCalls = [...chatState.toolCallRecords.values()]
      .filter((record) => record.runId === query.runId)
      .map((record) => clone(record));
    const approvals = [...chatState.approvals.values()]
      .filter((approval) => approval.runId === query.runId)
      .map((approval) => clone(approval));

    return {
      run: clone(run),
      steps,
      total: steps.length,
      page: 1,
      pageSize: steps.length || 1,
      totalPages: 1,
      toolCalls,
      approvals,
      auditLogs: [],
      latestContextSummary: [...chatState.contextSummaries.values()]
        .filter((entry) => entry.runId === query.runId)
        .sort((left, right) => Number(right.createdAt) - Number(left.createdAt))[0] || null,
      aggregations: {
        toolCallCount: toolCalls.length,
        approvalCount: approvals.length
      }
    };
  }
}));

import * as chat from '../../store/chat';
import * as approvalCoordinator from './approvalCoordinator';

function createContextSummary(overrides: Partial<ContextAssemblyMetadata> = {}): ContextAssemblyMetadata {
  return {
    activeTaskSummary: 'task',
    activeSkillsSummary: '',
    availableSkillsSummary: '',
    availableToolsSummary: 'read_file',
    compactedHistorySummary: '',
    unresolvedApprovals: '',
    selectedToolResults: '',
    workspaceRetrieval: '',
    memoryDigest: '',
    layers: [],
    recentMessageCount: 1,
    omittedMessageCount: 0,
    budget: {
      maxContextChars: 1000,
      systemPromptChars: 100,
      supportChars: 200,
      recentHistoryChars: 300,
      totalChars: 600
    },
    ...overrides
  };
}

describe('approvalCoordinator integration', () => {
  beforeEach(() => {
    chatState.reset();
  });

  it('串联审批创建、快照落库、审批恢复与 trace 查询', () => {
    const session = chat.createSession('Approval Flow', 'agent-1');
    const run = chat.createRun(session.id, 'agent-1', 'delete file');
    const toolStep = chat.createRunStep(run.id, 'tool_call', '调用工具 delete_file', {
      status: 'running',
      input: {
        tool: 'delete_file',
        args: { path: '/tmp/demo.txt' },
        callId: 'call-1'
      }
    });
    const toolRecordId = chat.createToolCallRecord(run.id, toolStep.id, 'delete_file', { path: '/tmp/demo.txt' });
    const summary = createContextSummary({
      unresolvedApprovals: 'delete_file /tmp/demo.txt'
    });
    const emittedUpdates: unknown[] = [];

    const { approvalId } = approvalCoordinator.createApprovalRequest({
      runId: run.id,
      sessionId: session.id,
      toolName: 'delete_file',
      args: { path: '/tmp/demo.txt' },
      displayArgs: { path: '/tmp/demo.txt' },
      riskLevel: 'high',
      approvalMode: 'always',
      policyTags: ['tool:delete_file', 'risk:high'],
      redacted: false,
      callId: 'call-1',
      toolRecordId,
      toolStepId: toolStep.id,
      iterations: 2,
      lastUserInput: 'delete file',
      contextSummary: summary,
      persistSnapshot: (patch) => {
        chat.saveContextSnapshot(run.id, {
          systemPrompt: 'system',
          history: [{ role: 'user', content: 'delete file', timestamp: 1 }],
          iterations: patch.iterations,
          lastUserInput: patch.lastUserInput,
          contextSummary: patch.contextSummary,
          pendingToolCall: patch.pendingToolCall
        }, patch.stepId);
      },
      emitUpdate: (update) => {
        emittedUpdates.push(update);
      }
    });

    chat.saveRunContextSummary(run.id, summary, chat.getApprovalRecord(approvalId)?.stepId);

    expect(chat.getRunById(run.id)?.status).toBe('waiting_approval');
    expect(chat.getPendingApproval(session.id)?.id).toBe(approvalId);
    expect(chat.getToolCallRecords(run.id)).toEqual([
      expect.objectContaining({
        id: toolRecordId,
        status: 'waiting_approval'
      })
    ]);
    expect(chat.getLatestContextSnapshot<RuntimeSnapshot>(run.id)).toEqual(expect.objectContaining({
      lastUserInput: 'delete file',
      pendingToolCall: {
        callId: 'call-1',
        toolName: 'delete_file',
        args: { path: '/tmp/demo.txt' },
        toolRecordId,
        toolStepId: toolStep.id,
        approvalStepId: chat.getApprovalRecord(approvalId)?.stepId
      }
    }));
    expect(emittedUpdates).toEqual([
      expect.objectContaining({
        type: 'approval-required',
        approvalId,
        runId: run.id,
        sessionId: session.id
      })
    ]);

    const resumed = approvalCoordinator.prepareApprovalResume(approvalId, true);

    expect(resumed).toEqual(expect.objectContaining({
      status: 'ready',
      pendingToolCall: {
        callId: 'call-1',
        toolName: 'delete_file',
        args: { path: '/tmp/demo.txt' },
        toolRecordId,
        toolStepId: toolStep.id,
        approvalStepId: chat.getApprovalRecord(approvalId)?.stepId
      }
    }));
    if (resumed.status === 'ready') {
      expect(resumed.run).toEqual(expect.objectContaining({
        id: run.id,
        status: 'waiting_approval',
        waitingApprovalId: approvalId
      }));
      expect(resumed.snapshot).toEqual(expect.objectContaining({
        lastUserInput: 'delete file'
      }));
    }
    expect(chat.getRunById(run.id)).toEqual(expect.objectContaining({
      id: run.id,
      status: 'running',
      waitingApprovalId: null
    }));
    expect(chat.getApprovalRecord(approvalId)?.status).toBe('approved');
    expect(chat.getPendingApproval(session.id)).toBeNull();

    const trace = chat.getRunTrace({
      runId: run.id,
      page: 1,
      pageSize: 20,
      includeToolCalls: true,
      includeApprovalRecords: true,
      includeAuditLogs: false,
      includeContextSummary: true
    });

    expect(trace).toEqual(expect.objectContaining({
      run: expect.objectContaining({
        id: run.id,
        status: 'running'
      }),
      toolCalls: [
        expect.objectContaining({
          id: toolRecordId,
          status: 'waiting_approval'
        })
      ],
      approvals: [
        expect.objectContaining({
          id: approvalId,
          status: 'approved'
        })
      ],
      latestContextSummary: expect.objectContaining({
        runId: run.id,
        unresolvedApprovals: 'delete_file /tmp/demo.txt'
      }),
      aggregations: expect.objectContaining({
        toolCallCount: 1,
        approvalCount: 1
      })
    }));
  });

  it('缺少待恢复快照时会将 run 标记为失败', () => {
    const session = chat.createSession('Broken Approval', 'agent-2');
    const run = chat.createRun(session.id, 'agent-2', 'dangerous task');
    const approvalStep = chat.createRunStep(run.id, 'approval_wait', '等待确认 delete_file', {
      status: 'waiting_approval'
    });
    const approval = chat.createApprovalRecord({
      runId: run.id,
      sessionId: session.id,
      stepId: approvalStep.id,
      toolName: 'delete_file',
      toolArgs: { path: '/tmp/missing.txt' }
    });
    chat.updateRun(run.id, {
      status: 'waiting_approval',
      waitingApprovalId: approval.id
    });

    expect(() => approvalCoordinator.prepareApprovalResume(approval.id, false)).toThrow(
      `Context snapshot not found for run ${run.id}`
    );
    expect(chat.getRunById(run.id)).toEqual(expect.objectContaining({
      id: run.id,
      status: 'waiting_approval',
      waitingApprovalId: approval.id
    }));
    expect(chat.getApprovalRecord(approval.id)?.status).toBe('pending');
  });

  it.each(['run', 'session', 'arguments', 'call', 'tool'] as const)('拒绝错配的 %s，保留待审批状态', (mismatch) => {
    const session = chat.createSession('Synthetic approval', 'agent-1');
    const run = chat.createRun(session.id, 'agent-1', 'synthetic write');
    const approval = chat.createApprovalRecord({
      runId: run.id, sessionId: mismatch === 'session' ? 'another-session' : session.id,
      toolName: 'write_file', toolArgs: { path: '/tmp/synthetic.txt', content: 'safe' },
      metadata: { callId: 'call-1' }
    });
    chat.updateRun(run.id, { status: 'waiting_approval', waitingApprovalId: mismatch === 'run' ? 'another-approval' : approval.id });
    chat.saveContextSnapshot(run.id, {
      systemPrompt: 'Synthetic', history: [], iterations: 1, lastUserInput: 'synthetic write',
      pendingToolCall: {
        callId: mismatch === 'call' ? 'call-other' : 'call-1',
        toolName: mismatch === 'tool' ? 'delete_file' : 'write_file',
        args: { path: '/tmp/synthetic.txt', content: mismatch === 'arguments' ? 'changed' : 'safe' }
      }
    });
    expect(() => approvalCoordinator.prepareApprovalResume(approval.id, true)).toThrow();
    expect(chat.getApprovalRecord(approval.id)?.status).toBe('pending');
    expect(chat.getRunById(run.id)?.status).toBe('waiting_approval');
  });
});
