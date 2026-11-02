vi.mock('../../store/conversation',()=>({recordConversationUpdate:vi.fn(),setConversationUser:vi.fn()}));
vi.mock('../../store/taskQueue',()=>({queuedMessages:()=>[]}));
vi.mock('../../services/taskQueueService',()=>({holdTaskQueue:vi.fn(),holdQueueAfterRun:vi.fn(),nextTaskQueueMessage:()=>undefined}));
vi.mock('../../services/projectMemoryService',()=>({memorySnapshot:()=>undefined,scheduleProjectMemory:vi.fn()}));
import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentRuntimeMocks = vi.hoisted(() => ({
  ensureAgentRuntime: vi.fn(),
  getAgentRuntime: vi.fn()
}));

const chatStoreMocks = vi.hoisted(() => ({
  getUnsettledRunsForAgent: vi.fn(() => []),
  getApprovalRecord: vi.fn(),
  ensureActiveSession: vi.fn(),
  getRunById: vi.fn(),
  getSessionById: vi.fn(),
  updateRun: vi.fn(),
  updateSessionMessages: vi.fn()
}));

vi.mock('../../assistant/agentRuntime', () => ({
  ensureAgentRuntime: agentRuntimeMocks.ensureAgentRuntime,
  getAgentRuntime: agentRuntimeMocks.getAgentRuntime
}));

vi.mock('../../store/chat', () => ({
  getUnsettledRunsForAgent: chatStoreMocks.getUnsettledRunsForAgent,
  getApprovalRecord: chatStoreMocks.getApprovalRecord,
  ensureActiveSession: chatStoreMocks.ensureActiveSession,
  getRunById: chatStoreMocks.getRunById,
  getSessionById: chatStoreMocks.getSessionById,
  updateRun: chatStoreMocks.updateRun,
  updateSessionMessages: chatStoreMocks.updateSessionMessages
}));

vi.mock('../../services/taskSettingsService',()=>({requireTask:(id:string)=>({id}),settingsForTask:()=>({workflow:'direct'})}));
vi.mock('../../services/workbenchConfigService',()=>({strictTaskModel:()=>({provider:'custom',model:'synthetic'})}));
vi.mock('../../services/workbenchExecution',()=>({isTaskExecuting:()=>false,isWorkbenchBusy:()=>true,isWorkbenchShuttingDown:()=>false,withTaskExecution:async(_id:string,operation:()=>Promise<unknown>)=>operation()}));
vi.mock('../../core/agent/cancelSuspendedRun',()=>({cancelSuspendedRun:vi.fn()}));
vi.mock('../../services/projectService', () => ({
  executionAgentForTask:(task:{id:string})=>({id:`task:${task.id}`,model:'fixture/model'}),
  assertStoredExecutionContext: vi.fn(),
  executionContextForSession: vi.fn(() => ({ executionRoot: '/tmp/synthetic' }))
}));

import { controlStoredRun, createRuntimeUpdateForwarder, mapRuntimeExecutionResult, mapRuntimeHandlerFailure, persistAgentSessionHistory, resolveRuntimeForApproval, runActiveAgentChat, runApprovalResponse, runStoredAgentAction } from './agentHandlerService';

