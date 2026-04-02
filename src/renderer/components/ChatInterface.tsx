import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ApprovalRecord, AuditLogEntry, Message, ModelConfig, RunContextSummary, RunStep, RunSummary, RunTrace, SystemStats, ToolCallRecord } from '../types';
import { IconUser, IconBot, IconTool, IconSend, IconTrash, IconCpu, IconChevronDown, IconCheck, IconRefresh, IconX } from './Icons';
import { useTranslation } from '../hooks/useTranslation';
import type { I18nContextValue } from './layout/I18nContext';
import { KAIRO_INVOKE } from '../../shared/ipc';
import { resolvePreferredTraceSelection, type TraceSelectionReason } from './chat_trace_utils';

interface ChatInterfaceProps {
  activeRunSteps: RunStep[];
  handleCancelRun: () => void;
  handlePauseRun: () => void;
  handleResumeRun: () => void;
  handleRetryStep: (stepId: string) => void;
  messages: Message[];
  input: string;
  setInput: (input: string | ((prev: string) => string)) => void;
  latestContextSummary: RunContextSummary | null;
  latestRun: RunSummary | null;
  loading: boolean;
  handleSend: () => void;
  handleClear: () => void;
  systemStats: SystemStats | null;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  models: ModelConfig[];
  activeModelId: string | null;
  activeAgentName: string;
  onModelChange: (modelId: string) => void;
}

type MessageGroup = {
  type: 'user' | 'final_answer' | 'process';
  messages: Message[];
};

interface ChatMessagesPanelProps {
  activeRunSteps: RunStep[];
  handleCancelRun: () => void;
  handlePauseRun: () => void;
  handleResumeRun: () => void;
  handleRetryStep: (stepId: string) => void;
  groupedMessages: MessageGroup[];
  latestContextSummary: RunContextSummary | null;
  latestRun: RunSummary | null;
  loading: boolean;
  markdownComponents: React.ComponentProps<typeof ReactMarkdown>['components'];
  messages: Message[];
  messagesEndRef: React.RefObject<HTMLDivElement>;
  runTrace: RunTrace | null;
  runTraceLoading: boolean;
  tracePage: number;
  traceSelectionReason: TraceSelectionReason | null;
  selectedTraceStepId: string | null;
  onSelectTraceStep: (stepId: string) => void;
  setTracePage: (page: number) => void;
  t: I18nContextValue['t'];
  toRenderableMarkdown: (content?: string) => string;
}

type TraceDetailFilter = 'all' | 'io' | 'tools' | 'approvals' | 'audits' | 'summary';

const MARKDOWN_REMARK_PLUGINS = [remarkGfm];

