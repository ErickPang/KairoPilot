import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createExecuteCommandTool } from './shell';
import type { ToolExecutionResult } from './result';

let root: string;
let controller: AbortController;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'kairo-shell-'));
  controller = new AbortController();
});
afterEach(async () => {
  controller.abort();
  // Also clean up fixtures if an assertion or the tool itself fails.
  for (const name of ['parent.pid', 'child.pid']) {
    const pid = Number(await fs.readFile(path.join(root, name), 'utf8').catch(() => ''));
    if (pid > 0) { try { process.kill(pid, 'SIGKILL'); } catch { /* Already exited. */ } }
  }
  await fs.rm(root, { recursive: true, force: true });
});

async function waitForFile(name: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await fs.stat(path.join(root, name)).catch(() => null)) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Fixture did not create ${name}`);
}

async function createTree() {
  const script = path.join(root, 'tree.cjs');
  const descendant = `
    const fs = require('node:fs');
    process.on('SIGTERM', () => {});
    fs.writeFileSync('child.pid', String(process.pid));
    setInterval(() => fs.writeFileSync('heartbeat', String(Date.now())), 20);
  `;
  await fs.writeFile(script, `
    require('node:fs').writeFileSync('parent.pid', String(process.pid));
    require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'ignore' });
    setInterval(() => {}, 1000);
  `);
  return script;
}

async function expectHeartbeatStopped() {
  await new Promise(resolve => setTimeout(resolve, 100));
  const value = await fs.readFile(path.join(root, 'heartbeat'), 'utf8');
  await new Promise(resolve => setTimeout(resolve, 150));
  expect(await fs.readFile(path.join(root, 'heartbeat'), 'utf8')).toBe(value);
}

describe('command lifecycle', () => {
  it('preserves output and exit status for ordinary commands', async () => {
    const tool = createExecuteCommandTool(root);
    const result = await tool.execute({ command: process.execPath, args: ['-e', 'console.log("hello");console.error("failure");process.exit(7)'] }) as ToolExecutionResult;
    expect(result).toMatchObject({ ok: false, error: 'Command exited with code 7', details: { stdout: 'hello', stderr: 'failure', exitCode: 7 } });
    expect(await tool.execute({ command: process.execPath, args: ['-e', 'console.log("success")'] })).toMatchObject({ ok: true, data: { stdout: 'success', exitCode: 0 } });
  });

  it('does not spawn a command when already cancelled', async () => {
    controller.abort();
    const result = await createExecuteCommandTool(root).execute({ command: process.execPath, args: ['-e', 'require("fs").writeFileSync("unexpected", "bad")'] }, controller.signal);
    expect(result).toMatchObject({ ok: false, error: 'Command cancelled by user.' });
    expect(await fs.stat(path.join(root, 'unexpected')).catch(() => null)).toBeNull();
  });

  it('settles failed spawns instead of waiting for a timeout', async () => {
    expect(await createExecuteCommandTool(root).execute({ command: 'kairo-missing-command-fixture', args: [] })).toMatchObject({ ok: false });
  });

  it.skipIf(process.platform === 'win32')('cancels descendants even after the parent exits on SIGTERM', async () => {
    const script = await createTree();
    const pending = createExecuteCommandTool(root).execute({ command: process.execPath, args: [script] }, controller.signal);
    await waitForFile('heartbeat');
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, error: 'Command cancelled by user.' });
    await expectHeartbeatStopped();
  }, 10000);

  it.skipIf(process.platform === 'win32')('forces termination on timeout and reports it even when the parent exits cleanly', async () => {
    const script = await createTree();
    // The descendant ignores SIGTERM; the parent exits with code zero.
    await fs.appendFile(script, "process.on('SIGTERM', () => process.exit(0));");
    const pending = createExecuteCommandTool({ cwd: root, policy: { timeoutMs: 1000 } }).execute({ command: process.execPath, args: [script] }, controller.signal);
    await waitForFile('heartbeat');
    expect(await pending).toMatchObject({ ok: false, error: 'Command timed out after 1000 ms.' });
    await expectHeartbeatStopped();
  }, 10000);

  it.skipIf(process.platform === 'win32')('terminates output-overflow commands before returning the error', async () => {
    const script = path.join(root, 'overflow.cjs');
    await fs.writeFile(script, `require('fs').writeFileSync('parent.pid', String(process.pid));process.on('SIGTERM',()=>{});console.log('x'.repeat(4096));setInterval(()=>{},1000);`);
    const result = await createExecuteCommandTool({ cwd: root, policy: { maxBufferBytes: 64 } }).execute({ command: process.execPath, args: [script] }, controller.signal);
    expect(result).toMatchObject({ ok: false, error: 'Command output exceeded max buffer size of 64 bytes.' });
    const pid = Number(await fs.readFile(path.join(root, 'parent.pid'), 'utf8'));
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(() => process.kill(pid, 0)).toThrow();
  }, 10000);
});
