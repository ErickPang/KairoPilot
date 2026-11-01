import { describe, expect, it } from 'vitest';
import type { ApprovalRecord, AuditLogEntry, RunStep, ToolCallRecord } from '../../shared/contracts';
import { buildRunTraceAggregations, MAX_RUN_TRACE_PAGE_SIZE, normalizeRunTraceQuery, paginateRunSteps } from './chat_trace_utils';

function createRunStep(overrides: Partial<RunStep> = {}): RunStep {
  return {
    id: 'step-1',
    runId: 'run-1',
    stepIndex: 0,
    type: 'plan',
    status: 'completed',
    title: 'step',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}

function createToolCallRecord(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    id: 'tool-1',
    runId: 'run-1',
    stepId: 'step-1',
    toolName: 'read_file',
    status: 'success',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}

function createApprovalRecord(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    id: 'approval-1',
    runId: 'run-1',
    stepId: 'step-1',
    toolName: 'delete_file',
    args: { path: 'a.txt' },
    status: 'pending',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}

function createAuditLog(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 'audit-1',
    timestamp: 1,
    tool: 'read_file',
    args: { path: 'a.txt' },
    stepId: 'step-1',
    runId: 'run-1',
    ...overrides
  };
}

describe('chat_trace_utils', () => {
  it('归一化 Run Trace 查询参数并限制页大小', () => {
    expect(normalizeRunTraceQuery({
      runId: 'run-1',
      page: 0,
      pageSize: 999,
      includeToolCalls: false,
      includeApprovalRecords: false,
      includeAuditLogs: false,
      includeContextSummary: false
    })).toEqual({
      runId: 'run-1',
      page: 1,
      pageSize: MAX_RUN_TRACE_PAGE_SIZE,
      includeToolCalls: false,
      includeApprovalRecords: false,
      includeAuditLogs: false,
      includeContextSummary: false
    });

    expect(normalizeRunTraceQuery('run-2')).toEqual({
      runId: 'run-2',
      page: 1,
      pageSize: 8,
      includeToolCalls: true,
      includeApprovalRecords: true,
      includeAuditLogs: true,
      includeContextSummary: true
    });
  });

  it('按页切分步骤，并在超出最大页码时回退到最后一页', () => {
    const steps = [
      createRunStep({ id: 'step-1', stepIndex: 0 }),
      createRunStep({ id: 'step-2', stepIndex: 1 }),
      createRunStep({ id: 'step-3', stepIndex: 2 }),
      createRunStep({ id: 'step-4', stepIndex: 3 })
    ];

    expect(paginateRunSteps(steps, 2, 2)).toEqual({
      total: 4,
      totalPages: 2,
      page: 2,
      pageSize: 2,
      steps: [steps[2], steps[3]]
    });

    expect(paginateRunSteps(steps, 9, 3)).toEqual({
      total: 4,
      totalPages: 2,
      page: 2,
      pageSize: 3,
      steps: [steps[3]]
    });
  });

  it('基于全部步骤、工具、审批和审计记录计算聚合统计', () => {
    const steps = [
      createRunStep({ id: 'step-1', status: 'completed' }),
      createRunStep({ id: 'step-2', status: 'failed' }),
      createRunStep({ id: 'step-3', status: 'waiting_approval' }),
      createRunStep({ id: 'step-4', status: 'pending' })
    ];
    const toolCalls = [
      createToolCallRecord({ id: 'tool-1', status: 'success' }),
      createToolCallRecord({ id: 'tool-2', status: 'failed' }),
      createToolCallRecord({ id: 'tool-3', status: 'waiting_approval' })
    ];
    const approvals = [
      createApprovalRecord({ id: 'approval-1', status: 'approved' }),
      createApprovalRecord({ id: 'approval-2', status: 'pending' })
    ];
    const auditLogs = [
      createAuditLog({ id: 'audit-1' }),
      createAuditLog({ id: 'audit-2', error: 'permission denied' })
    ];

    expect(buildRunTraceAggregations(steps, toolCalls, approvals, auditLogs)).toEqual({
      totalSteps: 4,
      completedSteps: 1,
      failedSteps: 1,
      waitingApprovalSteps: 1,
      toolCallCount: 3,
      successfulToolCallCount: 1,
      approvalCount: 2,
      approvedCount: 1,
      auditLogCount: 2,
      auditErrorCount: 1
    });
  });
});
