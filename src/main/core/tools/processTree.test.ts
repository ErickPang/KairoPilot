import type { ChildProcess } from 'node:child_process';
import { execFile } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { terminateProcessTree } from './processTree';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
const child = { pid: 12345, exitCode: 0 } as ChildProcess;
function platform(value: string) {
  vi.stubGlobal('process', new Proxy(process, { get: (target, key) => key === 'platform' ? value : Reflect.get(target, key) }));
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('process tree termination', () => {
  it('force-kills a surviving POSIX group even if the parent already exited', async () => {
    platform('darwin');
    vi.useFakeTimers();
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    const stopped = terminateProcessTree(child);
    await vi.advanceTimersByTimeAsync(3000);
    await stopped;
    expect(kill).toHaveBeenCalledWith(-12345, 'SIGTERM');
    expect(kill).toHaveBeenCalledWith(-12345, 'SIGKILL');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not leave a force-kill timer after a group exits gracefully', async () => {
    platform('linux');
    vi.useFakeTimers();
    const kill = vi.spyOn(process, 'kill').mockReturnValueOnce(true).mockImplementation(() => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); });
    const stopped = terminateProcessTree(child);
    await vi.advanceTimersByTimeAsync(50);
    await stopped;
    expect(kill).not.toHaveBeenCalledWith(-12345, 'SIGKILL');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('uses the Windows process-tree command without a shell', async () => {
    platform('win32');
    vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
      (args[3] as (error: Error | null) => void)(null);
      return {} as ChildProcess;
    });
    await terminateProcessTree(child);
    expect(execFile).toHaveBeenCalledWith('taskkill', ['/PID', '12345', '/T', '/F'], { windowsHide: true, timeout: 3000 }, expect.any(Function));
  });
  it('reports a failed Windows tree termination instead of claiming success', async () => {
    platform('win32');
    vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
      (args[3] as (error: Error) => void)(new Error('Access denied'));
      return {} as ChildProcess;
    });
    await expect(terminateProcessTree(child)).rejects.toThrow('Unable to terminate');
  });
});
