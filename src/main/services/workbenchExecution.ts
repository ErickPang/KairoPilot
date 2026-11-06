import { getDb, getLatestRun } from '../store/chat';
let executingTask: string | null = null;
let shuttingDown = false;
export function setWorkbenchShuttingDown(value: boolean) { shuttingDown = value; }
export function isWorkbenchShuttingDown() { return shuttingDown; }
export function hasLiveTaskExecution() { return executingTask !== null; }
export function isWorkbenchBusy(){return shuttingDown || Boolean(executingTask||getDb().prepare("SELECT id FROM runs WHERE status IN ('running','waiting_approval','paused') LIMIT 1").get());}
export function isTaskExecuting(sessionId: string) { return executingTask === sessionId; }
export function assertTaskMutable(sessionId: string) {
  if (isTaskExecuting(sessionId) || ['running','waiting_approval','paused'].includes(getLatestRun(sessionId)?.status || '')) throw new Error('Finish or cancel this task’s pending run first.');
}
export function assertWorkbenchIdle() {
  if (executingTask || getDb().prepare("SELECT id FROM runs WHERE status IN ('running','waiting_approval','paused') LIMIT 1").get()) throw new Error('Finish or cancel the pending run before changing execution configuration.');
}
export async function withTaskExecution<T>(sessionId: string, operation: () => Promise<T>, options: { resumeRunId?: string; cancellation?: boolean } = {}): Promise<T> {
  if (shuttingDown) throw new Error('Application is quitting. Start a new conversation after reopening.');
  if (executingTask) throw new Error('A task execution is already in progress.');
  if (!options.cancellation) {
    const conflicts = getDb().prepare("SELECT id FROM runs WHERE status IN ('running','waiting_approval','paused') AND id != ? LIMIT 1").get(options.resumeRunId || '');
    if (conflicts) throw new Error('Finish or cancel the pending run before starting another task.');
  }
  executingTask = sessionId;
  try { return await operation(); } finally { executingTask = null; }
}

export function assertNoLiveExecution() { if (executingTask) throw new Error('Pause or cancel the active execution first.'); }
