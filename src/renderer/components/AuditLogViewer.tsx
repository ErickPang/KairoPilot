import { memo, useState, useEffect, useMemo, useCallback } from 'react';
import { AuditLogEntry, AuditLogQueryResult, RunQueryResult, RunQueryStatus, RunStep, RunSummary, RunTrace } from '../types';
import { IconArrowLeft, IconRefresh, IconShield, IconTool, IconCheck, IconX } from './Icons';
import { Select } from './Select';
import { useTranslation } from '../hooks/useTranslation';
import './AuditLogViewer.css';
import { KAIRO_INVOKE } from '../../shared/ipc';
import { resolvePreferredTraceSelection } from './chat_trace_utils';
import { getErrorMessage, logRendererError } from '../hooks/errorUtils';

const RUN_PAGE_SIZE = 12;
const AUDIT_PAGE_SIZE = 20;
const TRACE_PAGE_SIZE = 50;

type TraceDetailFilter = 'all' | 'io' | 'tools' | 'approvals' | 'audits' | 'summary';

interface AuditLogViewerProps {
  scopedRunId?: string | null;
  onClearScopedRun?: () => void;
  onReportError?: (message: string, source: string) => void;
  latestRun?: RunSummary | null;
  activeRunSteps?: RunStep[];
  handleCancelRun?: () => void;
  handlePauseRun?: () => void;
  handleResumeRun?: () => void;
  handleRetryStep?: (stepId: string) => void;
}

function formatDateTime(timestamp?: number) {
  if (!timestamp) {
    return '—';
  }
  return new Date(timestamp).toLocaleString();
}

