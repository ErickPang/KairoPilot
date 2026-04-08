import type {
  ApprovalRecord,
  AuditLogEntry,
  RunStep,
  RunTraceAggregations,
  RunTraceQuery,
  ToolCallRecord
} from '../../shared/contracts';

export const DEFAULT_RUN_TRACE_PAGE_SIZE = 8;
export const MAX_RUN_TRACE_PAGE_SIZE = 50;

export interface NormalizedRunTraceQuery {
  runId: string;
  page: number;
  pageSize: number;
  includeToolCalls: boolean;
  includeApprovalRecords: boolean;
  includeAuditLogs: boolean;
  includeContextSummary: boolean;
}

export function normalizeRunTraceQuery(query: RunTraceQuery | string): NormalizedRunTraceQuery {
  return {
    runId: typeof query === 'string' ? query : query.runId,
    page: typeof query === 'string' || !Number.isFinite(query.page) || Number(query.page) < 1
      ? 1
      : Math.floor(Number(query.page)),
    pageSize: typeof query === 'string' || !Number.isFinite(query.pageSize) || Number(query.pageSize) < 1
      ? DEFAULT_RUN_TRACE_PAGE_SIZE
      : Math.min(Math.floor(Number(query.pageSize)), MAX_RUN_TRACE_PAGE_SIZE),
    includeToolCalls: typeof query === 'string' ? true : query.includeToolCalls !== false,
    includeApprovalRecords: typeof query === 'string' ? true : query.includeApprovalRecords !== false,
    includeAuditLogs: typeof query === 'string' ? true : query.includeAuditLogs !== false,
    includeContextSummary: typeof query === 'string' ? true : query.includeContextSummary !== false
  };
}

export function paginateRunSteps(steps: RunStep[], page: number, pageSize: number) {
  const total = steps.length;
  const totalPages = total === 0 ? 1 : Math.ceil(total / pageSize);
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;

  return {
    total,
    totalPages,
    page: safePage,
    pageSize,
    steps: steps.slice(offset, offset + pageSize)
  };
}

export function buildRunTraceAggregations(
  allSteps: RunStep[],
  toolCalls: ToolCallRecord[],
  approvals: ApprovalRecord[],
  auditLogs: AuditLogEntry[]
): RunTraceAggregations {
  return {
    totalSteps: allSteps.length,
    completedSteps: allSteps.filter((step) => step.status === 'completed').length,
    failedSteps: allSteps.filter((step) => step.status === 'failed').length,
    waitingApprovalSteps: allSteps.filter((step) => step.status === 'waiting_approval').length,
    toolCallCount: toolCalls.length,
    successfulToolCallCount: toolCalls.filter((record) => record.status === 'success').length,
    approvalCount: approvals.length,
    approvedCount: approvals.filter((record) => record.status === 'approved').length,
    auditLogCount: auditLogs.length,
    auditErrorCount: auditLogs.filter((entry) => Boolean(entry.error)).length
  };
}
