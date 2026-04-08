import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { assembleRuntimeContext } from './assembler';

const tempDirectories: string[] = [];

function createWorkspaceFixture() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'kairopilot-context-'));
  tempDirectories.push(workspace);

  fs.mkdirSync(path.join(workspace, 'prompts'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'MEMORY.md'), 'Project memory digest');
  fs.writeFileSync(path.join(workspace, 'prompts', 'workflow.md'), 'Always verify tool output before responding.');
  fs.writeFileSync(path.join(workspace, 'tasks', 'today.md'), 'Refactor context assembly.');
  fs.writeFileSync(path.join(workspace, 'agent.ts'), 'export async function planTask() { return "ok"; }');

  return workspace;
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('assembleRuntimeContext', () => {
  it('按分层结构装配 system、runtime、memory 与 recent history', () => {
    const workspace = createWorkspaceFixture();
    const result = assembleRuntimeContext({
      systemPrompt: 'You are KairoPilot.',
      workspace,
      history: [
        { role: 'user', content: '请分析当前任务', timestamp: 1 },
        { role: 'assistant', content: '我会先查看上下文再行动。', timestamp: 2 }
      ],
      loadedSkills: [
        {
          skillName: 'Issue Triage',
          allowedTools: ['Read', 'RunCommand'],
          loadedAt: 10
        }
      ],
      availableSkillsSummary: '- issue-triage: 用于排查缺陷、收敛根因并给出修复路径。',
      availableToolNames: ['read_file', 'execute_command', 'load_skill'],
      run: {
        id: 'run-1',
        sessionId: 'session-1',
        agentId: 'mainAgent',
        goal: '重构上下文装配',
        userInput: '开始上下文装配分层的逻辑重构',
        status: 'running',
        createdAt: 1,
        updatedAt: 2
      },
      runSteps: [
        {
          id: 'step-1',
          runId: 'run-1',
          stepIndex: 1,
          type: 'plan',
          title: '接收用户输入',
          status: 'completed',
          input: { userInput: '开始上下文装配分层的逻辑重构' },
          output: { next: 'assemble context' },
          createdAt: 1,
          updatedAt: 2
        }
      ]
    });

    expect(result.messages.map((message) => message.role)).toEqual([
      'system',
      'system',
      'system',
      'user',
      'assistant'
    ]);
    expect(result.metadata.activeSkillsSummary).toContain('Issue Triage');
    expect(result.metadata.availableSkillsSummary).toContain('issue-triage');
    expect(result.metadata.availableToolsSummary).toContain('execute_command');
    expect(result.metadata.layers.map((layer) => layer.id)).toEqual([
      'base_instructions',
      'runtime_state',
      'memory_context',
      'recent_history'
    ]);
    expect(result.metadata.layers[1]?.summary).toContain('Issue Triage');
    expect(result.metadata.memoryDigest).toContain('Project memory digest');
    expect(result.metadata.budget.supportChars).toBeGreaterThan(0);
  });

  it('在无技能上下文时保留基础层并正确记录最近历史层', () => {
    const workspace = createWorkspaceFixture();
    const result = assembleRuntimeContext({
      systemPrompt: 'You are KairoPilot.',
      workspace,
      history: [
        { role: 'user', content: '第一条消息', timestamp: 1 },
        { role: 'assistant', content: '第二条消息', timestamp: 2 },
        { role: 'user', content: '第三条消息', timestamp: 3 }
      ],
      availableToolNames: ['load_skill']
    });

    expect(result.metadata.activeSkillsSummary).toBe('');
    expect(result.metadata.availableSkillsSummary).toBe('');
    expect(result.metadata.layers[0]?.id).toBe('base_instructions');
    expect(result.metadata.layers[result.metadata.layers.length - 1]?.id).toBe('recent_history');
    expect(result.metadata.recentMessageCount).toBe(3);
    expect(result.messages[0]?.content).toBe('You are KairoPilot.');
  });

  it('优先使用运行时传入的工具摘要而不是完整工具列表', () => {
    const workspace = createWorkspaceFixture();
    const result = assembleRuntimeContext({
      systemPrompt: 'You are KairoPilot.',
      workspace,
      history: [
        { role: 'user', content: '继续执行', timestamp: 1 }
      ],
      availableToolsSummary: 'Tools catalog update:\n- new_tools: execute_command',
      availableToolNames: ['read_file', 'execute_command', 'load_skill']
    });

    expect(result.metadata.availableToolsSummary).toBe('Tools catalog update: - new_tools: execute_command');
    expect(result.messages[1]?.content).toContain('<available_tools>');
    expect(result.messages[1]?.content).toContain('Tools catalog update:');
    expect(result.messages[1]?.content).not.toContain('read_file, execute_command, load_skill');
  });

  it('优先保留任务与审批摘要，再压缩技能和工具摘要', () => {
    const workspace = createWorkspaceFixture();
    const longSkillText = 'skill '.repeat(400);
    const longToolText = 'tool '.repeat(400);
    const result = assembleRuntimeContext({
      systemPrompt: 'You are KairoPilot.',
      workspace,
      maxContextChars: 12000,
      history: [
        { role: 'user', content: '继续执行', timestamp: 1 }
      ],
      activeSkillsSummary: `Active skills update:\n- ${longSkillText}`,
      availableSkillsSummary: `Skills catalog update:\n- ${longSkillText}`,
      availableToolsSummary: `Tools catalog update:\n- ${longToolText}`,
      pendingApproval: {
        id: 'approval-1',
        runId: 'run-1',
        stepId: 'step-1',
        sessionId: 'session-1',
        toolName: 'execute_command',
        args: { command: 'npm', args: ['run', 'build'] },
        status: 'pending',
        createdAt: 1,
        updatedAt: 2
      },
      run: {
        id: 'run-1',
        sessionId: 'session-1',
        agentId: 'mainAgent',
        goal: '确保关键状态层优先保留',
        userInput: '继续',
        status: 'running',
        createdAt: 1,
        updatedAt: 2
      }
    });

    expect(result.messages[1]?.content).toContain('<active_task_summary>');
    expect(result.messages[1]?.content).toContain('<unresolved_approvals>');
    expect(result.messages[1]?.content).toContain('approval-1');
    expect(result.metadata.activeSkillsSummary).toContain('Active skills update:');
    expect(result.metadata.availableToolsSummary).toContain('Tools catalog update:');
  });
});
