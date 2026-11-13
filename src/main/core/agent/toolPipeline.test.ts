import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { PermissionGuard } from '../security/permissions';

const chatStoreMocks = vi.hoisted(() => ({
  createRunStep: vi.fn(),
  updateRunStep: vi.fn(),
  updateToolCallRecord: vi.fn()
}));

vi.mock('../../store/chat', () => ({
  createRunStep: chatStoreMocks.createRunStep,
  updateRunStep: chatStoreMocks.updateRunStep,
  updateToolCallRecord: chatStoreMocks.updateToolCallRecord
}));

import {
  checkPermission,
  createPermissionGuardedTool,
  executeApprovedTool,
  getPolicyTags,
  getToolMetadataPolicyTags,
  recordToolFailure
} from './toolPipeline';

describe('toolPipeline', () => {
  it('requires per-call approval for external tools and blocks them in read-only tasks', () => {
    for (const profile of ['read_only_workspace', 'chat_only', 'approved_execution'] as const) {
      const guard = new PermissionGuard({ executionProfile: profile, fileSystem: { read: true, write: true, allowedPaths: ['/tmp'] }, shell: { enabled: true, allowedCommands: ['node'] }, network: { enabled: true }, policy: { approvalMode: 'on_write' } });
      expect(checkPermission(guard, 'plugin_fixture__echo', {})).toMatchObject({ kind: profile === 'approved_execution' ? 'approval' : 'deny' });
      expect(guard.getToolRiskLevel('plugin_fixture__echo')).toBe('high');
    }
  });
  beforeEach(() => {
    chatStoreMocks.createRunStep.mockReset();
    chatStoreMocks.updateRunStep.mockReset();
    chatStoreMocks.updateToolCallRecord.mockReset();
  });

  it('对 execute_command 进行归一化并标记为审批', () => {
    const guard = new PermissionGuard({
      executionProfile: 'approved_execution',
      fileSystem: { read: true, write: true, allowedPaths: ['/tmp'] },
      network: { enabled: true },
      shell: { enabled: true, allowedCommands: ['npm'] }
    });

    const decision = checkPermission(guard, 'execute_command', {
      command: 'npm run test'
    });

    expect(decision).toEqual({
      kind: 'approval',
      args: {
        command: 'npm',
        args: ['run', 'test']
      }
    });
  });

  it('在网络关闭时拒绝 web_search', () => {
    const guard = new PermissionGuard({
      executionProfile: 'read_only_workspace',
      fileSystem: { read: true, write: true, allowedPaths: ['/tmp'] },
      network: { enabled: false },
      shell: { enabled: false, allowedCommands: [] }
    });

    const decision = checkPermission(guard, 'web_search', {
      url: 'https://example.com'
    });

    expect(decision.kind).toBe('deny');
    if (decision.kind === 'deny') {
      expect(decision.error).toContain('Real-time web access is not available');
    }
  });

  it('允许使用 URL 前缀白名单放行 web_search', () => {
    const guard = new PermissionGuard({
      executionProfile: 'approved_execution',
      fileSystem: { read: true, write: true, allowedPaths: ['/tmp'] },
      network: { enabled: true, allowedDomains: ['https://html.duckduckgo.com/html/'] },
      shell: { enabled: false, allowedCommands: [] }
    });

    const decision = checkPermission(guard, 'web_search', {
      query: 'KairoPilot'
    });

    expect(decision.kind).toBe('approval');
  });

  it('允许使用 URL 前缀白名单放行 fetch_webpage', () => {
    const guard = new PermissionGuard({
      executionProfile: 'approved_execution',
      fileSystem: { read: true, write: true, allowedPaths: ['/tmp'] },
      network: { enabled: true, allowedDomains: ['https://docs.anthropic.com/'] },
      shell: { enabled: false, allowedCommands: [] }
    });

    const decision = checkPermission(guard, 'fetch_webpage', {
      url: 'https://docs.anthropic.com/en/docs/agents-and-tools/tool-use'
    });

    expect(decision.kind).toBe('approval');
  });

  it('在 chat_only 档位下拒绝读取类工具', () => {
    const guard = new PermissionGuard({
      executionProfile: 'chat_only',
      fileSystem: { read: true, write: true, allowedPaths: ['/tmp'] },
      network: { enabled: true },
      shell: { enabled: true, allowedCommands: ['npm'] }
    });

    const decision = checkPermission(guard, 'read_file', {
      path: '/tmp/demo.txt'
    });

    expect(decision.kind).toBe('deny');
    if (decision.kind === 'deny') {
      expect(decision.error).toContain("does not allow tool execution");
    }
  });

  it('在 chat_only 档位下允许读取当前会话附件', () => {
    const guard = new PermissionGuard({
      executionProfile: 'chat_only',
      fileSystem: { read: false, write: false, allowedPaths: [] },
      network: { enabled: false },
      shell: { enabled: false, allowedCommands: [] }
    });

    const decision = checkPermission(guard, 'read_attachment', {
      attachmentId: 'attachment-1'
    });

    expect(decision).toEqual({
      kind: 'allow',
      args: {
        attachmentId: 'attachment-1'
      }
    });
  });

  it('在只读执行档位下拒绝写入类工具', () => {
    const guard = new PermissionGuard({
      executionProfile: 'read_only_workspace',
      fileSystem: { read: true, write: true, allowedPaths: ['/tmp'] },
      network: { enabled: true },
      shell: { enabled: true, allowedCommands: ['npm'] }
    });

    const decision = checkPermission(guard, 'write_file', {
      path: '/tmp/demo.txt',
      content: 'hello'
    });

    expect(decision.kind).toBe('deny');
    if (decision.kind === 'deny') {
      expect(decision.error).toContain("does not allow write_file");
    }
  });

  it('为高风险技能工具生成策略标签', () => {
    const guard = new PermissionGuard({
      executionProfile: 'approved_execution',
      fileSystem: { read: true, write: true, allowedPaths: ['/tmp'] },
      network: { enabled: true },
      shell: { enabled: true, allowedCommands: ['python3'] }
    });

    expect(getPolicyTags('run_skill_script', { skill: 'demo-skill', scriptPath: 'scripts/demo.py' }, guard)).toEqual([
      'tool:run_skill_script',
      'policy:skill_used',
      'tool_category:skill',
      'skill:demo-skill',
      'skill_script:scripts/demo.py',
      'risk:high',
      'approval_mode:on_external',
      'scope:allowed_paths',
      'data_class:project',
      'policy:redaction_enabled',
      'policy:confirmation_required'
    ]);
  });

  it('为插件工具生成来源策略标签', () => {
    expect(getToolMetadataPolicyTags({
      name: 'get_weather_forecast',
      description: 'weather',
      parameters: z.object({}),
      execute: vi.fn(),
      metadata: {
        source: 'plugin',
        pluginId: 'kairo-weather-plugin',
        pluginName: 'Weather Forecaster',
        pluginScope: 'agent:demo',
        riskLevel: 'low'
      }
    })).toEqual([
      'tool_category:plugin',
      'plugin:kairo-weather-plugin',
      'plugin_scope:agent_demo',
      'plugin_risk:low'
    ]);
  });

  it('在 trusted_automation 下直接放行高风险工具', () => {
    const guard = new PermissionGuard({
      executionProfile: 'trusted_automation',
      fileSystem: { read: true, write: true, allowedPaths: ['/tmp'] },
      network: { enabled: true },
      shell: { enabled: true, allowedCommands: ['npm'] }
    });

    const decision = checkPermission(guard, 'execute_command', {
      command: 'npm run build'
    });

    expect(decision).toEqual({
      kind: 'allow',
      args: {
        command: 'npm',
        args: ['run', 'build']
      }
    });
  });

  it('直接执行受保护工具时会拒绝需要审批的调用', async () => {
    const rawExecute = vi.fn().mockResolvedValue({ ok: true });
    const guardedTool = createPermissionGuardedTool({
      name: 'write_file',
      description: 'write',
      parameters: z.object({
        path: z.string(),
        content: z.string()
      }),
      execute: rawExecute
    }, new PermissionGuard({
      executionProfile: 'approved_execution',
      policy: {
        approvalMode: 'on_write',
        environmentScope: 'allowed_paths',
        dataClass: 'project',
        redactSensitiveOutput: true
      },
      fileSystem: { read: true, write: true, allowedPaths: ['/tmp'] },
      network: { enabled: false },
      shell: { enabled: false, allowedCommands: [] }
    }));

    const result = await guardedTool.execute({
      path: '/tmp/demo.txt',
      content: 'hello'
    }) as { ok: boolean; error?: string };

    expect(result.ok).toBe(false);
    expect(result.error).toContain('requires approval');
    expect(rawExecute).not.toHaveBeenCalled();
  });

  it('审批后执行受保护工具时仍会保留硬边界校验', async () => {
    const rawExecute = vi.fn().mockResolvedValue({ ok: true });
    const guardedTool = createPermissionGuardedTool({
      name: 'write_file',
      description: 'write',
      parameters: z.object({
        path: z.string(),
        content: z.string()
      }),
      execute: rawExecute
    }, new PermissionGuard({
      executionProfile: 'approved_execution',
      policy: {
        approvalMode: 'on_write',
        environmentScope: 'allowed_paths',
        dataClass: 'project',
        redactSensitiveOutput: true
      },
      fileSystem: { read: true, write: true, allowedPaths: ['/tmp'] },
      network: { enabled: false },
      shell: { enabled: false, allowedCommands: [] }
    }));

    await guardedTool.executeApproved({
      path: '/tmp/demo.txt',
      content: 'hello'
    });
    const blocked = await guardedTool.executeApproved({
      path: '/etc/passwd',
      content: 'hello'
    }) as { ok: boolean; error?: string };

    expect(rawExecute).toHaveBeenCalledTimes(1);
    expect(rawExecute).toHaveBeenCalledWith({
      path: '/tmp/demo.txt',
      content: 'hello'
    }, undefined);
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain('File System access');
  });

  it('在只读执行档位下拒绝 run_skill_script', () => {
    const guard = new PermissionGuard({
      executionProfile: 'read_only_workspace',
      fileSystem: { read: true, write: false, allowedPaths: ['/tmp'] },
      network: { enabled: true },
      shell: { enabled: false, allowedCommands: [] }
    });

    const decision = checkPermission(guard, 'run_skill_script', {
      skill: 'demo',
      scriptPath: 'tools/demo.py'
    });

    expect(decision.kind).toBe('deny');
    if (decision.kind === 'deny') {
      expect(decision.error).toContain('does not allow run_skill_script');
    }
  });

  it('在工具执行成功时更新步骤、审计和消息', async () => {
    chatStoreMocks.createRunStep.mockReturnValue({ id: 'result-step' });
    const emitUpdate = vi.fn();
    const appendToolMessage = vi.fn();
    const auditLog = vi.fn();
    const tool = {
      name: 'test_tool',
      description: 'test',
      parameters: z.object({ value: z.string() }),
      execute: vi.fn().mockResolvedValue({ ok: true })
    };

    await executeApprovedTool({
      runId: 'run-1',
      sessionId: 'session-1',
      permissionGuard: new PermissionGuard({
        executionProfile: 'approved_execution',
        fileSystem: { read: true, write: true, allowedPaths: ['/tmp'] },
        network: { enabled: true },
        shell: { enabled: true, allowedCommands: ['npm'] }
      }),
      tool,
      toolName: 'test_tool',
      args: { value: 'hello' },
      callId: 'call-1',
      toolStepId: 'tool-step',
      toolRecordId: 'record-1',
      policyTags: ['tool:test_tool'],
      auditLog,
      emitUpdate,
      appendToolMessage
    });

    expect(chatStoreMocks.updateRunStep).toHaveBeenCalledWith('tool-step', expect.objectContaining({
      status: 'completed'
    }));
    expect(chatStoreMocks.createRunStep).toHaveBeenCalledWith('run-1', 'tool_result', 'test_tool 返回结果', expect.objectContaining({
      status: 'completed'
    }));
    expect(chatStoreMocks.updateToolCallRecord).toHaveBeenCalledWith('record-1', {
      result: { ok: true },
      status: 'success'
    });
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'test_tool',
      result: { ok: true }
    }));
    expect(emitUpdate).toHaveBeenNthCalledWith(1, undefined, expect.objectContaining({
      type: 'tool-call'
    }));
    expect(emitUpdate).toHaveBeenNthCalledWith(2, undefined, expect.objectContaining({
      type: 'tool-result'
    }));
    expect(appendToolMessage).toHaveBeenCalledWith('test_tool', 'call-1', JSON.stringify({ ok: true }));
  });

  it('工具返回后若已取消，丢弃工具输出且不写入成功审计', async () => {
    const emitUpdate = vi.fn();
    const appendToolMessage = vi.fn();
    const auditLog = vi.fn();
    const shouldInterrupt = vi.fn().mockReturnValue({
      kind: 'cancel',
      reason: 'Run cancelled by user.'
    });
    const tool = {
      name: 'slow_tool',
      description: 'slow',
      parameters: z.object({ value: z.string() }),
      execute: vi.fn().mockResolvedValue({ ok: true })
    };

    await executeApprovedTool({
      runId: 'run-cancel-tool',
      sessionId: 'session-1',
      permissionGuard: new PermissionGuard({
        executionProfile: 'approved_execution',
        fileSystem: { read: true, write: true, allowedPaths: ['/tmp'] },
        network: { enabled: true },
        shell: { enabled: true, allowedCommands: ['npm'] }
      }),
      tool,
      toolName: 'slow_tool',
      args: { value: 'hello' },
      callId: 'call-tool',
      toolStepId: 'tool-step',
      toolRecordId: 'record-tool',
      policyTags: ['tool:slow_tool'],
      auditLog,
      shouldInterrupt,
      emitUpdate,
      appendToolMessage
    });

    expect(chatStoreMocks.updateRunStep).toHaveBeenCalledWith('tool-step', expect.objectContaining({
      status: 'cancelled',
      output: expect.objectContaining({
        discardedToolOutput: true
      })
    }));
    expect(chatStoreMocks.updateToolCallRecord).toHaveBeenCalledWith('record-tool', {
      status: 'cancelled'
    });
    expect(auditLog).not.toHaveBeenCalled();
    expect(appendToolMessage).toHaveBeenCalledWith('slow_tool', 'call-tool', JSON.stringify({
      interrupted: true, reason: 'Run cancelled by user.', sideEffectsMayExist: true
    }));
    // The engine persists the authoritative checkpoint before emitting a terminal event.
    expect(emitUpdate).not.toHaveBeenCalledWith(undefined, expect.objectContaining({ type: 'run-cancelled' }));
  });

  it('在工具失败时记录失败状态并追加错误消息', async () => {
    chatStoreMocks.createRunStep.mockReturnValue({ id: 'failure-step' });
    const emitUpdate = vi.fn();
    const appendToolMessage = vi.fn();
    const auditLog = vi.fn();

    await recordToolFailure({
      runId: 'run-2',
      sessionId: 'session-2',
      permissionGuard: new PermissionGuard({
        executionProfile: 'approved_execution',
        fileSystem: { read: true, write: true, allowedPaths: ['/tmp'] },
        network: { enabled: true },
        shell: { enabled: true, allowedCommands: ['npm'] }
      }),
      toolName: 'broken_tool',
      callId: 'call-2',
      args: { target: 'x' },
      errorMessage: 'boom',
      toolStepId: 'tool-step',
      toolRecordId: 'record-2',
      policyTags: ['tool:broken_tool', 'decision:error'],
      auditLog,
      emitUpdate,
      appendToolMessage
    });

    expect(chatStoreMocks.updateRunStep).toHaveBeenCalledWith('tool-step', expect.objectContaining({
      status: 'failed',
      error: 'boom'
    }));
    expect(chatStoreMocks.createRunStep).toHaveBeenCalledWith('run-2', 'tool_result', 'broken_tool 执行失败', expect.objectContaining({
      status: 'failed',
      error: 'boom'
    }));
    expect(chatStoreMocks.updateToolCallRecord).toHaveBeenCalledWith('record-2', {
      error: 'boom',
      status: 'failed'
    });
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'broken_tool',
      error: 'boom'
    }));
    expect(emitUpdate).toHaveBeenCalledWith(undefined, expect.objectContaining({
      type: 'tool-error',
      error: 'boom'
    }));
    expect(appendToolMessage).toHaveBeenCalledWith('broken_tool', 'call-2', 'Error executing tool: boom');
  });
});
