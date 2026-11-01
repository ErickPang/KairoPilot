import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const store = vi.hoisted(() => ({ insertArtifact: vi.fn(), insertVerification: vi.fn() }));
vi.mock('../../store/workbench', () => store);
vi.mock('../../store/chat', () => ({ getRunById: () => ({ id: 'r', sessionId: 's', executionContext: { executionRoot: '/synthetic' } }) }));
import { prepareTaskEvidence, recordTaskEvidence } from './taskEvidence';
import { PermissionGuard } from '../security/permissions';
import { WriteFileTool } from '../tools/filesystem';
import { createExecuteCommandTool } from '../tools/shell';
import { toolError, toolOk } from '../tools/result';

const roots: string[] = [];
beforeEach(() => { store.insertArtifact.mockReset(); store.insertVerification.mockReset(); });
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
describe('trusted task evidence', () => {
  it('captures the user’s existing text before a real file write and records only the associated path', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kairo-evidence-test-')); roots.push(root);
    const target = path.join(root, 'proof.txt');
    await fs.writeFile(target, 'USER_EXISTING');
    const guard = new PermissionGuard({ executionProfile: 'approved_execution', fileSystem: { read: true, write: true, allowedPaths: [root] }, shell: { enabled: false, allowedCommands: [] }, network: { enabled: false } });
    const args = { path: target, content: 'TOOL_OUTPUT' };
    const file = await prepareTaskEvidence(WriteFileTool, args, guard);
    const output = await WriteFileTool.execute(args);
    await recordTaskEvidence({ runId: 'r', toolCallId: 'call', tool: WriteFileTool, args, output, guard, file, interrupted: false });
    expect(store.insertArtifact).toHaveBeenCalledWith(expect.objectContaining({ runId: 'r', sessionId: 's', path: target, operation: 'modified', diffAvailable: true }), 'USER_EXISTING', 'TOOL_OUTPUT');
  });
  it('does not turn failed/interrupted writes or assistant assertions into artifact evidence', async () => {
    const guard = {} as PermissionGuard;
    await recordTaskEvidence({ runId: 'r', toolCallId: 'call', tool: WriteFileTool, args: {}, output: toolError('failed'), guard, file: { target: '/synthetic', before: {} }, interrupted: false });
    await recordTaskEvidence({ runId: 'r', toolCallId: 'call', tool: WriteFileTool, args: {}, output: toolOk({}), guard, file: { target: '/synthetic', before: {} }, interrupted: true });
    expect(store.insertArtifact).not.toHaveBeenCalled();
  });
  it.each([0, 7, undefined])('records the actual verification exit code %s separately from run completion', async (exitCode) => {
    const tool = createExecuteCommandTool('/synthetic');
    await recordTaskEvidence({ runId: 'r', toolCallId: 'call', tool, args: { command: 'node', args: ['check.mjs'], verification: true }, output: exitCode === 0 ? toolOk({ exitCode, stdout: 'checked' }) : toolError('failed', { exitCode }), guard: {} as PermissionGuard, interrupted: false });
    expect(store.insertVerification).toHaveBeenCalledWith(expect.objectContaining({ status: exitCode === 0 ? 'passed' : exitCode === undefined ? 'interrupted' : 'failed', exitCode }));
  });
});