function stringifyContent(value: unknown) {
  if (value === undefined || value === null) {
    return '—';
  }
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function createEmptyRunResult(): RunQueryResult {
  return {
    items: [],
    total: 0,
    page: 1,
    pageSize: RUN_PAGE_SIZE,
    totalPages: 1,
    aggregations: {
      totalRuns: 0,
      runningRuns: 0,
      waitingApprovalRuns: 0,
      pausedRuns: 0,
      completedRuns: 0,
      failedRuns: 0,
      cancelledRuns: 0,
      statuses: []
    }
  };
}

function createEmptyAuditResult(): AuditLogQueryResult {
  return {
    items: [],
    total: 0,
    page: 1,
    pageSize: AUDIT_PAGE_SIZE,
    totalPages: 1,
    aggregations: {
      successCount: 0,
      errorCount: 0,
      tools: [],
      tags: []
    }
  };
}

function getStatusTone(status?: string) {
  if (status === 'failed' || status === 'cancelled' || status === 'error' || status === 'denied') {
    return 'error';
  }
  if (status === 'waiting_approval' || status === 'paused' || status === 'pending') {
    return 'warning';
  }
  return 'success';
}

const AuditLogViewer = memo(function AuditLogViewer({
  scopedRunId,
  onClearScopedRun,
  onReportError,
  latestRun,
  activeRunSteps = [],
  handleCancelRun,
  handlePauseRun,
  handleResumeRun,
  handleRetryStep
}: AuditLogViewerProps) {
  const { t } = useTranslation();
  const [runResult, setRunResult] = useState<RunQueryResult>(createEmptyRunResult);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runSearchText, setRunSearchText] = useState('');
  const [runStatusFilter, setRunStatusFilter] = useState<RunQueryStatus>('all');
  const [runPage, setRunPage] = useState(1);
  const [detailRunId, setDetailRunId] = useState<string | null>(scopedRunId || null);
  const [isDetailPage, setIsDetailPage] = useState(Boolean(scopedRunId));
  const [result, setResult] = useState<AuditLogQueryResult>(createEmptyAuditResult);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error'>('all');
  const [toolFilter, setToolFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [traceFilter, setTraceFilter] = useState<TraceDetailFilter>('all');
  const [trace, setTrace] = useState<RunTrace | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);

  const currentRunId = isDetailPage ? (scopedRunId || detailRunId) : null;
  const logs = result.items;

  const getRunStatusLabel = useCallback((status: RunSummary['status']) => {
    switch (status) {
      case 'waiting_approval':
        return t('chat.runStatus.waitingApproval');
      case 'completed':
        return t('chat.runStatus.completed');
      case 'paused':
        return t('chat.runStatus.paused');
      case 'cancelled':
        return t('chat.runStatus.cancelled');
      case 'failed':
        return t('chat.runStatus.failed');
      default:
        return t('chat.runStatus.running');
    }
  }, [t]);

  const getStepStatusLabel = useCallback((status: RunStep['status']) => {
    switch (status) {
      case 'waiting_approval':
        return t('chat.runStatus.waitingApproval');
      case 'completed':
        return t('chat.runStatus.completed');
      case 'failed':
        return t('chat.runStatus.failed');
      case 'cancelled':
        return t('chat.runStatus.cancelled');
      case 'pending':
        return t('chat.runStatus.pending');
      default:
        return t('chat.runStatus.running');
    }
  }, [t]);

  const getStepTypeLabel = useCallback((type: RunStep['type']) => {
    switch (type) {
      case 'plan':
        return t('chat.runStepType.plan');
      case 'model_call':
        return t('chat.runStepType.modelCall');
      case 'tool_call':
        return t('chat.runStepType.toolCall');
      case 'approval_wait':
        return t('chat.runStepType.approvalWait');
      case 'tool_result':
        return t('chat.runStepType.toolResult');
      case 'summary':
        return t('chat.runStepType.summary');
      case 'complete':
        return t('chat.runStepType.complete');
      case 'failed':
        return t('chat.runStepType.failed');
      default:
        return type;
    }
  }, [t]);

  const fetchRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const data = await window.kairo.invoke(KAIRO_INVOKE.chatQueryRuns, {
        page: runPage,
        pageSize: RUN_PAGE_SIZE,
        search: runSearchText.trim() || undefined,
        status: runStatusFilter
      });
      setRunResult(data);
    } catch (error) {
      logRendererError('Failed to load runs', error);
      onReportError?.(t('audit.error.loadRuns', { error: getErrorMessage(error) }), 'audit_runs');
      setRunResult(createEmptyRunResult());
    } finally {
      setRunsLoading(false);
    }
  }, [onReportError, runPage, runSearchText, runStatusFilter, t]);

  const fetchLogs = useCallback(async () => {
    if (!currentRunId) {
      setResult(createEmptyAuditResult());
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await window.kairo.invoke(KAIRO_INVOKE.auditGet, {
        page,
        pageSize: AUDIT_PAGE_SIZE,
        search: searchText.trim() || undefined,
        status: statusFilter,
        tool: toolFilter !== 'all' ? toolFilter : undefined,
        tag: tagFilter !== 'all' ? tagFilter : undefined,
        runId: currentRunId
      });
      setResult(data);
    } catch (error) {
      logRendererError('Failed to load audit logs', error);
      onReportError?.(t('audit.error.loadLogs', { error: getErrorMessage(error) }), 'audit_logs');
      setResult(createEmptyAuditResult());
    } finally {
      setLoading(false);
    }
  }, [currentRunId, onReportError, page, searchText, statusFilter, t, tagFilter, toolFilter]);

  const fetchTrace = useCallback(async (runId: string | null) => {
    if (!runId) {
      setTrace(null);
      setTraceLoading(false);
      setSelectedStepId(null);
      return;
    }

    setTraceLoading(true);
    try {
      const data = await window.kairo.invoke(KAIRO_INVOKE.chatGetRunTrace, {
        runId,
        page: 1,
        pageSize: TRACE_PAGE_SIZE,
        includeToolCalls: true,
        includeApprovalRecords: true,
        includeAuditLogs: true,
        includeContextSummary: true
      });
      setTrace(data);
      setSelectedStepId((current) => resolvePreferredTraceSelection(data?.steps || [], current).stepId);
    } catch (error) {
      logRendererError('Failed to load run trace', error);
      onReportError?.(t('audit.error.loadTrace', { error: getErrorMessage(error) }), 'audit_trace');
      setTrace(null);
    } finally {
      setTraceLoading(false);
    }
  }, [onReportError, t]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void fetchRuns();
    }, runSearchText.trim() ? 250 : 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [fetchRuns, runSearchText]);

  useEffect(() => {
    if (!scopedRunId) {
      return;
    }
    setDetailRunId(scopedRunId);
    setIsDetailPage(true);
  }, [scopedRunId]);

  useEffect(() => {
    if (!isDetailPage || !currentRunId) {
      setTrace(null);
      setResult(createEmptyAuditResult());
      setSelectedStepId(null);
      return;
    }
    setPage(1);
    setSearchText('');
    setStatusFilter('all');
    setToolFilter('all');
    setTagFilter('all');
  }, [currentRunId, isDetailPage]);

  useEffect(() => {
    if (!isDetailPage) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void fetchLogs();
    }, searchText.trim() ? 250 : 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [fetchLogs, isDetailPage, searchText]);

  useEffect(() => {
    if (!isDetailPage) {
      return;
    }

    let cancelled = false;

    const loadTrace = async () => {
      if (!currentRunId) {
        setTrace(null);
        setTraceLoading(false);
        setSelectedStepId(null);
        return;
      }

      setTraceLoading(true);
      try {
        const data = await window.kairo.invoke(KAIRO_INVOKE.chatGetRunTrace, {
          runId: currentRunId,
          page: 1,
          pageSize: TRACE_PAGE_SIZE,
          includeToolCalls: true,
          includeApprovalRecords: true,
          includeAuditLogs: true,
          includeContextSummary: true
        });
        if (cancelled) {
          return;
        }
        setTrace(data);
        setSelectedStepId((current) => resolvePreferredTraceSelection(data?.steps || [], current).stepId);
      } catch (error) {
        if (!cancelled) {
          logRendererError('Failed to load run trace', error);
          onReportError?.(t('audit.error.loadTrace', { error: getErrorMessage(error) }), 'audit_trace');
          setTrace(null);
        }
      } finally {
        if (!cancelled) {
          setTraceLoading(false);
        }
      }
    };

    void loadTrace();

    return () => {
      cancelled = true;
    };
  }, [activeRunSteps.length, currentRunId, isDetailPage, latestRun?.id, latestRun?.status, latestRun?.updatedAt, onReportError, t]);

  const runSteps = useMemo(() => {
    if (latestRun?.id === currentRunId && activeRunSteps.length > 0) {
      return activeRunSteps;
    }
    return trace?.steps || [];
  }, [activeRunSteps, currentRunId, latestRun?.id, trace?.steps]);

  useEffect(() => {
    if (!isDetailPage) {
      return;
    }
    if (runSteps.length === 0) {
      setSelectedStepId(null);
      return;
    }
    setSelectedStepId((current) => resolvePreferredTraceSelection(runSteps, current).stepId);
  }, [isDetailPage, runSteps]);

  const runSummary = useMemo(() => {
    if (!currentRunId) {
      return null;
    }
    return trace?.run
      || runResult.items.find((item) => item.id === currentRunId)
      || (latestRun?.id === currentRunId ? latestRun : null);
  }, [currentRunId, latestRun, runResult.items, trace?.run]);

  const toolOptions = useMemo(() => result.aggregations.tools, [result.aggregations.tools]);
  const tagOptions = useMemo(() => result.aggregations.tags, [result.aggregations.tags]);

  const runStatusSelectOptions = useMemo(() => {
    return [
      { value: 'all', label: t('audit.runStatusAll') },
      { value: 'running', label: t('chat.runStatus.running') },
      { value: 'waiting_approval', label: t('chat.runStatus.waitingApproval') },
      { value: 'paused', label: t('chat.runStatus.paused') },
      { value: 'completed', label: t('chat.runStatus.completed') },
      { value: 'failed', label: t('chat.runStatus.failed') },
      { value: 'cancelled', label: t('chat.runStatus.cancelled') }
    ];
  }, [t]);

  const statusSelectOptions = useMemo(() => {
    return [
      { value: 'all', label: t('audit.statusAll') },
      { value: 'success', label: t('audit.statusSuccess') },
      { value: 'error', label: t('audit.statusError') }
    ];
  }, [t]);

  const toolSelectOptions = useMemo(() => {
    return [
      { value: 'all', label: t('audit.toolAll') },
      ...toolOptions.map((tool) => ({ value: tool.value, label: `${tool.value} (${tool.count})` }))
    ];
  }, [t, toolOptions]);

  const tagSelectOptions = useMemo(() => {
    return [
      { value: 'all', label: t('audit.tagAll') },
      ...tagOptions.map((tag) => ({ value: tag.value, label: `${tag.value} (${tag.count})` }))
    ];
  }, [t, tagOptions]);

  const traceFilterOptions = useMemo(() => {
    return [
      { value: 'all' as TraceDetailFilter, label: t('chat.runTraceFilterAll') },
      { value: 'io' as TraceDetailFilter, label: t('chat.runTraceFilterIo') },
      { value: 'tools' as TraceDetailFilter, label: t('chat.runTraceFilterTools') },
      { value: 'approvals' as TraceDetailFilter, label: t('chat.runTraceFilterApprovals') },
      { value: 'audits' as TraceDetailFilter, label: t('chat.runTraceFilterAudits') },
      { value: 'summary' as TraceDetailFilter, label: t('chat.runTraceFilterSummary') }
    ];
  }, [t]);

  const selectedStep = useMemo(() => {
    return runSteps.find((step) => step.id === selectedStepId) || null;
  }, [runSteps, selectedStepId]);

  const selectedStepIndex = useMemo(() => {
    return runSteps.findIndex((step) => step.id === selectedStepId);
  }, [runSteps, selectedStepId]);

  const selectedStepToolCalls = useMemo(() => {
    return selectedStepId ? trace?.toolCalls.filter((item) => item.stepId === selectedStepId) || [] : [];
  }, [selectedStepId, trace?.toolCalls]);

  const selectedStepApprovals = useMemo(() => {
    return selectedStepId ? trace?.approvals.filter((item) => item.stepId === selectedStepId) || [] : [];
  }, [selectedStepId, trace?.approvals]);

  const selectedStepAuditLogs = useMemo(() => {
    return selectedStepId ? trace?.auditLogs.filter((item) => item.stepId === selectedStepId) || [] : [];
  }, [selectedStepId, trace?.auditLogs]);

  const waitingStepCount = useMemo(() => runSteps.filter((step) => step.status === 'waiting_approval').length, [runSteps]);
  const failedStepCount = useMemo(() => runSteps.filter((step) => step.status === 'failed').length, [runSteps]);
  const completedStepCount = useMemo(() => runSteps.filter((step) => step.status === 'completed').length, [runSteps]);

  const isLatestSelectedRun = Boolean(runSummary && latestRun && runSummary.id === latestRun.id);
  const canPause = isLatestSelectedRun && runSummary?.status === 'running' && Boolean(handlePauseRun);
  const canResume = isLatestSelectedRun && runSummary?.status === 'paused' && Boolean(handleResumeRun);
  const canCancel = Boolean(isLatestSelectedRun && runSummary && handleCancelRun && ['running', 'waiting_approval', 'paused'].includes(runSummary.status));

  const showIoSection = traceFilter === 'all' || traceFilter === 'io';
  const showToolsSection = traceFilter === 'all' || traceFilter === 'tools';
  const showApprovalsSection = traceFilter === 'all' || traceFilter === 'approvals';
  const showAuditsSection = traceFilter === 'all' || traceFilter === 'audits';
  const showSummarySection = traceFilter === 'all' || traceFilter === 'summary';

  const handleOpenRunDetail = (runId: string) => {
    setDetailRunId(runId);
    setIsDetailPage(true);
  };

  const handleBackToList = () => {
    if (scopedRunId && onClearScopedRun) {
      onClearScopedRun();
    }
    setIsDetailPage(false);
    setDetailRunId(null);
    setTrace(null);
    setResult(createEmptyAuditResult());
    setSelectedStepId(null);
  };

  const handleClearRunFilters = () => {
    setRunSearchText('');
    setRunStatusFilter('all');
    setRunPage(1);
  };

  const handleClearLogFilters = () => {
    setSearchText('');
    setStatusFilter('all');
    setToolFilter('all');
    setTagFilter('all');
    setPage(1);
  };

  if (!isDetailPage) {
    return (
      <div className="config-panel">
        <div className="config-header animate-stagger-1">
          <div>
            <h2 className="config-title">
              <div className="audit-viewer-icon-header">
                <IconShield size={24} />
              </div>
              {t('audit.executionCenterTitle')}
            </h2>
            <p className="config-subtitle">{t('audit.executionCenterSubtitle')}</p>
          </div>
          <button onClick={() => void fetchRuns()} className="btn btn-secondary audit-control-button" disabled={runsLoading}>
            <IconRefresh size={16} className={runsLoading ? 'spinning' : ''} />
            {t('audit.refreshLogs')}
          </button>
        </div>

        <div className="config-content audit-page-content animate-stagger-2">
          <div className="config-card audit-list-shell">
            <div className="audit-list-toolbar">
              <input
                className="form-control"
                value={runSearchText}
                onChange={(event) => {
                  setRunSearchText(event.target.value);
                  setRunPage(1);
                }}
                placeholder={t('audit.runSearchPlaceholder')}
              />
              <Select
                value={runStatusFilter}
                onChange={(value) => {
                  setRunStatusFilter(value as RunQueryStatus);
                  setRunPage(1);
                }}
                options={runStatusSelectOptions}
                className="select-fill"
              />
              <button className="btn btn-secondary audit-control-button" onClick={handleClearRunFilters}>
                {t('audit.clearFilters')}
              </button>
            </div>

            {scopedRunId && onClearScopedRun && (
              <div className="audit-list-meta">
                <button className="btn btn-secondary audit-control-button" onClick={onClearScopedRun}>
                  {t('audit.clearRunScope')}
                </button>
              </div>
            )}

            <div className="audit-list-body">
              {runsLoading ? (
                <div className="audit-viewer-loading">
                  <IconRefresh size={32} className="spinning audit-loading-spinner" />
                  <div>{t('common.loading')}</div>
                </div>
              ) : runResult.items.length === 0 ? (
                <div className="audit-viewer-empty audit-viewer-empty-state">
                  <div className="audit-viewer-empty-icon">
                    <IconShield size={56} />
                  </div>
                  <div className="audit-viewer-empty-text">{t('audit.runListEmpty')}</div>
                </div>
              ) : (
                <div className="audit-run-record-list">
                  {runResult.items.map((run) => (
                    <button
                      key={run.id}
                      type="button"
                      className="audit-run-record-card"
                      onClick={() => handleOpenRunDetail(run.id)}
                    >
                      <div className="audit-run-record-header">
                        <div className="audit-run-record-heading">
                          <div className="audit-run-record-title">{run.goal || run.userInput}</div>
                          <div className="audit-run-record-subtitle">{run.userInput}</div>
                        </div>
                        <div className="audit-run-record-badges">
                          {run.id === latestRun?.id && (
                            <span className="badge audit-log-badge is-success">{t('audit.currentRunBadge')}</span>
                          )}
                          <span className={`badge audit-log-badge is-${getStatusTone(run.status)}`}>
                            {getRunStatusLabel(run.status)}
                          </span>
                        </div>
                      </div>

                      <div className="audit-run-record-meta">
                        <span>{t('audit.runReference', { id: run.id })}</span>
                        <span>{t('audit.runStartedAt')} · {formatDateTime(run.startedAt || run.createdAt)}</span>
                        <span>{t('audit.runUpdatedAt')} · {formatDateTime(run.updatedAt)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="audit-pagination">
              <div className="audit-pagination-info">
                {t('audit.pageInfo', { page: runResult.page, totalPages: runResult.totalPages, total: runResult.total })}
              </div>
              <div className="audit-pagination-actions">
                <button
                  className="btn btn-secondary audit-control-button"
                  onClick={() => setRunPage((current) => Math.max(1, current - 1))}
                  disabled={runsLoading || runResult.page <= 1}
                >
                  {t('common.previous')}
                </button>
                <button
                  className="btn btn-secondary audit-control-button"
                  onClick={() => setRunPage((current) => Math.min(runResult.totalPages, current + 1))}
                  disabled={runsLoading || runResult.page >= runResult.totalPages}
                >
                  {t('common.next')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="config-panel">
      <div className="config-header animate-stagger-1">
        <div>
          <button type="button" className="btn btn-secondary audit-control-button audit-toolbar-back" onClick={handleBackToList}>
            <IconArrowLeft size={16} />
            {t('audit.backToRunList')}
          </button>
          <h2 className="config-title">
            <div className="audit-viewer-icon-header">
              <IconShield size={24} />
            </div>
            {t('audit.executionDetailTitle')}
          </h2>
          <p className="config-subtitle">{t('audit.executionDetailSubtitle')}</p>
        </div>
        <button
          onClick={() => {
            void fetchRuns();
            void fetchLogs();
            void fetchTrace(currentRunId);
          }}
          className="btn btn-secondary audit-control-button"
          disabled={loading || traceLoading}
        >
          <IconRefresh size={16} className={loading || traceLoading ? 'spinning' : ''} />
          {t('audit.refreshLogs')}
        </button>
      </div>

      <div className="config-content audit-page-content animate-stagger-2">
        {!runSummary ? (
          <div className="config-card audit-viewer-empty audit-viewer-empty-state">
            <div className="audit-viewer-empty-icon">
              <IconShield size={56} />
            </div>
            <div className="audit-viewer-empty-text">{t('audit.selectRunHint')}</div>
          </div>
        ) : (
          <div className="audit-detail-layout">
            <div className="config-card audit-detail-summary-card">
              <div className="audit-detail-summary-header">
                <div>
                  <div className="audit-log-section-title">{t('audit.runDetails')}</div>
                  <div className="audit-detail-summary-title">{runSummary.goal || runSummary.userInput}</div>
                  <div className="audit-log-reference">
                    <span>{t('audit.runReference', { id: runSummary.id })}</span>
                  </div>
                </div>
                <span className={`badge audit-log-badge is-${getStatusTone(runSummary.status)}`}>
                  {getRunStatusLabel(runSummary.status)}
                </span>
              </div>

              <div className="audit-detail-summary-grid">
                <div className="audit-detail-stat">
                  <div className="audit-summary-label">{t('audit.runStartedAt')}</div>
                  <div className="audit-detail-stat-value">{formatDateTime(runSummary.startedAt || runSummary.createdAt)}</div>
                </div>
                <div className="audit-detail-stat">
                  <div className="audit-summary-label">{t('audit.runCompletedAt')}</div>
                  <div className="audit-detail-stat-value">{formatDateTime(runSummary.completedAt)}</div>
                </div>
                <div className="audit-detail-stat">
                  <div className="audit-summary-label">{t('audit.runUpdatedAt')}</div>
                  <div className="audit-detail-stat-value">{formatDateTime(runSummary.updatedAt)}</div>
                </div>
                <div className="audit-detail-stat">
                  <div className="audit-summary-label">{t('chat.runTraceTotalSteps')}</div>
                  <div className="audit-detail-stat-value">{runSteps.length}</div>
                </div>
                <div className="audit-detail-stat">
                  <div className="audit-summary-label">{t('chat.runTraceCompletedSteps')}</div>
                  <div className="audit-detail-stat-value">{completedStepCount}</div>
                </div>
                <div className="audit-detail-stat">
                  <div className="audit-summary-label">{t('chat.runTraceFailedSteps')}</div>
                  <div className="audit-detail-stat-value">{failedStepCount}</div>
                </div>
                <div className="audit-detail-stat">
                  <div className="audit-summary-label">{t('chat.runStatus.waitingApproval')}</div>
                  <div className="audit-detail-stat-value">{waitingStepCount}</div>
                </div>
              </div>

              <div className="audit-detail-content-grid">
                <div className="audit-detail-block">
                  <div className="audit-log-section-title">{t('audit.runInput')}</div>
                  <pre className="audit-trace-pre">{stringifyContent(runSummary.userInput)}</pre>
                </div>
                <div className="audit-detail-block">
                  <div className="audit-log-section-title">{t('audit.runResponse')}</div>
                  <pre className="audit-trace-pre">{stringifyContent(runSummary.finalResponse)}</pre>
                </div>
                {runSummary.error && (
                  <div className="audit-detail-block">
                    <div className="audit-log-section-title">{t('audit.runFailure')}</div>
                    <pre className="audit-trace-pre">{runSummary.error}</pre>
                  </div>
                )}
              </div>

              {(canPause || canResume || canCancel) && (
                <div className="audit-detail-actions">
                  {canPause && (
                    <button className="btn btn-secondary audit-control-button" onClick={handlePauseRun}>
                      {t('chat.pauseRun')}
                    </button>
                  )}
                  {canResume && (
                    <button className="btn btn-primary audit-control-button" onClick={handleResumeRun}>
                      {t('chat.resumeRun')}
                    </button>
                  )}
                  {canCancel && (
                    <button className="btn btn-secondary audit-control-button" onClick={handleCancelRun}>
                      {t('chat.cancelRun')}
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="config-card audit-step-timeline-card">
              <div className="audit-detail-section-header">
                <div>
                  <div className="audit-log-section-title">{t('chat.runTraceTimeline')}</div>
                  <div className="audit-filter-summary">
                    {traceLoading
                      ? t('chat.runTraceLoading')
                      : trace
                        ? t('chat.runTraceSummary', {
                            steps: trace.aggregations.totalSteps,
                            toolCalls: trace.aggregations.toolCallCount,
                            auditLogs: trace.aggregations.auditLogCount
                          })
                        : t('chat.runTraceNoData')}
                  </div>
                </div>
                <div className="audit-filter-pill-row">
                  {traceFilterOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`audit-filter-pill ${traceFilter === option.value ? 'active' : ''}`}
                      onClick={() => setTraceFilter(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {traceLoading && runSteps.length === 0 ? (
                <div className="audit-run-empty">{t('chat.runTraceLoading')}</div>
              ) : runSteps.length === 0 ? (
                <div className="audit-run-empty">{t('chat.runTraceNoData')}</div>
              ) : (
                <>
                  <div className="audit-step-timeline">
                    {runSteps.map((step) => (
                      <button
                        key={step.id}
                        type="button"
                        className={`audit-step-item ${selectedStepId === step.id ? 'active' : ''}`}
                        onClick={() => setSelectedStepId(step.id)}
                      >
                        <div className="audit-step-item-main">
                          <div className="audit-step-item-label">
                            {t('chat.runTraceStepLabel', { step: step.stepIndex + 1 })}
                          </div>
                          <div className="audit-step-item-title">{step.title}</div>
                          <div className="audit-step-item-meta">
                            <span>{getStepTypeLabel(step.type)}</span>
                            <span>{formatDateTime(step.updatedAt)}</span>
                          </div>
                        </div>
                        <div className="audit-step-item-side">
                          <span className={`badge audit-log-badge is-${getStatusTone(step.status)}`}>
                            {getStepStatusLabel(step.status)}
                          </span>
                          {isLatestSelectedRun && handleRetryStep && step.status === 'failed' && (
                            <button
                              type="button"
                              className="audit-step-retry-link"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleRetryStep(step.id);
                              }}
                            >
                              {t('chat.retryStep')}
                            </button>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>

                  {selectedStep && (
                    <div className="audit-step-detail-shell">
                      <div className="audit-detail-section-header">
                        <div>
                          <div className="audit-log-section-title">{t('audit.focusedStep')}</div>
                          <div className="audit-detail-summary-title">
                            {t('chat.runTraceStepLabel', { step: selectedStep.stepIndex + 1 })} · {selectedStep.title}
                          </div>
                          <div className="audit-step-detail-meta-row">
                            <span className={`badge audit-log-badge is-${getStatusTone(selectedStep.status)}`}>
                              {getStepStatusLabel(selectedStep.status)}
                            </span>
                            <span className="audit-step-detail-chip">{getStepTypeLabel(selectedStep.type)}</span>
                            <span className="audit-step-detail-chip">
                              {t('chat.runTraceUpdatedAt', { time: formatDateTime(selectedStep.updatedAt) })}
                            </span>
                          </div>
                          <div className="audit-log-reference">
                            <span>{t('audit.stepReference', { id: selectedStep.id })}</span>
                          </div>
                        </div>
                        <div className="audit-pagination-actions">
                          <button
                            className="btn btn-secondary audit-control-button"
                            onClick={() => {
                              if (selectedStepIndex > 0) {
                                setSelectedStepId(runSteps[selectedStepIndex - 1].id);
                              }
                            }}
                            disabled={selectedStepIndex <= 0}
                          >
                            {t('chat.runTracePreviousStep')}
                          </button>
                          <button
                            className="btn btn-secondary audit-control-button"
                            onClick={() => {
                              if (selectedStepIndex >= 0 && selectedStepIndex < runSteps.length - 1) {
                                setSelectedStepId(runSteps[selectedStepIndex + 1].id);
                              }
                            }}
                            disabled={selectedStepIndex < 0 || selectedStepIndex >= runSteps.length - 1}
                          >
                            {t('chat.runTraceNextStep')}
                          </button>
                        </div>
                      </div>

                      {showIoSection && (
                        <div className="audit-detail-content-grid">
                          <div className="audit-detail-block">
                            <div className="audit-log-section-title">{t('chat.runTraceInput')}</div>
                            <pre className="audit-trace-pre">{stringifyContent(selectedStep.input)}</pre>
                          </div>
                          <div className="audit-detail-block">
                            <div className="audit-log-section-title">{t('chat.runTraceOutput')}</div>
                            <pre className="audit-trace-pre">{stringifyContent(selectedStep.output)}</pre>
                          </div>
                          <div className="audit-detail-block">
                            <div className="audit-log-section-title">{t('chat.runTraceMetadata')}</div>
                            <pre className="audit-trace-pre">{stringifyContent(selectedStep.metadata)}</pre>
                          </div>
                        </div>
                      )}

                      {showToolsSection && (
                        <div className="audit-related-card">
                          <div className="audit-log-section-title">
                            {t('chat.runTraceRelatedToolCalls')} · {t('chat.runTraceToolCount', { count: selectedStepToolCalls.length })}
                          </div>
                          <div className="audit-related-list">
                            {selectedStepToolCalls.length === 0 ? (
                              <div className="audit-related-empty">—</div>
                            ) : (
                              selectedStepToolCalls.map((item) => (
                                <div key={item.id} className="audit-related-item">
                                  <div className="audit-related-title">{item.toolName}</div>
                                  <pre className="audit-trace-pre">{stringifyContent(item.args)}</pre>
                                  <pre className="audit-trace-pre">{stringifyContent(item.result || item.error)}</pre>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      )}

                      {showApprovalsSection && (
                        <div className="audit-related-card">
                          <div className="audit-log-section-title">
                            {t('chat.runTraceRelatedApprovals')} · {t('chat.runTraceApprovalCount', { count: selectedStepApprovals.length })}
                          </div>
                          <div className="audit-related-list">
                            {selectedStepApprovals.length === 0 ? (
                              <div className="audit-related-empty">—</div>
                            ) : (
                              selectedStepApprovals.map((item) => (
                                <div key={item.id} className="audit-related-item">
                                  <div className="audit-related-title">{item.toolName}</div>
                                  <pre className="audit-trace-pre">{stringifyContent(item.args)}</pre>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      )}

                      {showAuditsSection && (
                        <div className="audit-related-card">
                          <div className="audit-log-section-title">
                            {t('chat.runTraceRelatedAuditLogs')} · {t('chat.runTraceAuditCount', { count: selectedStepAuditLogs.length })}
                          </div>
                          <div className="audit-related-list">
                            {selectedStepAuditLogs.length === 0 ? (
                              <div className="audit-related-empty">—</div>
                            ) : (
                              selectedStepAuditLogs.map((item) => (
                                <div key={item.id} className="audit-related-item">
                                  <div className="audit-related-title">{item.tool}</div>
                                  <pre className="audit-trace-pre">{stringifyContent(item.args)}</pre>
                                  {item.error && <pre className="audit-trace-pre">{item.error}</pre>}
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      )}

                      {showSummarySection && trace?.latestContextSummary && (
                        <div className="audit-related-card">
                          <div className="audit-log-section-title">{t('audit.latestContext')}</div>
                          <pre className="audit-trace-pre">{stringifyContent(trace.latestContextSummary)}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="config-card audit-log-detail-card">
              <div className="audit-detail-section-header">
                <div>
                  <div className="audit-log-section-title">{t('audit.auditLogsForRun')}</div>
                  <div className="audit-filter-summary">{t('audit.filteredCount', { shown: logs.length, total: result.total })}</div>
                </div>
                {loading && <IconRefresh size={16} className="spinning" />}
              </div>

              <div className="audit-list-toolbar audit-log-toolbar">
                <input
                  className="form-control"
                  value={searchText}
                  onChange={(event) => {
                    setSearchText(event.target.value);
                    setPage(1);
                  }}
                  placeholder={t('audit.searchPlaceholder')}
                />
                <Select
                  value={statusFilter}
                  onChange={(value) => {
                    setStatusFilter(value as 'all' | 'success' | 'error');
                    setPage(1);
                  }}
                  options={statusSelectOptions}
                  className="select-fill"
                />
                <Select
                  value={toolFilter}
                  onChange={(value) => {
                    setToolFilter(value);
                    setPage(1);
                  }}
                  options={toolSelectOptions}
                  className="select-fill"
                />
                <Select
                  value={tagFilter}
                  onChange={(value) => {
                    setTagFilter(value);
                    setPage(1);
                  }}
                  options={tagSelectOptions}
                  className="select-fill"
                />
                <button className="btn btn-secondary audit-control-button" onClick={handleClearLogFilters}>
                  {t('audit.clearFilters')}
                </button>
              </div>

              {logs.length === 0 ? (
                <div className="audit-viewer-empty audit-log-empty">
                  <div className="audit-viewer-empty-text">{loading ? t('common.loading') : t('audit.noFilteredLogs')}</div>
                </div>
              ) : (
                <div className="audit-log-list">
                  {logs.map((log: AuditLogEntry) => (
                    <div key={log.id} className={`config-card audit-log-card ${log.error ? 'is-error' : ''}`}>
                      <div className="audit-log-header">
                        <div className="audit-log-tool-info">
                          <div className={`audit-log-icon ${log.error ? 'is-error' : 'is-success'}`}>
                            <IconTool size={18} />
                          </div>
                          <div>
                            <div className="audit-log-tool-name">{log.tool}</div>
                            <div className="audit-log-timestamp">{new Date(log.timestamp).toLocaleString()}</div>
                            <div className="audit-log-reference">
                              {log.runId && <span>{t('audit.runReference', { id: log.runId })}</span>}
                              {log.stepId && (
                                <button
                                  type="button"
                                  className="audit-reference-button"
                                  onClick={() => {
                                    if (log.stepId) {
                                      setSelectedStepId(log.stepId);
                                    }
                                  }}
                                >
                                  {t('audit.stepReference', { id: log.stepId })}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                        <div>
                          {log.error ? (
                            <span className="badge audit-log-badge is-error">
                              <IconX size={14} className="audit-log-badge-icon" />
                              {t('common.error')}
                            </span>
                          ) : (
                            <span className="badge audit-log-badge is-success">
                              <IconCheck size={14} className="audit-log-badge-icon" />
                              {t('common.success')}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className={`audit-log-details ${log.error ? 'is-error' : 'is-success'}`}>
                        <div className="audit-log-section-title">{t('audit.arguments')}</div>
                        <div className="audit-log-args">
                          {typeof log.args === 'string' ? log.args : JSON.stringify(log.args, null, 2)}
                        </div>

                        {!!log.policyTags?.length && (
                          <div className="audit-log-tags-container">
                            <div className="audit-log-section-title">{t('audit.policyTags')}</div>
                            <div className="audit-log-tags">
                              {log.policyTags.map((tag) => (
                                <span key={`${log.id}-${tag}`} className="badge audit-log-tag">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {log.error && (
                          <div className="audit-log-error-container">
                            <div className="audit-log-error-title">{t('audit.errorDetails')}</div>
                            <div className="audit-log-error-text">{log.error}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="audit-pagination">
                <div className="audit-pagination-info">
                  {t('audit.pageInfo', { page: result.page, totalPages: result.totalPages, total: result.total })}
                </div>
                <div className="audit-pagination-actions">
                  <button
                    className="btn btn-secondary audit-control-button"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={loading || result.page <= 1}
                  >
                    {t('common.previous')}
                  </button>
                  <button
                    className="btn btn-secondary audit-control-button"
                    onClick={() => setPage((current) => Math.min(result.totalPages, current + 1))}
                    disabled={loading || result.page >= result.totalPages}
                  >
                    {t('common.next')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default AuditLogViewer;
