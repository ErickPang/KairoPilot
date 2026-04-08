import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { PermissionGuard } from '../security/permissions';

const coordinatorMocks = vi.hoisted(() => ({
  createRunStep: vi.fn(),
  createToolCallRecord: vi.fn(),
  createApprovalRequest: vi.fn(),
  checkPermission: vi.fn(),
  executeApprovedTool: vi.fn(),
  getPolicyTags: vi.fn(),
  recordToolFailure: vi.fn()
}));

vi.mock('../../store/chat', () => ({
  createRunStep: coordinatorMocks.createRunStep,
  createToolCallRecord: coordinatorMocks.createToolCallRecord
}));

vi.mock('./approvalCoordinator', () => ({
  createApprovalRequest: coordinatorMocks.createApprovalRequest
}));

vi.mock('./toolPipeline', () => ({
  checkPermission: coordinatorMocks.checkPermission,
  executeApprovedTool: coordinatorMocks.executeApprovedTool,
  getPolicyTags: coordinatorMocks.getPolicyTags,
  recordToolFailure: coordinatorMocks.recordToolFailure
}));

import {
  handleToolCall,
  resumePendingToolCall
} from './toolCallCoordinator';

describe('toolCallCoordinator', () => {
  const permissionGuard = new PermissionGuard({
    executionProfile: 'approved_execution',
    fileSystem: { read: true, write: true, allowedPaths: ['/tmp'] },
    network: { enabled: true },
    shell: { enabled: true, allowedCommands: ['npm', 'node', 'python3', 'bash'] }
  });

  beforeEach(() => {
    coordinatorMocks.createRunStep.mockReset();
    coordinatorMocks.createToolCallRecord.mockReset();
    coordinatorMocks.createApprovalRequest.mockReset();
    coordinatorMocks.checkPermission.mockReset();
    coordinatorMocks.executeApprovedTool.mockReset();
    coordinatorMocks.getPolicyTags.mockReset();
    coordinatorMocks.recordToolFailure.mockReset();

    coordinatorMocks.createRunStep.mockReturnValue({ id: 'tool-step' });
    coordinatorMocks.createToolCallRecord.mockReturnValue('tool-record');
    coordinatorMocks.getPolicyTags.mockReturnValue(['tool:test_tool']);
  });

  it('在参数 JSON 非法时记录失败', async () => {
    const result = await handleToolCall({
      tools: new Map(),
      permissionGuard,
      runId: 'run-1',
      iterations: 1,
      lastUserInput: 'hello',
      call: {
        id: 'call-1',
        function: {
          name: 'test_tool',
          arguments: '{"value":'
        }
      },
      context: [],
      emitUpdate: vi.fn(),
      appendToolMessage: vi.fn(),
      persistSnapshot: vi.fn(),
      buildContextSummary: vi.fn(),
      auditLog: vi.fn()
    });

    expect(result).toEqual({ type: 'continue' });
    expect(coordinatorMocks.recordToolFailure).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'test_tool'
    }));
    expect(coordinatorMocks.createRunStep).not.toHaveBeenCalled();
  });

  it('在需要审批时创建审批请求并返回 waiting_approval', async () => {
    coordinatorMocks.checkPermission.mockReturnValue({
      kind: 'approval',
      args: { value: 'hello' }
    });
    coordinatorMocks.createApprovalRequest.mockReturnValue({ approvalId: 'approval-1' });

    const tools = new Map([
      ['test_tool', {
        name: 'test_tool',
        description: 'test',
        parameters: z.object({ value: z.string() }),
        execute: vi.fn()
      }]
    ]);
    const persistSnapshot = vi.fn();
    const buildContextSummary = vi.fn().mockReturnValue({
      activeTaskSummary: '',
      activeSkillsSummary: '',
      availableSkillsSummary: '',
      availableToolsSummary: '',
      compactedHistorySummary: '',
      unresolvedApprovals: '',
      selectedToolResults: '',
      workspaceRetrieval: '',
      memoryDigest: '',
      layers: [],
      recentMessageCount: 0,
      omittedMessageCount: 0,
      budget: {
        maxContextChars: 0,
        systemPromptChars: 0,
        supportChars: 0,
        recentHistoryChars: 0,
        totalChars: 0
      }
    });

    const result = await handleToolCall({
      tools,
      permissionGuard,
      runId: 'run-2',
      sessionId: 'session-2',
      iterations: 2,
      lastUserInput: 'run tool',
      call: {
        id: 'call-2',
        function: {
          name: 'test_tool',
          arguments: '{"value":"hello"}'
        }
      },
      context: [],
      emitUpdate: vi.fn(),
      appendToolMessage: vi.fn(),
      persistSnapshot,
      buildContextSummary,
      auditLog: vi.fn()
    });

    expect(result).toEqual({ type: 'waiting_approval', approvalId: 'approval-1' });
    expect(coordinatorMocks.createApprovalRequest).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-2',
      toolName: 'test_tool',
      args: { value: 'hello' },
      displayArgs: { value: 'hello' },
      riskLevel: 'medium',
      approvalMode: 'on_external',
      policyTags: ['tool:test_tool'],
      redacted: true,
      toolRecordId: 'tool-record',
      toolStepId: 'tool-step'
    }));
    expect(coordinatorMocks.executeApprovedTool).not.toHaveBeenCalled();
  });

  it('在允许执行时调用工具并持久化快照', async () => {
    coordinatorMocks.checkPermission.mockReturnValue({
      kind: 'allow',
      args: { command: 'npm', args: ['test'] }
    });

    const tool = {
      name: 'execute_command',
      description: 'test',
      parameters: z.object({
        command: z.string(),
        args: z.array(z.string()).default([])
      }),
      execute: vi.fn()
    };
    const persistSnapshot = vi.fn();
    const buildContextSummary = vi.fn().mockReturnValue({
      activeTaskSummary: 'task',
      activeSkillsSummary: '',
      availableSkillsSummary: '',
      availableToolsSummary: 'execute_command',
      compactedHistorySummary: '',
      unresolvedApprovals: '',
      selectedToolResults: '',
      workspaceRetrieval: '',
      memoryDigest: '',
      layers: [],
      recentMessageCount: 1,
      omittedMessageCount: 0,
      budget: {
        maxContextChars: 1,
        systemPromptChars: 1,
        supportChars: 1,
        recentHistoryChars: 1,
        totalChars: 1
      }
    });

    const result = await handleToolCall({
      tools: new Map([['execute_command', tool]]),
      permissionGuard,
      runId: 'run-3',
      sessionId: 'session-3',
      iterations: 3,
      lastUserInput: 'please run npm test',
      call: {
        id: 'call-3',
        function: {
          name: 'execute_command',
          arguments: '{"command":"npm test"}'
        }
      },
      context: [],
      emitUpdate: vi.fn(),
      appendToolMessage: vi.fn(),
      persistSnapshot,
      buildContextSummary,
      auditLog: vi.fn()
    });

    expect(result).toEqual({ type: 'continue' });
    expect(coordinatorMocks.executeApprovedTool).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-3',
      toolName: 'execute_command',
      args: { command: 'npm', args: ['test'] },
      toolStepId: 'tool-step',
      toolRecordId: 'tool-record'
    }));
    expect(persistSnapshot).toHaveBeenCalledWith('run-3', expect.objectContaining({
      iterations: 3,
      lastUserInput: 'please run npm test',
      stepId: 'tool-step'
    }));
  });

  it('在恢复审批且被拒绝时记录失败', async () => {
    coordinatorMocks.getPolicyTags.mockReturnValue(['tool:delete_file']);

    await resumePendingToolCall({
      tools: new Map(),
      permissionGuard,
      run: {
        id: 'run-4',
        sessionId: 'session-4',
        userInput: 'delete file'
      },
      pendingToolCall: {
        callId: 'call-4',
        toolName: 'delete_file',
        args: { path: '/tmp/a.txt' },
        toolRecordId: 'tool-record-4',
        toolStepId: 'tool-step-4'
      },
      approvalArgs: { path: '/tmp/a.txt' },
      approved: false,
      emitUpdate: vi.fn(),
      appendToolMessage: vi.fn(),
      persistSnapshot: vi.fn(),
      buildContextSummary: vi.fn(),
      auditLog: vi.fn()
    });

    expect(coordinatorMocks.recordToolFailure).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-4',
      toolName: 'delete_file',
      errorMessage: 'User denied permission for delete_file.'
    }));
    expect(coordinatorMocks.executeApprovedTool).not.toHaveBeenCalled();
  });
});
