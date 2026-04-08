import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ToolDefinition } from '../llm/types';
import { PermissionGuard } from '../security/permissions';
import { CapabilityOrchestrator } from './capabilityOrchestrator';

function createTool(name: string): ToolDefinition {
  return {
    name,
    description: name,
    parameters: z.object({}),
    execute: async () => ({ ok: true })
  };
}

function createGuard() {
  return new PermissionGuard({
    executionProfile: 'approved_execution',
    fileSystem: { read: true, write: true, allowedPaths: ['/tmp'] },
    network: { enabled: true },
    shell: { enabled: true, allowedCommands: ['npm'] }
  });
}

describe('CapabilityOrchestrator', () => {
  it('在未加载技能时暴露当前权限允许的全部工具', () => {
    const orchestrator = new CapabilityOrchestrator(createGuard());
    for (const toolName of ['read_file', 'execute_command', 'web_search', 'load_skill']) {
      orchestrator.registerTool(createTool(toolName));
    }

    expect(orchestrator.getExposedTools().map((tool) => tool.name)).toEqual([
      'read_file',
      'execute_command',
      'web_search',
      'load_skill'
    ]);
  });

  it('在加载技能后按 allowed-tools 收敛暴露工具', () => {
    const orchestrator = new CapabilityOrchestrator(createGuard());
    for (const toolName of ['read_file', 'execute_command', 'web_search', 'load_skill', 'read_skill_resource']) {
      orchestrator.registerTool(createTool(toolName));
    }

    orchestrator.activateSkill('Issue Triage', ['Read', 'RunCommand']);

    expect(orchestrator.getExposedTools().map((tool) => tool.name)).toEqual([
      'read_file',
      'execute_command',
      'load_skill',
      'read_skill_resource'
    ]);
  });

  it('在技能声明通配符时保留全部权限范围内工具', () => {
    const orchestrator = new CapabilityOrchestrator(createGuard());
    for (const toolName of ['read_file', 'execute_command', 'web_search', 'load_skill']) {
      orchestrator.registerTool(createTool(toolName));
    }

    orchestrator.activateSkill('Power Skill', ['*']);

    expect(orchestrator.getExposedTools().map((tool) => tool.name)).toEqual([
      'read_file',
      'execute_command',
      'web_search',
      'load_skill'
    ]);
  });

  it('即使技能允许也不会暴露被权限关闭的工具', () => {
    const orchestrator = new CapabilityOrchestrator(new PermissionGuard({
      executionProfile: 'approved_execution',
      fileSystem: { read: true, write: true, allowedPaths: ['/tmp'] },
      network: { enabled: false },
      shell: { enabled: false, allowedCommands: [] }
    }));
    for (const toolName of ['read_file', 'execute_command', 'web_search', 'load_skill']) {
      orchestrator.registerTool(createTool(toolName));
    }

    orchestrator.activateSkill('Research Brief', ['RunCommand', 'WebSearch', 'Read']);

    expect(orchestrator.getExposedTools().map((tool) => tool.name)).toEqual([
      'read_file',
      'load_skill'
    ]);
  });
});
