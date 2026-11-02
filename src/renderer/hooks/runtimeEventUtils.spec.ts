import { describe, expect, it, vi } from 'vitest';
import type { SessionContextState } from '../types';
import { applyRuntimeUpdateToSessionContext, isRuntimeUpdateForSession } from './runtimeEventUtils';

function createSessionContext(overrides: Partial<SessionContextState> = {}): SessionContextState {
  return {
    activeAgentId: 'agent-1',
    activeSessionId: 'session-1',
    appNotice: null,
    confirmationRequest: null,
    latestRun: {
      id: 'run-1',
      sessionId: 'session-1',
      agentId: 'agent-1',
      goal: 'goal',
      userInput: 'input',
      status: 'waiting_approval',
      waitingApprovalId: 'approval-1',
      createdAt: 1,
      updatedAt: 1
    },
    ...overrides
  };
}

describe('runtimeEventUtils', () => {
  it('routes initial events by trusted session and agent before the run summary loads', () => {
    expect(isRuntimeUpdateForSession(createSessionContext({ latestRun: null }), {
      type: 'assistant-delta', content: 'hello', delta: 'hello', runId: 'new-run', agentId: 'agent-1', sessionId: 'session-1'
    })).toBe(true);
  });

  it('rejects another session even when its run ID matches', () => {
    expect(applyRuntimeUpdateToSessionContext(createSessionContext(), {
      type: 'assistant-response', content: 'wrong task', runId: 'run-1', status: 'completed', sessionId: 'session-2'
    })).toEqual({});
  });

  it('accepts historical source metadata for the selected task but rejects unknown unscoped runs', () => {
    expect(isRuntimeUpdateForSession(createSessionContext(), {
      type: 'thinking', content: 'historical source', runId: 'run-1', agentId: 'agent-2', sessionId: 'session-1'
    })).toBe(true);
    expect(isRuntimeUpdateForSession(createSessionContext({ latestRun: null }), {
      type: 'thinking', content: 'unknown owner', runId: 'unknown'
    })).toBe(false);
  });

  it('failure events terminate the run and clear only its pending approval', () => {
    const patch = applyRuntimeUpdateToSessionContext(createSessionContext({ confirmationRequest: { id: 'approval-1', runId: 'run-1', sessionId: 'session-1', tool: 'write_file', args: {} } }), {
      type: 'run-failed', runId: 'run-1', status: 'failed', error: 'connection closed'
    });
    expect(patch.latestRun).toMatchObject({ status: 'failed', error: 'connection closed' });
    expect(patch.confirmationRequest).toBeNull();
  });

  it('late progress cannot turn a finished run back into running', () => {
    const context = createSessionContext();
    context.latestRun!.status = 'completed';
    const patch = applyRuntimeUpdateToSessionContext(context, { type: 'thinking', runId: 'run-1', content: 'late' });
    expect(patch.latestRun?.status).toBe('completed');
  });

  it('a tool result keeps the run active without rebuilding internal steps', () => {
    const patch = applyRuntimeUpdateToSessionContext(createSessionContext(), {
      type: 'tool-result', runId: 'run-1', stepId: 'step-1', tool: 'read_file', result: 'text', status: 'completed'
    });
    expect(patch.latestRun?.status).toBe('running');
    expect(Object.keys(patch)).not.toContain('activeRunSteps');
  });
  it('恢复执行后的进度事件会将 run 状态切回 running', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T04:00:00Z'));

    const patch = applyRuntimeUpdateToSessionContext(
      createSessionContext(),
      {
        type: 'thinking',
        content: 'Processing...',
        runId: 'run-1',
        status: 'running'
      }
    );

    expect(patch.latestRun).toEqual(expect.objectContaining({
      id: 'run-1',
      status: 'running',
      waitingApprovalId: undefined,
      updatedAt: Date.now()
    }));

    vi.useRealTimers();
  });

  it('同一 run 恢复执行时会清理遗留 confirmationRequest', () => {
    const patch = applyRuntimeUpdateToSessionContext(
      createSessionContext({
        confirmationRequest: {
          id: 'approval-1',
          tool: 'execute_command',
          args: { command: 'npm' },
          sessionId: 'session-1',
          runId: 'run-1'
        }
      }),
      {
        type: 'tool-call',
        tool: 'execute_command',
        args: { command: 'npm' },
        runId: 'run-1',
        stepId: 'step-2',
        status: 'running'
      }
    );

    expect(patch.confirmationRequest).toBeNull();
  });

  it('其他 run 的进度事件不会误清理当前 confirmationRequest', () => {
    const patch = applyRuntimeUpdateToSessionContext(
      createSessionContext({
        confirmationRequest: {
          id: 'approval-1',
          tool: 'execute_command',
          args: { command: 'npm' },
          sessionId: 'session-1',
          runId: 'run-1'
        }
      }),
      {
        type: 'tool-call',
        tool: 'read_file',
        args: { path: 'a.txt' },
        runId: 'run-2',
        stepId: 'step-9',
        status: 'running'
      }
    );

    expect(patch.confirmationRequest).toBeUndefined();
  });
});
