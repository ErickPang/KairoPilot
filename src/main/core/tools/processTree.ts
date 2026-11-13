import { execFile, type ChildProcess } from 'node:child_process';

const TERMINATION_GRACE_MS = 3000;

function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

/** POSIX commands must be spawned in their own process group (detached: true). */
export async function terminateProcessTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (!pid) return;

  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        timeout: TERMINATION_GRACE_MS
      }, (error) => {
        if (error) reject(new Error('Unable to terminate the command process tree.'));
        else resolve();
      });
    });
    return;
  }

  if (!signalGroup(pid, 'SIGTERM')) return;
  // The parent can exit before its descendants; do not use child.exitCode here.
  await new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      try {
        if (!signalGroup(pid, 0)) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - started >= TERMINATION_GRACE_MS) {
          signalGroup(pid, 'SIGKILL');
          clearInterval(timer);
          resolve();
        }
      } catch (error) {
        clearInterval(timer);
        reject(error);
      }
    }, 50);
  });
}
