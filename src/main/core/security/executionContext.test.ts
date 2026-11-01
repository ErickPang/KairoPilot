import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultAgentPermissions, type AgentConfig, type RunExecutionContext } from '../../../shared/contracts';
import { assertExecutionDirectory, guardForExecution } from './executionContext';
import { createCodebaseTools } from '../tools/codebase';
import { createPermissionGuardedTool } from '../agent/toolPipeline';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-project-test-')));
  roots.push(root);
  for (const name of ['agent', 'projects/A', 'projects/A-sibling', 'outside']) fs.mkdirSync(path.join(root, name), { recursive: true });
  const agent: AgentConfig = { id: 'synthetic', name: 'Synthetic', model: 'fixture/model', workspace: path.join(root, 'agent'), systemPrompt: '', permissions: {
    ...createDefaultAgentPermissions(), executionProfile: 'approved_execution', fileSystem: { read: true, write: true, allowedPaths: [path.join(root, 'projects')] }
  } };
  const context: RunExecutionContext = { version:2, agentId: agent.id, agentWorkspace: agent.workspace, executionRoot: path.join(root, 'projects/A'), projectId: 'p', model: agent.model, provider: 'custom', permissionsHash: '' };
  return { root, agent, context };
}
describe('project execution boundaries', () => {
  it('does not grant permissions when binding; rejects sibling-prefix and symlink escapes', () => {
    const { root, agent, context } = fixture();
    expect(() => assertExecutionDirectory(agent, path.join(root, 'outside'))).toThrow('permissions');
    const guard = guardForExecution(agent, context);
    expect(guard.checkFileSystem(path.join(root, 'projects/A/output.txt'), 'write')).toBe(true);
    expect(guard.checkFileSystem(path.join(root, 'projects/A-sibling/output.txt'), 'write')).toBe(false);
    fs.symlinkSync(path.join(root, 'outside'), path.join(context.executionRoot, 'link'));
    expect(guard.checkFileSystem(path.join(context.executionRoot, 'link/output.txt'), 'write')).toBe(false);
    agent.permissions.fileSystem.allowedPaths = [];
    expect(()=>guardForExecution(agent,{...context,version:undefined})).toThrow('Unsupported execution snapshot');
  });
  it('code search excludes protected files; edit cannot bypass project write permissions', async () => {
    const { root, agent, context } = fixture();
    fs.writeFileSync(path.join(context.executionRoot, 'readme.txt'), 'needle public');
    fs.writeFileSync(path.join(context.executionRoot, 'AGENTS.md'), 'needle hidden');
    const guard = guardForExecution(agent, context);
    const tools = createCodebaseTools(context.executionRoot, guard).map((tool) => createPermissionGuardedTool(tool, guard));
    const result = await tools[0].executeApproved({ pattern: 'needle', output_mode: 'content' });
    expect(JSON.stringify(result)).toContain('needle public');
    expect(JSON.stringify(result)).not.toContain('needle hidden');
    const denied = await tools[2].executeApproved({ file_path: path.join(root, 'projects/A-sibling/a.txt'), old_string: 'a', new_string: 'b' });
    expect(denied).toEqual(expect.objectContaining({ ok: false }));
    const readonly = { ...agent, permissions: { ...agent.permissions, executionProfile: 'read_only_workspace' as const } };
    const readGuard = guardForExecution(readonly, context);
    const edit = createPermissionGuardedTool(createCodebaseTools(context.executionRoot, readGuard)[2], readGuard);
    expect(await edit.executeApproved({ file_path: path.join(context.executionRoot, 'readme.txt'), old_string: 'needle', new_string: 'changed' })).toEqual(expect.objectContaining({ ok: false }));
  });
});
