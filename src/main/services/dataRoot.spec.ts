import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
const electron = vi.hoisted(() => ({ isPackaged: false }));
vi.mock('electron', () => ({ app: electron }));
import { getKairoPilotDataRoot } from './dataRoot';
const previous = process.env.KAIROPILOT_TEST_ROOT;
const roots: string[] = [];
afterEach(() => { if (previous === undefined) delete process.env.KAIROPILOT_TEST_ROOT; else process.env.KAIROPILOT_TEST_ROOT = previous; electron.isPackaged = false; roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })); });
describe('isolated development data root', () => {
  it('keeps the normal home and accepts only a child of the temporary directory', () => {
    delete process.env.KAIROPILOT_TEST_ROOT;
    expect(getKairoPilotDataRoot('/example')).toBe(path.join('/example', '.kairopilot'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-p0-path-')); roots.push(root);
    process.env.KAIROPILOT_TEST_ROOT = path.join(root, 'new');
    expect(getKairoPilotDataRoot()).toBe(path.join(fs.realpathSync(root), 'new'));
  });
  it('rejects production mode, a relative path, the temporary root itself and a symlink escape', () => {
    process.env.KAIROPILOT_TEST_ROOT = 'relative'; expect(() => getKairoPilotDataRoot()).toThrow();
    process.env.KAIROPILOT_TEST_ROOT = os.tmpdir(); expect(() => getKairoPilotDataRoot()).toThrow();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-p0-path-')); roots.push(root);
    fs.symlinkSync(os.homedir(), path.join(root, 'outside'));
    process.env.KAIROPILOT_TEST_ROOT = path.join(root, 'outside', 'uncreated'); expect(() => getKairoPilotDataRoot()).toThrow();
    process.env.KAIROPILOT_TEST_ROOT = root; electron.isPackaged = true; expect(() => getKairoPilotDataRoot()).toThrow();
  });
});
