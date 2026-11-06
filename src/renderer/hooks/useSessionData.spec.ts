import { describe, expect, it } from 'vitest';
import type { ApprovalRecord } from '../../shared/contracts';
import { createRunStatePatchForSession, mapApprovalToConfirmationRequest } from './useSessionData';

describe('mapApprovalToConfirmationRequest', () => {
  it('ignores a delayed run response after switching to another task or clearing selection', () => {
    const result = { targetSessionId: 'old-session', latestRun: null, confirmationRequest: null };
    expect(createRunStatePatchForSession({ ...result, activeSessionId: 'new-session' })).toBeNull();
    expect(createRunStatePatchForSession({ ...result, activeSessionId: null })).toBeNull();
  });
  it('在审批记录标记为脱敏时优先展示 redactedArgs', () => {
    const approval: ApprovalRecord = {
      id: 'approval-1',
      runId: 'run-1',
      sessionId: 'session-1',
      toolName: 'execute_command',
      args: {
        command: 'npm',
        token: 'raw-secret-token'
      },
      status: 'pending',
      metadata: {
        redacted: true,
        redactedArgs: {
          command: 'npm',
          token: '[REDACTED]'
        }
      },
      createdAt: 1,
      updatedAt: 1
    };

    expect(mapApprovalToConfirmationRequest(approval)).toEqual(expect.objectContaining({
      args: {
        command: 'npm',
        token: '[REDACTED]'
      },
      redacted: true
    }));
  });

  it('在未脱敏时保留原始参数', () => {
    const approval: ApprovalRecord = {
      id: 'approval-2',
      runId: 'run-2',
      sessionId: 'session-2',
      toolName: 'read_file',
      args: {
        path: '/tmp/demo.txt'
      },
      status: 'pending',
      metadata: {
        redacted: false
      },
      createdAt: 1,
      updatedAt: 1
    };

    expect(mapApprovalToConfirmationRequest(approval)).toEqual(expect.objectContaining({
      args: {
        path: '/tmp/demo.txt'
      },
      redacted: false
    }));
  });
});