function renderSummaryBlock(title: string, content?: string) {
  if (!content?.trim()) {
    return null;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--muted-fg)' }}>{title}</div>
      <div style={{ color: 'var(--foreground)', fontSize: '0.85rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{content}</div>
    </div>
  );
}

function formatRunStatus(
  t: I18nContextValue['t'],
  status?: RunSummary['status'] | RunStep['status'] | 'success' | 'approved' | 'denied'
) {
  if (!status) {
    return '';
  }

  if (status === 'waiting_approval') {
    return t('chat.runStatus.waitingApproval');
  }
  if (status === 'completed') {
    return t('chat.runStatus.completed');
  }
  if (status === 'paused') {
    return t('chat.runStatus.paused');
  }
  if (status === 'cancelled') {
    return t('chat.runStatus.cancelled');
  }
  if (status === 'failed') {
    return t('chat.runStatus.failed');
  }
  if (status === 'running') {
    return t('chat.runStatus.running');
  }
  if (status === 'pending') {
    return t('chat.runStatus.pending');
  }
  if (status === 'success') {
    return t('chat.runStatus.success');
  }
  if (status === 'approved') {
    return t('chat.runStatus.approved');
  }
  if (status === 'denied') {
    return t('chat.runStatus.denied');
  }
  return status;
}

function shouldAllowStepRetry(status: RunStep['status']) {
  return status === 'failed' || status === 'cancelled';
}

function formatTraceTimestamp(timestamp?: number) {
  if (!timestamp) {
    return '—';
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(timestamp);
}

function formatStructuredValue(value: unknown) {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getTraceStatusAppearance(status?: RunStep['status']) {
  if (status === 'waiting_approval') {
    return {
      border: 'rgba(245, 158, 11, 0.4)',
      background: 'rgba(245, 158, 11, 0.08)',
      text: '#b45309'
    };
  }
  if (status === 'failed' || status === 'cancelled') {
    return {
      border: 'rgba(239, 68, 68, 0.35)',
      background: 'rgba(239, 68, 68, 0.08)',
      text: 'var(--danger)'
    };
  }
  if (status === 'running') {
    return {
      border: 'rgba(59, 130, 246, 0.35)',
      background: 'rgba(59, 130, 246, 0.08)',
      text: 'var(--primary)'
    };
  }
  if (status === 'pending') {
    return {
      border: 'rgba(148, 163, 184, 0.4)',
      background: 'rgba(148, 163, 184, 0.1)',
      text: 'var(--muted-fg)'
    };
  }
  return {
    border: 'rgba(34, 197, 94, 0.3)',
    background: 'rgba(34, 197, 94, 0.08)',
    text: '#15803d'
  };
}

function getTraceSelectionReasonLabel(t: I18nContextValue['t'], reason: TraceSelectionReason) {
  if (reason === 'waiting_approval') {
    return t('chat.runTraceFocusWaitingApproval');
  }
  if (reason === 'failed') {
    return t('chat.runTraceFocusFailed');
  }
  if (reason === 'running') {
    return t('chat.runTraceFocusRunning');
  }
  if (reason === 'pending') {
    return t('chat.runTraceFocusPending');
  }
  return t('chat.runTraceFocusLatest');
}

function getRelatedTraceRecordsByStep<T extends { stepId?: string }>(records: T[], stepId?: string | null) {
  if (!stepId) {
    return [];
  }
  return records.filter((record) => record.stepId === stepId);
}

const ChatMessagesPanel = React.memo(function ChatMessagesPanel({
  activeRunSteps,
  handleCancelRun,
  handlePauseRun,
  handleResumeRun,
  handleRetryStep,
  groupedMessages,
  latestContextSummary,
  latestRun,
  loading,
  markdownComponents,
  messages,
  messagesEndRef,
  runTrace,
  runTraceLoading,
  tracePage,
  traceSelectionReason,
  selectedTraceStepId,
  onSelectTraceStep,
  setTracePage,
  t,
  toRenderableMarkdown
}: ChatMessagesPanelProps) {
  const [traceDetailFilter, setTraceDetailFilter] = React.useState<TraceDetailFilter>('all');
  const selectedTraceStep = React.useMemo(
    () => runTrace?.steps.find((step) => step.id === selectedTraceStepId) || runTrace?.steps[0] || null,
    [runTrace, selectedTraceStepId]
  );
  const selectedTraceStepIndex = React.useMemo(
    () => runTrace?.steps.findIndex((step) => step.id === selectedTraceStep?.id) ?? -1,
    [runTrace, selectedTraceStep]
  );
  const selectedStepToolCalls = React.useMemo(
    () => getRelatedTraceRecordsByStep<ToolCallRecord>(runTrace?.toolCalls || [], selectedTraceStep?.id),
    [runTrace, selectedTraceStep]
  );
  const selectedStepApprovals = React.useMemo(
    () => getRelatedTraceRecordsByStep<ApprovalRecord>(runTrace?.approvals || [], selectedTraceStep?.id),
    [runTrace, selectedTraceStep]
  );
  const selectedStepAuditLogs = React.useMemo(
    () => getRelatedTraceRecordsByStep<AuditLogEntry>(runTrace?.auditLogs || [], selectedTraceStep?.id),
    [runTrace, selectedTraceStep]
  );
  const traceStepStats = React.useMemo(() => {
    const stats = new Map<string, { toolCalls: number; approvals: number; audits: number; auditErrors: number }>();
    const ensureStepStats = (stepId?: string) => {
      if (!stepId) {
        return null;
      }
      const existing = stats.get(stepId);
      if (existing) {
        return existing;
      }
      const next = { toolCalls: 0, approvals: 0, audits: 0, auditErrors: 0 };
      stats.set(stepId, next);
      return next;
    };

    runTrace?.steps.forEach((step) => {
      ensureStepStats(step.id);
    });
    runTrace?.toolCalls.forEach((record) => {
      const item = ensureStepStats(record.stepId);
      if (item) {
        item.toolCalls += 1;
      }
    });
    runTrace?.approvals.forEach((record) => {
      const item = ensureStepStats(record.stepId);
      if (item) {
        item.approvals += 1;
      }
    });
    runTrace?.auditLogs.forEach((record) => {
      const item = ensureStepStats(record.stepId);
      if (item) {
        item.audits += 1;
        if (record.error) {
          item.auditErrors += 1;
        }
      }
    });

    return stats;
  }, [runTrace]);
  const traceSummary = runTrace?.latestContextSummary || latestContextSummary;
  const canGoToPreviousTraceStep = selectedTraceStepIndex > 0;
  const canGoToNextTraceStep = selectedTraceStepIndex >= 0 && selectedTraceStepIndex < ((runTrace?.steps.length || 0) - 1);
  const selectedTraceStepStats = selectedTraceStep ? traceStepStats.get(selectedTraceStep.id) || {
    toolCalls: 0,
    approvals: 0,
    audits: 0,
    auditErrors: 0
  } : null;
  const selectedTraceStepIoCount = [
    selectedTraceStep?.input,
    selectedTraceStep?.output,
    selectedTraceStep?.metadata
  ].filter((value) => value !== undefined && value !== null && formatStructuredValue(value)).length;
  const showInputOutputDetails = traceDetailFilter === 'all' || traceDetailFilter === 'io';
  const showToolDetails = traceDetailFilter === 'all' || traceDetailFilter === 'tools';
  const showApprovalDetails = traceDetailFilter === 'all' || traceDetailFilter === 'approvals';
  const showAuditDetails = traceDetailFilter === 'all' || traceDetailFilter === 'audits';
  const showSummaryDetails = traceDetailFilter === 'all' || traceDetailFilter === 'summary';

  React.useEffect(() => {
    setTraceDetailFilter('all');
  }, [selectedTraceStep?.id]);

  return (
    <div className="messages-container">
      {latestRun && (
        <div
          style={{
            margin: '0 0 1rem 0',
            padding: '0.9rem 1rem',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--sidebar-bg)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--muted-fg)' }}>{t('chat.currentRun')}</div>
              <div style={{ fontWeight: 600, color: 'var(--foreground)' }}>{latestRun.goal || latestRun.userInput}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <div
                style={{
                  padding: '0.2rem 0.6rem',
                  borderRadius: '999px',
                  border: '1px solid var(--border)',
                  color: 'var(--foreground)',
                  fontSize: '0.8rem',
                  background: 'var(--background)'
                }}
              >
                {formatRunStatus(t, latestRun.status)}
              </div>
              {latestRun.status === 'running' && (
                <>
                  <button
                    type="button"
                    onClick={handlePauseRun}
                    style={{
                      border: '1px solid var(--border)',
                      background: 'var(--background)',
                      color: 'var(--foreground)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '0.35rem 0.6rem',
                      cursor: 'pointer',
                      fontSize: '0.8rem'
                    }}
                  >
                    {t('chat.pauseRun')}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelRun}
                    style={{
                      border: '1px solid var(--danger)',
                      background: 'var(--background)',
                      color: 'var(--danger)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '0.35rem 0.6rem',
                      cursor: 'pointer',
                      fontSize: '0.8rem'
                    }}
                  >
                    {t('chat.cancelRun')}
                  </button>
                </>
              )}
              {latestRun.status === 'paused' && (
                <>
                  <button
                    type="button"
                    onClick={handleResumeRun}
                    style={{
                      border: '1px solid var(--primary)',
                      background: 'var(--background)',
                      color: 'var(--foreground)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '0.35rem 0.6rem',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem'
                    }}
                  >
                    <IconRefresh size={12} />
                    {t('chat.resumeRun')}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelRun}
                    style={{
                      border: '1px solid var(--danger)',
                      background: 'var(--background)',
                      color: 'var(--danger)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '0.35rem 0.6rem',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem'
                    }}
                  >
                    <IconX size={12} />
                    {t('chat.cancelRun')}
                  </button>
                </>
              )}
            </div>
          </div>
          {activeRunSteps.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {activeRunSteps.map((step) => (
                <div
                  key={step.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: '1rem',
                    padding: '0.65rem 0.75rem',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--background)',
                    border: '1px solid var(--border)'
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 0 }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--muted-fg)' }}>
                      {t('chat.runTraceStepLabel', { step: step.stepIndex + 1 })} · {step.type}
                    </div>
                    <div style={{ color: 'var(--foreground)', fontSize: '0.9rem' }}>{step.title}</div>
                    {step.error && (
                      <div style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>{step.error}</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', whiteSpace: 'nowrap' }}>
                    <div style={{ color: 'var(--muted-fg)', fontSize: '0.8rem' }}>
                      {formatRunStatus(t, step.status)}
                    </div>
                    {shouldAllowStepRetry(step.status) && (
                      <button
                        type="button"
                        onClick={() => handleRetryStep(step.id)}
                        style={{
                          border: '1px solid var(--border)',
                          background: 'var(--background)',
                          color: 'var(--foreground)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '0.25rem 0.5rem',
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem'
                        }}
                      >
                        <IconRefresh size={12} />
                        {t('chat.retryStep')}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {latestContextSummary && (
            <details style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--muted-fg)', fontSize: '0.85rem' }}>
                {t('chat.contextSummaryMeta', {
                  kept: latestContextSummary.recentMessageCount,
                  omitted: latestContextSummary.omittedMessageCount
                })}
              </summary>
              <div style={{ display: 'grid', gap: '0.8rem', marginTop: '0.75rem' }}>
                {renderSummaryBlock(t('chat.currentTask'), latestContextSummary.activeTaskSummary)}
                {renderSummaryBlock(t('chat.compactedHistory'), latestContextSummary.compactedHistorySummary)}
                {renderSummaryBlock(t('chat.unresolvedApprovals'), latestContextSummary.unresolvedApprovals)}
                {renderSummaryBlock(t('chat.toolSummary'), latestContextSummary.selectedToolResults)}
                {renderSummaryBlock(t('chat.workspaceRetrieval'), latestContextSummary.workspaceRetrieval)}
                {renderSummaryBlock(t('chat.memoryDigest'), latestContextSummary.memoryDigest)}
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', color: 'var(--muted-fg)', fontSize: '0.8rem' }}>
                  <span>{t('chat.budgetLabel', { used: latestContextSummary.budget.totalChars, total: latestContextSummary.budget.maxContextChars })}</span>
                  <span>{t('chat.systemPromptLabel', { value: latestContextSummary.budget.systemPromptChars })}</span>
                  <span>{t('chat.supportSummaryLabel', { value: latestContextSummary.budget.supportChars })}</span>
                  <span>{t('chat.recentHistoryLabel', { value: latestContextSummary.budget.recentHistoryChars })}</span>
                </div>
              </div>
            </details>
          )}
          {!runTraceLoading && !runTrace && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem', color: 'var(--muted-fg)', fontSize: '0.85rem' }}>
              {t('chat.runTraceNoData')}
            </div>
          )}
          {(runTraceLoading || runTrace) && (
            <details style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }} open={Boolean(runTrace)}>
              <summary style={{ cursor: 'pointer', color: 'var(--muted-fg)', fontSize: '0.85rem' }}>
                {runTraceLoading
                  ? t('chat.runTraceLoading')
                  : t('chat.runTraceSummary', {
                    steps: runTrace?.aggregations.totalSteps || 0,
                    toolCalls: runTrace?.aggregations.toolCallCount || 0,
                    auditLogs: runTrace?.aggregations.auditLogCount || 0
                  })}
              </summary>
              {runTrace && (
                <div style={{ display: 'grid', gap: '0.85rem', marginTop: '0.85rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
                    <div style={{ padding: '0.65rem 0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--background)' }}>
                      <div style={{ color: 'var(--muted-fg)', fontSize: '0.75rem' }}>{t('chat.runTraceRunStatus')}</div>
                      <div style={{ color: 'var(--foreground)', fontWeight: 600 }}>{formatRunStatus(t, runTrace.run.status)}</div>
                    </div>
                    <div style={{ padding: '0.65rem 0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--background)' }}>
                      <div style={{ color: 'var(--muted-fg)', fontSize: '0.75rem' }}>{t('chat.runTraceStartTime')}</div>
                      <div style={{ color: 'var(--foreground)', fontWeight: 600 }}>{formatTraceTimestamp(runTrace.run.startedAt || runTrace.run.createdAt)}</div>
                    </div>
                    <div style={{ padding: '0.65rem 0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--background)' }}>
                      <div style={{ color: 'var(--muted-fg)', fontSize: '0.75rem' }}>{t('chat.runTraceCompletionTime')}</div>
                      <div style={{ color: 'var(--foreground)', fontWeight: 600 }}>{formatTraceTimestamp(runTrace.run.completedAt)}</div>
                    </div>
                    <div style={{ padding: '0.65rem 0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--background)' }}>
                      <div style={{ color: 'var(--muted-fg)', fontSize: '0.75rem' }}>{t('chat.runTraceApprovalToolCount')}</div>
                      <div style={{ color: 'var(--foreground)', fontWeight: 600 }}>
                        {runTrace.approvals.length} / {runTrace.toolCalls.length}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
                    <div style={{ padding: '0.65rem 0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--background)' }}>
                      <div style={{ color: 'var(--muted-fg)', fontSize: '0.75rem' }}>{t('chat.runTraceTotalSteps')}</div>
                      <div style={{ color: 'var(--foreground)', fontWeight: 600 }}>{runTrace.aggregations.totalSteps}</div>
                    </div>
                    <div style={{ padding: '0.65rem 0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--background)' }}>
                      <div style={{ color: 'var(--muted-fg)', fontSize: '0.75rem' }}>{t('chat.runTraceCompletedSteps')}</div>
                      <div style={{ color: 'var(--foreground)', fontWeight: 600 }}>{runTrace.aggregations.completedSteps}</div>
                    </div>
                    <div style={{ padding: '0.65rem 0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--background)' }}>
                      <div style={{ color: 'var(--muted-fg)', fontSize: '0.75rem' }}>{t('chat.runTraceFailedSteps')}</div>
                      <div style={{ color: 'var(--foreground)', fontWeight: 600 }}>{runTrace.aggregations.failedSteps}</div>
                    </div>
                    <div style={{ padding: '0.65rem 0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--background)' }}>
                      <div style={{ color: 'var(--muted-fg)', fontSize: '0.75rem' }}>{t('chat.runTraceAuditErrors')}</div>
                      <div style={{ color: 'var(--foreground)', fontWeight: 600 }}>{runTrace.aggregations.auditErrorCount}</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ color: 'var(--muted-fg)', fontSize: '0.8rem' }}>
                      {t('chat.runTracePageInfo', { page: tracePage, totalPages: runTrace.totalPages, total: runTrace.total })}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <button
                        type="button"
                        onClick={() => setTracePage(tracePage - 1)}
                        disabled={tracePage <= 1}
                        style={{
                          border: '1px solid var(--border)',
                          background: 'var(--background)',
                          color: 'var(--foreground)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '0.35rem 0.6rem',
                          cursor: tracePage <= 1 ? 'not-allowed' : 'pointer',
                          opacity: tracePage <= 1 ? 0.6 : 1,
                          fontSize: '0.8rem'
                        }}
                      >
                        {t('chat.runTracePreviousPage')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setTracePage(tracePage + 1)}
                        disabled={tracePage >= runTrace.totalPages}
                        style={{
                          border: '1px solid var(--border)',
                          background: 'var(--background)',
                          color: 'var(--foreground)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '0.35rem 0.6rem',
                          cursor: tracePage >= runTrace.totalPages ? 'not-allowed' : 'pointer',
                          opacity: tracePage >= runTrace.totalPages ? 0.6 : 1,
                          fontSize: '0.8rem'
                        }}
                      >
                        {t('chat.runTraceNextPage')}
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gap: '0.6rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ color: 'var(--foreground)', fontWeight: 600 }}>{t('chat.runTraceTimeline')}</div>
                      {traceSelectionReason && traceSelectionReason !== 'preserve' && selectedTraceStep && (
                        <div style={{ color: 'var(--muted-fg)', fontSize: '0.8rem' }}>
                          {t('chat.runTraceAutoFocus', { reason: getTraceSelectionReasonLabel(t, traceSelectionReason) })}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'grid', gap: '0.55rem' }}>
                      {runTrace.steps.map((step) => {
                        const isSelected = step.id === selectedTraceStep?.id;
                        const appearance = getTraceStatusAppearance(step.status);
                        const stats = traceStepStats.get(step.id) || {
                          toolCalls: 0,
                          approvals: 0,
                          audits: 0,
                          auditErrors: 0
                        };
                        return (
                          <button
                            key={step.id}
                            type="button"
                            onClick={() => onSelectTraceStep(step.id)}
                            style={{
                              border: `1px solid ${isSelected ? 'var(--primary)' : appearance.border}`,
                              background: isSelected ? 'rgba(59, 130, 246, 0.08)' : 'var(--background)',
                              color: 'var(--foreground)',
                              borderRadius: 'var(--radius-md)',
                              padding: '0.7rem 0.8rem',
                              textAlign: 'left',
                              cursor: 'pointer',
                              display: 'grid',
                              gap: '0.45rem',
                              boxShadow: isSelected ? '0 0 0 1px rgba(59, 130, 246, 0.08)' : 'none'
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                              <div style={{ display: 'grid', gap: '0.15rem' }}>
                                <div style={{ fontSize: '0.72rem', color: 'var(--muted-fg)' }}>
                                  {t('chat.runTraceStepLabel', { step: step.stepIndex + 1 })} · {step.type}
                                </div>
                                <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>{step.title}</div>
                              </div>
                              <div
                                style={{
                                  fontSize: '0.75rem',
                                  color: appearance.text,
                                  border: `1px solid ${appearance.border}`,
                                  background: appearance.background,
                                  borderRadius: '999px',
                                  padding: '0.15rem 0.45rem',
                                  alignSelf: 'flex-start'
                                }}
                              >
                                {formatRunStatus(t, step.status)}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', color: 'var(--muted-fg)', fontSize: '0.75rem' }}>
                              <span>{formatTraceTimestamp(step.updatedAt)}</span>
                              <span>{t('chat.runTraceToolCount', { count: stats.toolCalls })}</span>
                              <span>{t('chat.runTraceApprovalCount', { count: stats.approvals })}</span>
                              <span>{t('chat.runTraceAuditCount', { count: stats.audits })}</span>
                              {stats.auditErrors > 0 && <span style={{ color: 'var(--danger)' }}>{t('chat.runTraceAuditErrorCount', { count: stats.auditErrors })}</span>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {selectedTraceStep && (
                    <div style={{ display: 'grid', gap: '0.75rem' }}>
                      <div style={{ padding: '0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--background)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                          <div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--muted-fg)' }}>
                              {t('chat.runTraceStepLabel', { step: selectedTraceStep.stepIndex + 1 })} · {selectedTraceStep.type}
                            </div>
                            <div style={{ color: 'var(--foreground)', fontWeight: 700, marginTop: '0.2rem' }}>{selectedTraceStep.title}</div>
                          </div>
                          <div style={{ color: 'var(--muted-fg)', fontSize: '0.8rem' }}>
                            {formatRunStatus(t, selectedTraceStep.status)} · {formatTraceTimestamp(selectedTraceStep.updatedAt)}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => {
                              if (canGoToPreviousTraceStep && runTrace.steps[selectedTraceStepIndex - 1]) {
                                onSelectTraceStep(runTrace.steps[selectedTraceStepIndex - 1].id);
                              }
                            }}
                            disabled={!canGoToPreviousTraceStep}
                            style={{
                              border: '1px solid var(--border)',
                              background: 'var(--background)',
                              color: 'var(--foreground)',
                              borderRadius: 'var(--radius-sm)',
                              padding: '0.35rem 0.6rem',
                              cursor: canGoToPreviousTraceStep ? 'pointer' : 'not-allowed',
                              opacity: canGoToPreviousTraceStep ? 1 : 0.6,
                              fontSize: '0.8rem'
                            }}
                          >
                            {t('chat.runTracePreviousStep')}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (canGoToNextTraceStep && runTrace.steps[selectedTraceStepIndex + 1]) {
                                onSelectTraceStep(runTrace.steps[selectedTraceStepIndex + 1].id);
                              }
                            }}
                            disabled={!canGoToNextTraceStep}
                            style={{
                              border: '1px solid var(--border)',
                              background: 'var(--background)',
                              color: 'var(--foreground)',
                              borderRadius: 'var(--radius-sm)',
                              padding: '0.35rem 0.6rem',
                              cursor: canGoToNextTraceStep ? 'pointer' : 'not-allowed',
                              opacity: canGoToNextTraceStep ? 1 : 0.6,
                              fontSize: '0.8rem'
                            }}
                          >
                            {t('chat.runTraceNextStep')}
                          </button>
                        </div>
                        <div style={{ display: 'flex', gap: '0.45rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                          {[
                            { value: 'all' as TraceDetailFilter, label: t('chat.runTraceFilterAll'), count: selectedTraceStepIoCount + selectedStepToolCalls.length + selectedStepApprovals.length + selectedStepAuditLogs.length + (traceSummary ? 1 : 0) },
                            { value: 'io' as TraceDetailFilter, label: t('chat.runTraceFilterIo'), count: selectedTraceStepIoCount },
                            { value: 'tools' as TraceDetailFilter, label: t('chat.runTraceFilterTools'), count: selectedStepToolCalls.length },
                            { value: 'approvals' as TraceDetailFilter, label: t('chat.runTraceFilterApprovals'), count: selectedStepApprovals.length },
                            { value: 'audits' as TraceDetailFilter, label: t('chat.runTraceFilterAudits'), count: selectedStepAuditLogs.length },
                            { value: 'summary' as TraceDetailFilter, label: t('chat.runTraceFilterSummary'), count: traceSummary ? 1 : 0 }
                          ].map((filterItem) => {
                            const isActive = traceDetailFilter === filterItem.value;
                            const isDisabled = filterItem.value !== 'all' && filterItem.count === 0;
                            return (
                              <button
                                key={filterItem.value}
                                type="button"
                                disabled={isDisabled}
                                onClick={() => setTraceDetailFilter(filterItem.value)}
                                style={{
                                  border: `1px solid ${isActive ? 'var(--primary)' : 'var(--border)'}`,
                                  background: isActive ? 'rgba(59, 130, 246, 0.08)' : 'var(--background)',
                                  color: isDisabled ? 'var(--muted-fg)' : 'var(--foreground)',
                                  borderRadius: '999px',
                                  padding: '0.28rem 0.55rem',
                                  cursor: isDisabled ? 'not-allowed' : 'pointer',
                                  opacity: isDisabled ? 0.6 : 1,
                                  fontSize: '0.78rem'
                                }}
                              >
                                {filterItem.label} · {filterItem.count}
                              </button>
                            );
                          })}
                        </div>
                        {selectedTraceStepStats && (
                          <div style={{ display: 'flex', gap: '0.45rem', marginTop: '0.1rem', flexWrap: 'wrap', color: 'var(--muted-fg)', fontSize: '0.78rem' }}>
                            <span>{t('chat.runTraceToolCount', { count: selectedTraceStepStats.toolCalls })}</span>
                            <span>{t('chat.runTraceApprovalCount', { count: selectedTraceStepStats.approvals })}</span>
                            <span>{t('chat.runTraceAuditCount', { count: selectedTraceStepStats.audits })}</span>
                            {selectedTraceStepStats.auditErrors > 0 && <span style={{ color: 'var(--danger)' }}>{t('chat.runTraceAuditErrorCount', { count: selectedTraceStepStats.auditErrors })}</span>}
                          </div>
                        )}
                        {selectedTraceStep.error && (
                          <div style={{ marginTop: '0.65rem', color: 'var(--danger)', fontSize: '0.85rem' }}>{selectedTraceStep.error}</div>
                        )}
                      </div>

                      {showInputOutputDetails && [
                        { title: t('chat.runTraceInput'), content: formatStructuredValue(selectedTraceStep.input) },
                        { title: t('chat.runTraceOutput'), content: formatStructuredValue(selectedTraceStep.output) },
                        { title: t('chat.runTraceMetadata'), content: formatStructuredValue(selectedTraceStep.metadata) }
                      ].filter((item) => item.content).map((item) => (
                        <div key={item.title} style={{ padding: '0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--background)' }}>
                          <div style={{ color: 'var(--muted-fg)', fontSize: '0.75rem', marginBottom: '0.45rem' }}>{item.title}</div>
                          <pre className="message-pre" style={{ margin: 0 }}>{item.content}</pre>
                        </div>
                      ))}

                      {showToolDetails && selectedStepToolCalls.length > 0 && (
                        <div style={{ padding: '0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--background)', display: 'grid', gap: '0.65rem' }}>
                          <div style={{ color: 'var(--muted-fg)', fontSize: '0.75rem' }}>{t('chat.runTraceRelatedToolCalls')}</div>
                          {selectedStepToolCalls.map((record) => (
                            <div key={record.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.65rem' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                                <div style={{ color: 'var(--foreground)', fontWeight: 600 }}>{record.toolName}</div>
                                <div style={{ color: 'var(--muted-fg)', fontSize: '0.8rem' }}>{formatRunStatus(t, record.status)}</div>
                              </div>
                              {formatStructuredValue(record.args) && <pre className="message-pre" style={{ marginTop: '0.5rem' }}>{formatStructuredValue(record.args)}</pre>}
                              {formatStructuredValue(record.result) && <pre className="message-pre" style={{ marginTop: '0.5rem' }}>{formatStructuredValue(record.result)}</pre>}
                              {record.error && <div style={{ marginTop: '0.5rem', color: 'var(--danger)', fontSize: '0.85rem' }}>{record.error}</div>}
                            </div>
                          ))}
                        </div>
                      )}

                      {showApprovalDetails && selectedStepApprovals.length > 0 && (
                        <div style={{ padding: '0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--background)', display: 'grid', gap: '0.65rem' }}>
                          <div style={{ color: 'var(--muted-fg)', fontSize: '0.75rem' }}>{t('chat.runTraceRelatedApprovals')}</div>
                          {selectedStepApprovals.map((record) => (
                            <div key={record.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.65rem' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                                <div style={{ color: 'var(--foreground)', fontWeight: 600 }}>{record.toolName}</div>
                                <div style={{ color: 'var(--muted-fg)', fontSize: '0.8rem' }}>{formatRunStatus(t, record.status)}</div>
                              </div>
                              <pre className="message-pre" style={{ marginTop: '0.5rem' }}>{formatStructuredValue(record.args)}</pre>
                            </div>
                          ))}
                        </div>
                      )}

                      {showAuditDetails && selectedStepAuditLogs.length > 0 && (
                        <div style={{ padding: '0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--background)', display: 'grid', gap: '0.65rem' }}>
                          <div style={{ color: 'var(--muted-fg)', fontSize: '0.75rem' }}>{t('chat.runTraceRelatedAuditLogs')}</div>
                          {selectedStepAuditLogs.map((record) => (
                            <div key={record.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.65rem' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                                <div style={{ color: 'var(--foreground)', fontWeight: 600 }}>{record.tool}</div>
                                <div style={{ color: 'var(--muted-fg)', fontSize: '0.8rem' }}>
                                  {record.error ? t('audit.statusError') : t('audit.statusSuccess')} · {formatTraceTimestamp(record.timestamp)}
                                </div>
                              </div>
                              {formatStructuredValue(record.args) && <pre className="message-pre" style={{ marginTop: '0.5rem' }}>{formatStructuredValue(record.args)}</pre>}
                              {formatStructuredValue(record.result) && <pre className="message-pre" style={{ marginTop: '0.5rem' }}>{formatStructuredValue(record.result)}</pre>}
                              {record.error && <div style={{ marginTop: '0.5rem', color: 'var(--danger)', fontSize: '0.85rem' }}>{record.error}</div>}
                            </div>
                          ))}
                        </div>
                      )}

                      {showSummaryDetails && traceSummary && (
                        <details style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
                          <summary style={{ cursor: 'pointer', color: 'var(--muted-fg)', fontSize: '0.85rem' }}>
                            {t('chat.runTraceContextSummary')}
                          </summary>
                          <div style={{ display: 'grid', gap: '0.8rem', marginTop: '0.75rem' }}>
                            {renderSummaryBlock(t('chat.currentTask'), traceSummary.activeTaskSummary)}
                            {renderSummaryBlock(t('chat.compactedHistory'), traceSummary.compactedHistorySummary)}
                            {renderSummaryBlock(t('chat.unresolvedApprovals'), traceSummary.unresolvedApprovals)}
                            {renderSummaryBlock(t('chat.toolSummary'), traceSummary.selectedToolResults)}
                            {renderSummaryBlock(t('chat.workspaceRetrieval'), traceSummary.workspaceRetrieval)}
                            {renderSummaryBlock(t('chat.memoryDigest'), traceSummary.memoryDigest)}
                          </div>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              )}
            </details>
          )}
        </div>
      )}
      {messages.length === 0 && (
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center', 
          height: '100%', 
          color: 'var(--muted-fg)',
          paddingBottom: '20%'
        }}>
          <h2 style={{ color: 'var(--foreground)', marginBottom: '0.5rem' }}>{t('chat.welcome')}</h2>
          <p>{t('chat.welcomeDesc')}</p>
        </div>
      )}
      
      {groupedMessages.map((group, groupIdx) => {
        if (group.type === 'process') {
          const isLatestLoading = loading && groupIdx === groupedMessages.length - 1;
          return (
            <div key={`group-wrapper-${groupIdx}`} className="message system" style={{ margin: '0.5rem auto' }}>
              <div className="avatar" style={{ backgroundColor: 'transparent', color: 'var(--muted-fg)' }}>
                <IconCpu size={18} />
              </div>
              <div className="message-content" style={{ width: '100%', padding: 0 }}>
                <details 
                  key={`group-${groupIdx}`} 
                  open={isLatestLoading}
                  className="message-process-group" 
                  style={{ background: 'var(--sidebar-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', padding: '0.5rem' }}
                >
                  <summary className="process-summary" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--muted-fg)', fontSize: '0.85rem', userSelect: 'none', padding: '0.25rem' }}>
                    {isLatestLoading ? t('chat.working') : t('chat.viewProcess', { count: group.messages.length })}
                  </summary>
                  <div className="process-content" style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {group.messages.map((msg, i) => (
                      <div key={i} className={`message ${msg.role} process-item`} style={{ padding: '0.5rem', margin: 0, fontSize: '0.9em', background: 'var(--background)', border: '1px solid var(--border)', maxWidth: '100%' }}>
                        <div className="avatar" style={{ width: '24px', height: '24px', padding: '4px' }}>
                          {msg.role === 'tool' ? <IconTool size={14} /> : <IconBot size={14} />}
                        </div>
                        <div className="message-content" style={{ padding: '0.25rem 0.5rem' }}>
                          {msg.role === 'tool' ? (
                            <div className="markdown-body">
                              <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} components={markdownComponents}>
                                {toRenderableMarkdown(msg.content)}
                              </ReactMarkdown>
                              {msg.details && (
                                <details className="message-details">
                                  <summary className="message-summary">{t('chat.details')}</summary>
                                  <pre className="message-pre">{JSON.stringify(msg.details, null, 2)}</pre>
                                </details>
                              )}
                            </div>
                          ) : (
                            <div className="markdown-body">
                              <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} components={markdownComponents}>
                                {toRenderableMarkdown(msg.content)}
                              </ReactMarkdown>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            </div>
          );
        }

        return group.messages.map((msg, i) => (
          <div key={`msg-${groupIdx}-${i}`} className={`message ${msg.role}`}>
            <div className="avatar">
              {msg.role === 'user' ? <IconUser size={18} /> : (msg.role === 'tool' ? <IconTool size={18} /> : <IconBot size={18} />)}
            </div>
            <div className="message-content">
              {msg.role === 'user' || msg.role === 'tool' ? (
                <div style={{ whiteSpace: 'pre-wrap' }}>
                  {msg.content}
                  {msg.details && (
                    <details className="message-details">
                      <summary className="message-summary">{t('chat.details')}</summary>
                      <pre className="message-pre">{JSON.stringify(msg.details, null, 2)}</pre>
                    </details>
                  )}
                </div>
              ) : (
                <div className="markdown-body">
                  <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} components={markdownComponents}>
                    {toRenderableMarkdown(msg.content)}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        ));
      })}
      <div ref={messagesEndRef} />
    </div>
  );
});

export function ChatInterface({ 
  activeRunSteps,
  handleCancelRun,
  handlePauseRun,
  handleResumeRun,
  handleRetryStep,
  messages, 
  input, 
  setInput, 
  latestContextSummary,
  latestRun,
  loading, 
  handleSend, 
  handleClear, 
  systemStats,
  messagesEndRef,
  models,
  activeModelId,
  activeAgentName,
  onModelChange
}: ChatInterfaceProps) {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const dragCounter = React.useRef(0);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [activeModelIndex, setActiveModelIndex] = useState(-1);
  const [modelDropdownPlacement, setModelDropdownPlacement] = useState<'top' | 'bottom'>('top');
  const [runTrace, setRunTrace] = useState<RunTrace | null>(null);
  const [runTraceLoading, setRunTraceLoading] = useState(false);
  const [tracePage, setTracePage] = useState(1);
  const [traceSelectionReason, setTraceSelectionReason] = useState<TraceSelectionReason | null>(null);
  const [selectedTraceStepId, setSelectedTraceStepId] = useState<string | null>(null);
  const modelDropdownRef = React.useRef<HTMLDivElement>(null);
  const modelTriggerRef = React.useRef<HTMLButtonElement>(null);
  const modelGroups = React.useMemo(() => models.map(model => {
    const options = model.availableModels && model.availableModels.length > 0
      ? model.availableModels
      : [{ id: model.model, name: model.model }];
    return {
      providerId: model.id,
      providerName: model.name,
      models: options
    };
  }), [models]);
  const activeProviderId = activeModelId?.split('/')[0] || '';
  const activeModelName = activeModelId?.split('/')[1] || '';
  const activeProvider = React.useMemo(
    () => modelGroups.find(group => group.providerId === activeProviderId),
    [activeProviderId, modelGroups]
  );
  const activeModelDisplay = React.useMemo(
    () => activeProvider
      ? `${activeProvider.providerName} (${activeModelName})`
      : (activeModelId || t('chat.selectModel')),
    [activeModelId, activeModelName, activeProvider, t]
  );
  const flatModelOptions = React.useMemo(
    () => modelGroups.flatMap(group =>
      group.models.map(model => ({
        value: `${group.providerId}/${model.id}`,
        modelId: model.id
      }))
    ),
    [modelGroups]
  );
  const modelIndexMap = React.useMemo(
    () => new Map(flatModelOptions.map((item, index) => [item.value, index])),
    [flatModelOptions]
  );

  useEffect(() => {
    if (!isModelDropdownOpen) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isModelDropdownOpen]);

  useEffect(() => {
    setTracePage(1);
  }, [latestRun?.id]);

  useEffect(() => {
    if (!latestRun?.id) {
      setRunTrace(null);
      setRunTraceLoading(false);
      setTracePage(1);
      setTraceSelectionReason(null);
      setSelectedTraceStepId(null);
      return;
    }

    let disposed = false;
    setRunTraceLoading(true);
    window.kairo.invoke(KAIRO_INVOKE.chatGetRunTrace, {
      runId: latestRun.id,
      page: tracePage,
      pageSize: 8,
      includeToolCalls: true,
      includeApprovalRecords: true,
      includeAuditLogs: true,
      includeContextSummary: true
    })
      .then((trace) => {
        if (disposed) {
          return;
        }
        setRunTrace(trace);
        setTracePage(trace?.page || 1);
        setSelectedTraceStepId((currentSelectedStepId) => {
          if (!trace?.steps.length) {
            setTraceSelectionReason(null);
            return null;
          }
          const selection = resolvePreferredTraceSelection(trace.steps, currentSelectedStepId);
          setTraceSelectionReason(selection.reason === 'preserve' ? null : selection.reason);
          return selection.stepId;
        });
      })
      .catch(() => {
        if (disposed) {
          return;
        }
        setRunTrace(null);
        setTraceSelectionReason(null);
        setSelectedTraceStepId(null);
      })
      .finally(() => {
        if (!disposed) {
          setRunTraceLoading(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, [activeRunSteps.length, latestRun?.id, latestRun?.updatedAt, tracePage]);

  const handleSelectTraceStep = React.useCallback((stepId: string) => {
    setTraceSelectionReason(null);
    setSelectedTraceStepId(stepId);
  }, []);

  useEffect(() => {
    if (!isModelDropdownOpen) {
      return;
    }
    const updatePlacement = () => {
      const trigger = modelTriggerRef.current;
      if (!trigger) {
        return;
      }
      const rect = trigger.getBoundingClientRect();
      const spaceAbove = rect.top;
      const spaceBelow = window.innerHeight - rect.bottom;
      const requiredSpace = 320;
      if (spaceBelow >= requiredSpace || spaceBelow > spaceAbove) {
        setModelDropdownPlacement('bottom');
        return;
      }
      setModelDropdownPlacement('top');
    };
    updatePlacement();
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    return () => {
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
    };
  }, [isModelDropdownOpen]);

  useEffect(() => {
    if (!isModelDropdownOpen) {
      setActiveModelIndex(-1);
      return;
    }
    const selectedIndex = activeModelId ? flatModelOptions.findIndex(item => item.value === activeModelId) : -1;
    setActiveModelIndex(selectedIndex >= 0 ? selectedIndex : (flatModelOptions.length > 0 ? 0 : -1));
  }, [activeModelId, flatModelOptions, isModelDropdownOpen]);

  const isImageResource = React.useCallback((value: string) => {
    const normalized = value.trim().split('?')[0].split('#')[0];
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(normalized);
  }, []);

  const toRenderableUri = React.useCallback((rawUri: string) => {
    const uri = rawUri.trim();
    if (uri.startsWith('kairopilot://')) {
      const localPath = uri.slice('kairopilot://'.length);
      if (!localPath) {
        return uri;
      }
      const normalizedPath = localPath.startsWith('/') ? localPath : `/${localPath}`;
      return `file://${encodeURI(normalizedPath)}`;
    }
    if (uri.startsWith('/')) {
      return `file://${encodeURI(uri)}`;
    }
    return uri;
  }, []);

  const toRenderableMarkdown = React.useCallback((content?: string) => {
    const text = content || '';
    const lines = text.split('\n');
    return lines
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.includes('![')) {
          return line;
        }
        if (
          (trimmed.startsWith('kairopilot://') || trimmed.startsWith('file://') || trimmed.startsWith('/')) &&
          isImageResource(trimmed)
        ) {
          return `![image](${trimmed})`;
        }
        return line;
      })
      .join('\n');
  }, [isImageResource]);

  const markdownComponents = React.useMemo(() => {
    return {
      img: ({ src, alt }: { src?: string; alt?: string }) => {
        if (!src) {
          return null;
        }
        const imageSrc = toRenderableUri(src);
        return (
          <button
            type="button"
            className="chat-image-trigger"
            onClick={() => {
              setPreviewImageSrc(imageSrc);
              setPreviewZoom(1);
            }}
            title={t('chat.openImagePreview')}
          >
            <img src={imageSrc} alt={alt || 'image'} className="chat-message-image" loading="lazy" />
          </button>
        );
      },
      a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
        if (!href) {
          return <>{children}</>;
        }
        const linkHref = href.startsWith('kairopilot://') ? toRenderableUri(href) : href;
        return (
          <a href={linkHref} target="_blank" rel="noreferrer">
            {children}
          </a>
        );
      }
    };
  }, [t, toRenderableUri]);

  const adjustPreviewZoom = React.useCallback((delta: number) => {
    setPreviewZoom((prev) => {
      const next = prev + delta;
      return Math.min(4, Math.max(0.25, Number(next.toFixed(2))));
    });
  }, []);

  const closePreview = React.useCallback(() => {
    setPreviewImageSrc(null);
    setPreviewZoom(1);
  }, []);

  const resetPreviewZoom = React.useCallback(() => {
    setPreviewZoom(1);
  }, []);

  const handlePreviewWheel = React.useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      adjustPreviewZoom(0.1);
      return;
    }
    adjustPreviewZoom(-0.1);
  }, [adjustPreviewZoom]);

  // Group messages to hide intermediate process steps
  const groupedMessages = React.useMemo(() => {
    const groups: MessageGroup[] = [];
    let currentProcess: Message[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      
      if (msg.role === 'user') {
        if (currentProcess.length > 0) {
          groups.push({ type: 'process', messages: currentProcess });
          currentProcess = [];
        }
        groups.push({ type: 'user', messages: [msg] });
      } else {
        // It's an assistant, tool, or thinking message.
        // Check if it's the final assistant message in this turn.
        let isFinalInTurn = false;
        if (msg.role === 'assistant') {
          let hasMoreAfter = false;
          for (let j = i + 1; j < messages.length; j++) {
            if (messages[j].role === 'user') {
              break;
            }
            if (messages[j].role === 'assistant' || messages[j].role === 'tool' || messages[j].role === 'thinking') {
              hasMoreAfter = true;
              break;
            }
          }
          if (!hasMoreAfter) {
            isFinalInTurn = true;
          }
        }

        if (isFinalInTurn) {
          if (currentProcess.length > 0) {
            groups.push({ type: 'process', messages: currentProcess });
            currentProcess = [];
          }
          groups.push({ type: 'final_answer', messages: [msg] });
        } else {
          currentProcess.push(msg);
        }
      }
    }

    if (currentProcess.length > 0) {
      groups.push({ type: 'process', messages: currentProcess });
    }

    return groups;
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, messagesEndRef]);

  useEffect(() => {
    if (!previewImageSrc) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePreview();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [closePreview, previewImageSrc]);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (dragCounter.current === 1) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  };
  
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const addedText = files.map(f => {
        const path = (f as File & { path?: string }).path;
        if (!path) return '';
        if (f.type.startsWith('image/')) {
          return `![${f.name}](kairopilot://${path})`;
        } else {
          return `Context file: ${path}`;
        }
      }).filter(Boolean).join('\n');
      
      if (addedText) {
        setInput(prev => prev ? `${prev}\n${addedText}` : addedText);
      }
    }
  };

  return (
    <div 
      className="chat-interface"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="drag-overlay">
          {t('chat.dropFiles')}
        </div>
      )}

      <div className="chat-header">
        <div className="header-title">
          {`${t('chat.currentAgentLabel')}${activeAgentName}${loading ? ` · ${t('chat.thinking')}` : ''}`}
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {systemStats && (
            <div className="system-stats">
              CPU: {systemStats.cpuUsage}% | MEM: {systemStats.memoryUsage}%
            </div>
          )}
          <button onClick={handleClear} className="icon-btn" title={t('common.delete')}>
            <IconTrash size={18} />
          </button>
        </div>
      </div>

      <ChatMessagesPanel
        activeRunSteps={activeRunSteps}
        handleCancelRun={handleCancelRun}
        handlePauseRun={handlePauseRun}
        handleResumeRun={handleResumeRun}
        handleRetryStep={handleRetryStep}
        groupedMessages={groupedMessages}
        latestContextSummary={latestContextSummary}
        latestRun={latestRun}
        loading={loading}
        markdownComponents={markdownComponents}
        messages={messages}
        messagesEndRef={messagesEndRef}
        runTrace={runTrace}
        runTraceLoading={runTraceLoading}
        tracePage={tracePage}
        traceSelectionReason={traceSelectionReason}
        selectedTraceStepId={selectedTraceStepId}
        onSelectTraceStep={handleSelectTraceStep}
        setTracePage={setTracePage}
        t={t}
        toRenderableMarkdown={toRenderableMarkdown}
      />

      <div className="input-container">
        <div className="input-box">
          <textarea
            className="input-textarea"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={t('chat.placeholder')}
            disabled={loading}
            rows={1}
            style={{ height: 'auto', minHeight: '24px' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
            }}
          />
          <div className="input-actions">
            <div className="input-tools" style={{ display: 'flex', alignItems: 'center' }}>
              <div ref={modelDropdownRef} style={{ position: 'relative' }}>
                <button
                  ref={modelTriggerRef}
                  type="button"
                  disabled={loading}
                  onClick={() => setIsModelDropdownOpen(prev => !prev)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      if (!isModelDropdownOpen) {
                        setIsModelDropdownOpen(true);
                        return;
                      }
                      if (flatModelOptions.length > 0) {
                        setActiveModelIndex(prev => (prev + 1 + flatModelOptions.length) % flatModelOptions.length);
                      }
                      return;
                    }
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      if (!isModelDropdownOpen) {
                        setIsModelDropdownOpen(true);
                        return;
                      }
                      if (flatModelOptions.length > 0) {
                        setActiveModelIndex(prev => (prev - 1 + flatModelOptions.length) % flatModelOptions.length);
                      }
                      return;
                    }
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (!isModelDropdownOpen) {
                        setIsModelDropdownOpen(true);
                        return;
                      }
                      if (activeModelIndex >= 0 && flatModelOptions[activeModelIndex]) {
                        onModelChange(flatModelOptions[activeModelIndex].value);
                        setIsModelDropdownOpen(false);
                      }
                      return;
                    }
                    if (e.key === 'Escape' && isModelDropdownOpen) {
                      e.preventDefault();
                      setIsModelDropdownOpen(false);
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'var(--input-bg)',
                    border: isModelDropdownOpen ? '1px solid var(--primary)' : '1px solid var(--input-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '4px 10px',
                    fontSize: '0.8rem',
                    color: 'var(--foreground)',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    minHeight: '28px',
                    maxWidth: '320px',
                    boxShadow: isModelDropdownOpen ? '0 0 0 2px var(--ring)' : 'none'
                  }}
                >
                  <IconCpu size={14} style={{ color: 'var(--muted-fg)' }} />
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {activeModelDisplay}
                  </span>
                  <IconChevronDown size={14} style={{ color: 'var(--muted-fg)' }} />
                </button>
                {isModelDropdownOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      ...(modelDropdownPlacement === 'top'
                        ? { bottom: '100%', marginBottom: '8px' }
                        : { top: '100%', marginTop: '8px' }),
                      width: '320px',
                      maxHeight: '300px',
                      overflowY: 'auto',
                      background: 'var(--background)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)',
                      boxShadow: 'var(--shadow-lg)',
                      zIndex: 60,
                      padding: '6px'
                    }}
                  >
                    {modelGroups.map(group => (
                      <div key={group.providerId} style={{ marginBottom: '6px' }}>
                        <div
                          style={{
                            padding: '6px 8px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            color: 'var(--muted-fg)'
                          }}
                        >
                          {group.providerName}
                        </div>
                        {group.models.map(model => {
                          const value = `${group.providerId}/${model.id}`;
                          const selected = value === activeModelId;
                          const itemIndex = modelIndexMap.get(value) ?? -1;
                          const highlighted = itemIndex === activeModelIndex;
                          return (
                            <div
                              key={value}
                              onMouseEnter={() => setActiveModelIndex(itemIndex)}
                              onClick={() => {
                                onModelChange(value);
                                setIsModelDropdownOpen(false);
                              }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '8px',
                                borderRadius: 'var(--radius-sm)',
                                cursor: 'pointer',
                                background: selected || highlighted ? 'var(--sidebar-accent)' : 'transparent'
                              }}
                            >
                              <div style={{ width: '16px', display: 'flex', justifyContent: 'center' }}>
                                {selected && <IconCheck size={14} style={{ color: 'var(--primary)' }} />}
                              </div>
                              <span style={{ fontSize: '0.85rem' }}>{model.id}</span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <button 
              className="send-btn" 
              onClick={handleSend} 
              disabled={loading || !input.trim()}
              title={t('chat.send')}
            >
              <IconSend size={16} />
            </button>
          </div>
        </div>
      </div>

      {previewImageSrc && (
        <div className="image-preview-overlay" onClick={closePreview}>
          <div className="image-preview-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="image-preview-toolbar">
              <button
                type="button"
                className="image-preview-btn"
                onClick={() => adjustPreviewZoom(-0.1)}
                title={t('chat.imagePreviewZoomOut')}
              >
                −
              </button>
              <button
                type="button"
                className="image-preview-btn"
                onClick={() => adjustPreviewZoom(0.1)}
                title={t('chat.imagePreviewZoomIn')}
              >
                +
              </button>
              <button
                type="button"
                className="image-preview-btn"
                onClick={resetPreviewZoom}
                title={t('chat.imagePreviewReset')}
              >
                100%
              </button>
              <span className="image-preview-zoom-text">{Math.round(previewZoom * 100)}%</span>
              <button
                type="button"
                className="image-preview-btn image-preview-close"
                onClick={closePreview}
                title={t('chat.imagePreviewClose')}
              >
                {t('common.close')}
              </button>
            </div>
            <div className="image-preview-canvas" onWheel={handlePreviewWheel}>
              <img
                src={previewImageSrc}
                alt="preview"
                className="image-preview-content"
                style={{ transform: `scale(${previewZoom})` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