describe('agentHandlerService', () => {
  beforeEach(() => {
    for (const mock of [
      agentRuntimeMocks.ensureAgentRuntime,
      agentRuntimeMocks.getAgentRuntime,
      chatStoreMocks.getApprovalRecord,
      chatStoreMocks.ensureActiveSession,
      chatStoreMocks.getRunById,
      chatStoreMocks.updateSessionMessages
    ]) {
      mock.mockReset();
    }
  });

  it('rejects stale approvals and cancelled checkpoints before initializing a runtime', async () => {
    chatStoreMocks.getApprovalRecord.mockReturnValue({id:'old',runId:'r',status:'denied'});
    chatStoreMocks.getRunById.mockReturnValue({id:'r',sessionId:'s',status:'cancelled'});
    await expect(runApprovalResponse('old',true,{} as never)).rejects.toThrow('expired');
    const operation=vi.fn();
    await expect(runStoredAgentAction('r',{} as never,operation)).rejects.toThrow('ended');
    expect(agentRuntimeMocks.ensureAgentRuntime).not.toHaveBeenCalled();expect(operation).not.toHaveBeenCalled();
  });

  it('does not overwrite another session with an uninitialized runtime history', () => {
    const getSessionHistory = vi.fn(() => []);
    persistAgentSessionHistory({ getActiveSessionId: () => null, getSessionHistory }, 'stored-session');
    persistAgentSessionHistory({ getActiveSessionId: () => 'different-session', getSessionHistory }, 'stored-session');
    expect(getSessionHistory).not.toHaveBeenCalled();
    expect(chatStoreMocks.updateSessionMessages).not.toHaveBeenCalled();
  });

  it('a closed renderer does not abort background execution', () => {
    const sender = { isDestroyed: () => true, send: vi.fn() };
    expect(() => createRuntimeUpdateForwarder(sender as never)({ type: 'assistant-response', runId: 'run-closed', status: 'completed', content: 'done' })).not.toThrow();
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('all streamed events carry the stored owner, ignoring conflicting payload identity', () => {
    chatStoreMocks.getRunById.mockReturnValue({ id: 'run-owned', sessionId: 'session-owned', agentId: 'agent-owned' });
    const sender = { isDestroyed: () => false, send: vi.fn() };
    const forward = createRuntimeUpdateForwarder(sender as never, 'incorrect-fallback');
    forward({ type: 'assistant-delta', runId: 'run-owned', content: 'a', delta: 'a', sessionId: 'wrong', agentId: 'wrong' });
    forward({ type: 'run-failed', runId: 'run-owned', status: 'failed', error: 'failed' });
    expect(sender.send).toHaveBeenNthCalledWith(1, 'agent:update', expect.objectContaining({ sessionId: 'session-owned', agentId: 'agent-owned' }));
    expect(sender.send).toHaveBeenNthCalledWith(2, 'agent:update', expect.objectContaining({ sessionId: 'session-owned', agentId: 'agent-owned', type: 'run-failed' }));
    expect(chatStoreMocks.getRunById).toHaveBeenCalledTimes(1);
  });

  it('审批恢复按 approval 所属 run 解析 runtime，而不是当前激活 agent', async () => {
    chatStoreMocks.getSessionById.mockReturnValue({ id: 'session-1', agentId: 'agent-archived' });
    const agent = { resumeRun: vi.fn() };
    agentRuntimeMocks.ensureAgentRuntime.mockResolvedValue(agent);
    chatStoreMocks.getApprovalRecord.mockReturnValue({
      id: 'approval-1',
      runId: 'run-1',
      sessionId: 'session-1'
    });
    chatStoreMocks.getRunById.mockReturnValue({
      id: 'run-1',
      agentId: 'agent-archived',
      sessionId: 'session-1',
      executionContext: { executionRoot: '/tmp/synthetic' }
    });
    agentRuntimeMocks.getAgentRuntime.mockReturnValue(agent);

    const result = await resolveRuntimeForApproval('approval-1', {} as never);

    expect(result).toEqual({
      approval: {
        id: 'approval-1',
        runId: 'run-1',
        sessionId: 'session-1'
      },
      run: {
        id: 'run-1',
        agentId: 'agent-archived',
        sessionId: 'session-1',
        executionContext: { executionRoot: '/tmp/synthetic' }
      },
      agent
    });
    expect(agentRuntimeMocks.ensureAgentRuntime).toHaveBeenCalledWith(expect.objectContaining({ agent: { id: 'task:session-1', model:'fixture/model' } }), expect.anything());
  });

  it('agent chat 异常时也会在 finally 中持久化会话历史', async () => {
    const agent = {
      getActiveRunId: () => null,
      chat: vi.fn().mockRejectedValue(new Error('boom')),
      getSessionHistory: vi.fn().mockReturnValue([
        { role: 'user', content: 'latest question' }
      ]),
      setHistory: vi.fn()
    };

    agentRuntimeMocks.getAgentRuntime.mockReturnValue(agent);
    agentRuntimeMocks.ensureAgentRuntime.mockResolvedValue(agent);
    chatStoreMocks.getSessionById.mockReturnValue({
      id: 'session-1',
      messages: [{ role: 'user', content: 'existing message' }]
    });

    await expect(runActiveAgentChat({sessionId:'session-1',content:'latest question'}, {
      isDestroyed: () => false, send: vi.fn()
    } as never)).rejects.toThrow('boom');

    expect(agent.setHistory).toHaveBeenCalledWith([{ role: 'user', content: 'existing message' }]);
    expect(chatStoreMocks.updateSessionMessages).toHaveBeenCalledWith('session-1', [
      { role: 'user', content: 'latest question' }
    ]);
  });

  it('缺失审批记录时直接报错', async () => {
    chatStoreMocks.getApprovalRecord.mockReturnValue(null);

    await expect(resolveRuntimeForApproval('missing-approval', {} as never)).rejects.toThrow(
      'Approval record not found: missing-approval'
    );
  });

  it('运行失败时返回 success=false', () => {
    expect(mapRuntimeExecutionResult({
      status: 'failed',
      runId: 'run-1',
      error: 'Context snapshot not found'
    })).toEqual({
      success: false,
      status: 'failed',
      runId: 'run-1',
      error: 'Context snapshot not found',
      content: undefined,
      approvalId: undefined
    });
  });

  it('user cancellation is an accepted operation, not a failed invocation', () => {
    expect(mapRuntimeExecutionResult({ status: 'cancelled', runId: 'run-cancel', error: 'Run cancelled by user.' })).toEqual(expect.objectContaining({ success: true, status: 'cancelled' }));
  });

  it('cancels a suspended task without initializing a model or rewriting history', async () => {
    chatStoreMocks.getRunById.mockReturnValue({id:'suspended',sessionId:'stored',status:'paused'});
    await controlStoredRun('suspended','cancel',{} as never);
    expect(agentRuntimeMocks.ensureAgentRuntime).not.toHaveBeenCalled();
    expect(chatStoreMocks.updateSessionMessages).not.toHaveBeenCalled();
  });
  it('requires a task id rather than routing a string through global selection', async () => {
    await expect(runActiveAgentChat('unsafe selection',{} as never)).rejects.toThrow('task request');
  });

  it('运行类 handler 失败统一映射为 IPC failure', () => {
    expect(mapRuntimeHandlerFailure(new Error('run failed'))).toEqual({
      success: false,
      error: 'run failed'
    });
  });

  it('等待审批和完成态保持 success=true', () => {
    expect(mapRuntimeExecutionResult({
      status: 'waiting_approval',
      runId: 'run-2',
      approvalId: 'approval-1'
    })).toEqual({
      success: true,
      status: 'waiting_approval',
      runId: 'run-2',
      approvalId: 'approval-1',
      content: undefined,
      error: undefined
    });

    expect(mapRuntimeExecutionResult({
      status: 'completed',
      runId: 'run-3',
      content: 'done'
    })).toEqual({
      success: true,
      status: 'completed',
      runId: 'run-3',
      content: 'done',
      error: undefined,
      approvalId: undefined
    });
  });

  it('审批更新只通过 agentUpdate 发送一次，并补齐 sessionId', () => {
    const sender = {
      isDestroyed: () => false, send: vi.fn()
    };

    createRuntimeUpdateForwarder(sender as never, 'session-1')({
      type: 'approval-required',
      tool: 'execute_command',
      args: { command: 'npm' },
      runId: 'run-2',
      approvalId: 'approval-1',
      status: 'waiting_approval'
    });

    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.send).toHaveBeenCalledWith('agent:update', {
      type: 'approval-required',
      tool: 'execute_command',
      args: { command: 'npm' },
      runId: 'run-2',
      approvalId: 'approval-1',
      sessionId: 'session-1',
      status: 'waiting_approval'
    });
  });
});
