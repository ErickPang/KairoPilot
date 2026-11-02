import fs from 'node:fs';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import type { AgentRuntimeInvokeResult, SessionSummary } from '../src/shared/contracts';
import { KAIRO_INVOKE as C } from '../src/shared/ipc';
import { createRun, createRunStep, createToolCallRecord, getDb, getRunById, getApprovalRecord, getSessionById, updateRun } from '../src/main/store/chat';
import { stopApplicationExecution } from '../src/main/services/applicationExecutionLifecycle';
import { installQuitDraftProtection } from '../src/main/services/quitDraftProtection';

type Invoke = <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>;
type Assert = (value: unknown, label: string) => void;
interface CrashFixture { sessionId: string; runId: string; approvalId: string; target: string; runningId: string; pausedId: string }

export async function verifyFreshStartup(window: BrowserWindow, invoke: Invoke, freshId: string, previousId: string | undefined, assert: Assert) {
  const active = await invoke<SessionSummary>(C.chatGetActiveSummary);
  assert(active.id === freshId && active.id !== previousId && getSessionById(active.id)?.messages.length === 0, 'lifecycle: process startup selects an empty new conversation instead of the previous selection');
  const state = await window.webContents.executeJavaScript(`new Promise(resolve=>{const end=Date.now()+8000;const timer=setInterval(()=>{const input=document.querySelector('.chat-interface[data-session-id="${freshId}"] textarea');if(input){clearInterval(timer);resolve(input.value==='' && !document.querySelector('[data-inline-approval]'));}else if(Date.now()>end){clearInterval(timer);resolve(false);}},25);})`);
  assert(state, 'lifecycle: fresh startup has an empty composer and no previous approval card');
  assert(!(await invoke(C.chatGetPendingApproval, freshId)), 'lifecycle: new conversation inherits no pending approval');
}

export async function quitWithExecutionCleanup(window: BrowserWindow, invoke: Invoke, output: string, assert: Assert, report: () => void) {
  const fixture = JSON.parse(fs.readFileSync(path.join(output, 'batch2-restart.json'), 'utf8')) as { approvalId: string; runId: string };
  window.hide();
  assert(getRunById(fixture.runId)?.status === 'waiting_approval' && getApprovalRecord(fixture.approvalId)?.status === 'pending', 'lifecycle: hiding to tray preserves the current run and pending approval');
  window.show();
  const coordinator = installQuitDraftProtection(() => window, { beforeQuit: async () => {
    await stopApplicationExecution();
    assert(getRunById(fixture.runId)?.status === 'cancelled' && getApprovalRecord(fixture.approvalId)?.status === 'denied', 'lifecycle: real quit expires the pending run and approval before the process exits');
    assert(!(await invoke<AgentRuntimeInvokeResult>(C.agentConfirmResponse, { id: fixture.approvalId, approved: true })).success, 'lifecycle: old allow action is rejected during real quit');
    assert(!(getDb().prepare("SELECT id FROM task_message_queue WHERE status IN ('queued','dispatching') LIMIT 1").get()), 'lifecycle: real quit blocks queued execution');
  } });
  app.once('will-quit', () => { assert(coordinator.isApproved(), 'lifecycle: real Electron quit waits for draft save and execution cleanup'); report(); });
  app.quit();
}

export async function prepareAbruptExit(invoke: Invoke, output: string, assert: Assert) {
  const task = await invoke<SessionSummary>(C.chatCreateSession);
  const target = path.join(task.executionRoot!, 'must-not-write-after-restart.txt');
  const waiting = await invoke<AgentRuntimeInvokeResult>(C.agentChat, { sessionId: task.id, content: `WRITE_APPROVAL TARGET=${target}` });
  assert(waiting.status === 'waiting_approval', 'lifecycle: abrupt-exit fixture contains a real unapproved write checkpoint');
  const running = createRun(task.id, 'workbench', 'Interrupted running fixture');
  const step = createRunStep(running.id, 'tool_call', 'Interrupted tool', { status: 'running' });
  createToolCallRecord(running.id, step.id, 'read_file', { path: target });
  const paused = createRun(task.id, 'workbench', 'Interrupted paused fixture');
  updateRun(paused.id, { status: 'paused' });
  fs.writeFileSync(path.join(output, 'lifecycle-crash.json'), JSON.stringify({ sessionId: task.id, runId: waiting.runId, approvalId: waiting.approvalId, target, runningId: running.id, pausedId: paused.id } satisfies CrashFixture));
}

export async function verifyAbruptRestart(invoke: Invoke, output: string, freshId: string, assert: Assert) {
  const fixture = JSON.parse(fs.readFileSync(path.join(output, 'lifecycle-crash.json'), 'utf8')) as CrashFixture;
  for (const id of [fixture.runId, fixture.runningId, fixture.pausedId]) {
    const run = getRunById(id);
    assert(run?.status === 'cancelled' && !run.waitingApprovalId && Boolean(run.completedAt), 'lifecycle: abrupt restart cancels each running, waiting and paused execution');
  }
  assert(getApprovalRecord(fixture.approvalId)?.status === 'denied', 'lifecycle: abrupt restart expires the old pending approval');
  assert(!(getDb().prepare("SELECT id FROM run_steps WHERE run_id IN (?,?) AND status IN ('running','pending','waiting_approval')").get(fixture.runId, fixture.runningId)), 'lifecycle: interrupted steps no longer appear active');
  assert(!(getDb().prepare("SELECT id FROM tool_call_records WHERE run_id IN (?,?) AND status IN ('running','pending','waiting_approval')").get(fixture.runId, fixture.runningId)), 'lifecycle: interrupted tool records no longer appear active');
  assert(!(await invoke<AgentRuntimeInvokeResult>(C.agentConfirmResponse, { id: fixture.approvalId, approved: true })).success, 'lifecycle: stale allow request cannot execute after abrupt restart');
  assert(!(await invoke<AgentRuntimeInvokeResult>(C.agentResumeRun, { runId: fixture.pausedId })).success, 'lifecycle: stale paused checkpoint cannot resume after abrupt restart');
  assert(!fs.existsSync(fixture.target) && Boolean(getSessionById(fixture.sessionId)?.messages.length), 'lifecycle: interrupted write never executes and historical conversation remains readable');
  const result = await invoke<AgentRuntimeInvokeResult>(C.agentChat, { sessionId: freshId, content: 'New question after abrupt restart' });
  assert(result.status === 'completed', 'lifecycle: new conversation works without cancelling an old run manually');
}
