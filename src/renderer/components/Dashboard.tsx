import { memo, useState, useEffect, useMemo, useCallback } from 'react';
import { AgentConfig, AgentStats, MonitoringTokenQueryResult } from '../types';
import { IconDashboard, IconBot, IconChat, IconCpu, IconArrowLeft, IconRefresh } from './Icons';
import { useTranslation } from '../hooks/useTranslation';
import { KAIRO_INVOKE } from '../../shared/ipc';
import { Select } from './Select';
import { getErrorMessage, logRendererError } from '../hooks/errorUtils';
import { useSystemStats } from '../hooks/useSystemStats';

interface DashboardProps {
  agents: AgentConfig[];
  isActive: boolean;
  onReportError?: (message: string, source: string) => void;
}

const TOKEN_DETAIL_PAGE_SIZE = 10;

export const Dashboard = memo(function Dashboard({ agents, isActive, onReportError }: DashboardProps) {
  const [stats, setStats] = useState<AgentStats[]>([]);
  const [view, setView] = useState<'overview' | 'tokenDetails'>('overview');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailPage, setDetailPage] = useState(1);
  const [detailSearchText, setDetailSearchText] = useState('');
  const [detailModelFilter, setDetailModelFilter] = useState('all');
  const [detailRoleFilter, setDetailRoleFilter] = useState('all');
  const [tokenDetails, setTokenDetails] = useState<MonitoringTokenQueryResult>({
    items: [],
    total: 0,
    page: 1,
    pageSize: TOKEN_DETAIL_PAGE_SIZE,
    totalPages: 1,
    aggregations: {
      totalRecords: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      models: [],
      roles: []
    }
  });
  const { t } = useTranslation();
  const systemStats = useSystemStats(isActive);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const fetchStats = async () => {
      try {
        const data = await window.kairo.invoke(KAIRO_INVOKE.chatGetAgentStats);
        setStats(data);
      } catch (error) {
        logRendererError('Failed to fetch agent stats', error);
        onReportError?.(t('dashboard.error.loadStats', { error: getErrorMessage(error) }), 'dashboard_stats');
      }
    };

    void fetchStats();
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, [isActive, onReportError, t]);

  const getAgentName = (id: string) => {
    if (id === 'mainAgent') {
      return t('agent.defaultName');
    }
    const agent = agents.find((item) => item.id === id);
    return agent ? agent.name : 'Unknown Agent';
  };

  const totalTokens = stats.reduce((acc, stat) => acc + stat.totalTokens, 0);
  const totalMessages = stats.reduce((acc, stat) => acc + stat.totalMessages, 0);
  const totalSessions = stats.reduce((acc, stat) => acc + stat.totalSessions, 0);
  const totalRuns = stats.reduce((acc, stat) => acc + stat.totalRuns, 0);
  const totalCompletedRuns = stats.reduce((acc, stat) => acc + stat.completedRuns, 0);
  const totalApprovalRequests = stats.reduce((acc, stat) => acc + stat.approvalRequests, 0);
  const totalApprovalApproved = stats.reduce((acc, stat) => acc + stat.approvalApproved, 0);
  const totalToolCalls = stats.reduce((acc, stat) => acc + stat.toolCalls, 0);
  const totalSuccessfulToolCalls = stats.reduce((acc, stat) => acc + stat.successfulToolCalls, 0);
  const selectedAgentName = selectedAgentId ? getAgentName(selectedAgentId) : '';

  const modelSelectOptions = useMemo(
    () => [
      { value: 'all', label: t('dashboard.modelAll') },
      ...tokenDetails.aggregations.models.map((item) => ({
        value: item.value,
        label: `${item.value} (${item.count})`
      }))
    ],
    [t, tokenDetails.aggregations.models]
  );

  const roleSelectOptions = useMemo(
    () => [
      { value: 'all', label: t('dashboard.roleAll') },
      ...tokenDetails.aggregations.roles.map((item) => ({
        value: item.value,
        label: `${item.value} (${item.count})`
      }))
    ],
    [t, tokenDetails.aggregations.roles]
  );

  const fetchTokenDetails = useCallback(async () => {
    if (!selectedAgentId) {
      return;
    }

    try {
      setDetailLoading(true);
      const data = await window.kairo.invoke(KAIRO_INVOKE.chatGetTokenUsageDetails, {
        agentId: selectedAgentId,
        page: detailPage,
        pageSize: TOKEN_DETAIL_PAGE_SIZE,
        search: detailSearchText.trim() || undefined,
        model: detailModelFilter !== 'all' ? detailModelFilter : undefined,
        role: detailRoleFilter
      });
      setTokenDetails(data);
    } catch (error) {
      logRendererError('Failed to fetch token usage details', error);
      onReportError?.(t('dashboard.error.loadTokenDetails', { error: getErrorMessage(error) }), 'dashboard_token_details');
    } finally {
      setDetailLoading(false);
    }
  }, [detailModelFilter, detailPage, detailRoleFilter, detailSearchText, onReportError, selectedAgentId, t]);

  useEffect(() => {
    if (view !== 'tokenDetails' || !selectedAgentId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void fetchTokenDetails();
    }, detailSearchText.trim() ? 250 : 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [detailSearchText, fetchTokenDetails, selectedAgentId, view]);

  const formatTimestamp = (timestamp: number) =>
    new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(timestamp);

  const formatRate = (value: number, total: number) => {
    if (total <= 0) {
      return '—';
    }
    return `${((value / total) * 100).toFixed(1)}%`;
  };

  const refreshTokenDetails = async () => {
    await fetchTokenDetails();
  };

  const summaryCards = [
    {
      label: t('dashboard.totalTokens'),
      value: totalTokens.toLocaleString(),
      meta: undefined,
      accent: 'accent',
      icon: <IconCpu size={22} />,
      iconStyle: {
        background: 'linear-gradient(135deg, rgba(var(--info-rgb), 0.16) 0%, rgba(var(--info-rgb), 0.32) 100%)',
        color: 'var(--info)'
      }
    },
    {
      label: t('dashboard.totalMessages'),
      value: totalMessages.toLocaleString(),
      meta: undefined,
      accent: '',
      icon: <IconChat size={22} />,
      iconStyle: {
        background: 'linear-gradient(135deg, rgba(var(--success-rgb), 0.16) 0%, rgba(var(--success-rgb), 0.32) 100%)',
        color: 'var(--success)'
      }
    },
    {
      label: t('dashboard.totalSessions'),
      value: totalSessions.toLocaleString(),
      meta: undefined,
      accent: '',
      icon: <IconBot size={22} />,
      iconStyle: {
        background: 'linear-gradient(135deg, rgba(var(--warning-rgb), 0.16) 0%, rgba(var(--warning-rgb), 0.32) 100%)',
        color: 'var(--warning)'
      }
    },
    {
      label: t('dashboard.totalRuns'),
      value: totalRuns.toLocaleString(),
      meta: undefined,
      accent: 'accent',
      icon: <IconRefresh size={22} />,
      iconStyle: {
        background: 'linear-gradient(135deg, rgba(var(--primary-soft-rgb), 0.18) 0%, rgba(var(--primary-rgb), 0.26) 100%)',
        color: 'var(--primary)'
      }
    },
    {
      label: t('dashboard.runCompletionRate'),
      value: formatRate(totalCompletedRuns, totalRuns),
      meta: t('dashboard.completedRunsMeta', { completed: totalCompletedRuns, total: totalRuns }),
      accent: '',
      icon: null,
      iconStyle: undefined
    },
    {
      label: t('dashboard.approvalAcceptRate'),
      value: formatRate(totalApprovalApproved, totalApprovalRequests),
      meta: t('dashboard.approvalMeta', { approved: totalApprovalApproved, total: totalApprovalRequests }),
      accent: '',
      icon: null,
      iconStyle: undefined
    },
    {
      label: t('dashboard.toolSuccessRate'),
      value: formatRate(totalSuccessfulToolCalls, totalToolCalls),
      meta: t('dashboard.toolMeta', { success: totalSuccessfulToolCalls, total: totalToolCalls }),
      accent: '',
      icon: null,
      iconStyle: undefined
    }
  ];

  return (
    <div className="dashboard-container">
      <style>{`
        .dashboard-container {
          padding: 1.7rem 2rem 1.8rem;
          height: 100%;
          overflow-y: auto;
          background: transparent;
          color: var(--foreground);
        }
        .dashboard-hero {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 1.25rem;
          margin-bottom: 1.5rem;
          padding: 1.4rem 1.45rem;
          border: 1px solid rgba(var(--border-rgb), 0.58);
          border-radius: 1.6rem;
          background:
            radial-gradient(circle at top right, rgba(var(--primary-rgb), 0.1), transparent 28%),
            var(--card);
          box-shadow: var(--shine-strong);
        }
        .dashboard-hero-copy {
          min-width: 0;
          flex: 1;
        }
        .dashboard-eyebrow {
          display: inline-flex;
          align-items: center;
          padding: 0.34rem 0.72rem;
          border-radius: 999px;
          background: var(--primary-muted);
          color: var(--primary);
          font-size: 0.78rem;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .dashboard-title-row {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin: 0.95rem 0 0.5rem;
        }
        .dashboard-title {
          margin: 0;
          font-size: 2rem;
          font-weight: 700;
          letter-spacing: -0.03em;
        }
        .dashboard-subtitle {
          margin: 0;
          max-width: 42rem;
          color: var(--muted-fg);
          font-size: 0.96rem;
          line-height: 1.65;
        }
        .dashboard-hero-meta {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.75rem;
          min-width: 18rem;
        }
        .dashboard-hero-chip {
          display: flex;
          flex-direction: column;
          gap: 0.22rem;
          padding: 0.9rem 1rem;
          border: 1px solid rgba(var(--border-rgb), 0.56);
          border-radius: 1.1rem;
          background: rgba(var(--surface-rgb), 0.72);
        }
        .dashboard-hero-chip-label,
        .dashboard-stat-label {
          color: var(--muted-fg);
          font-size: 0.77rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .dashboard-hero-chip-value {
          color: var(--foreground);
          font-size: 1.05rem;
          font-weight: 700;
        }
        .dashboard-summary-grid,
        .dashboard-resource-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 1rem;
        }
        .dashboard-summary-grid {
          margin-bottom: 1.7rem;
        }
        .dashboard-resource-grid {
          margin-top: 1rem;
        }
        .dashboard-section {
          margin-bottom: 1.7rem;
        }
        .dashboard-section:last-child {
          margin-bottom: 0;
        }
        .dashboard-section-title {
          margin: 0 0 0.95rem;
          font-size: 1.1rem;
          font-weight: 700;
          letter-spacing: -0.02em;
        }
        .stat-card {
          background: linear-gradient(180deg, rgba(var(--surface-rgb), 0.88), rgba(var(--surface-alt-rgb), 0.86));
          padding: 1.15rem 1.2rem;
          border-radius: 1.35rem;
          border: 1px solid rgba(var(--border-rgb), 0.56);
          box-shadow: none;
          transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
          display: flex;
          flex-direction: column;
          gap: 0.55rem;
          position: relative;
          overflow: hidden;
        }
        .stat-card::before {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, rgba(255,255,255,0.24) 0%, rgba(255,255,255,0) 100%);
          pointer-events: none;
        }
        .stat-card > * {
          position: relative;
          z-index: 1;
        }
        .stat-card:hover {
          transform: translateY(-1px);
          box-shadow: var(--shadow-soft);
          border-color: rgba(var(--primary-rgb), 0.14);
        }
        .dashboard-stat-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
        }
        .stat-icon-wrapper {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 44px;
          height: 44px;
          border-radius: 12px;
          box-shadow: var(--shine-soft);
        }
        .dashboard-stat-value {
          font-size: 2.3rem;
          font-weight: 800;
          letter-spacing: -0.04em;
          color: var(--foreground);
          line-height: 1;
        }
        .dashboard-stat-value.is-accent {
          color: var(--primary);
        }
        .dashboard-stat-meta {
          color: var(--muted-fg);
          font-size: 0.84rem;
          line-height: 1.5;
        }
        .progress-bar-bg {
          height: 8px;
          background: rgba(var(--surface-alt-rgb), 0.88);
          border-radius: 4px;
          overflow: hidden;
          margin-top: 0.5rem;
          width: 100%;
          box-shadow: inset 0 1px 2px rgba(var(--shadow-rgb), 0.1);
        }
        .progress-bar-fill {
          height: 100%;
          border-radius: 4px;
          transition: width 1s cubic-bezier(0.4, 0, 0.2, 1);
          background-image: linear-gradient(90deg, rgba(255,255,255,0.15) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.15) 75%, transparent 75%, transparent);
          background-size: 1rem 1rem;
        }
        @keyframes pulse-dot {
          0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(var(--primary-rgb), 0.35); }
          70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(var(--primary-rgb), 0); }
          100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(var(--primary-rgb), 0); }
        }
        .live-dot {
          width: 8px;
          height: 8px;
          background-color: var(--primary);
          border-radius: 50%;
          display: inline-block;
          animation: pulse-dot 2s infinite;
        }
        .agent-token-trigger {
          border: none;
          background: transparent;
          padding: 0;
          color: var(--primary);
          font: inherit;
          font-weight: 700;
          cursor: pointer;
          transition: transform 0.2s ease, opacity 0.2s ease;
        }
        .agent-token-trigger:hover {
          transform: translateY(-1px);
          opacity: 0.9;
        }
        .agent-token-trigger:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 4px;
          border-radius: 8px;
        }
        .token-detail-toolbar {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 1rem;
          margin-bottom: 1.5rem;
          flex-wrap: wrap;
        }
        .dashboard-detail-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin: 1rem 0 0;
        }
        .dashboard-detail-title {
          margin: 0;
          font-size: 1.8rem;
          font-weight: 700;
          letter-spacing: -0.03em;
        }
        .token-detail-subtitle,
        .token-pagination-info {
          color: var(--muted-fg);
          font-size: 0.9rem;
        }
        .token-badge {
          display: inline-flex;
          align-items: center;
          padding: 0.25rem 0.55rem;
          border-radius: 999px;
          background: var(--primary-muted);
          color: var(--primary);
          font-size: 0.75rem;
          font-weight: 700;
          letter-spacing: 0.02em;
        }
        .token-model-chip {
          display: inline-flex;
          align-items: center;
          max-width: 220px;
          padding: 0.35rem 0.6rem;
          border-radius: 999px;
          background: rgba(var(--shadow-rgb), 0.06);
          color: var(--foreground);
          font-size: 0.8rem;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .token-pagination {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
          margin-top: 1.1rem;
          flex-wrap: wrap;
        }
        .token-pagination-actions {
          display: flex;
          gap: 0.75rem;
          align-items: center;
        }
        .token-filter-panel {
          display: grid;
          grid-template-columns: minmax(220px, 1fr) repeat(2, minmax(160px, 220px)) auto;
          gap: 0.75rem;
          align-items: center;
          margin-bottom: 1rem;
        }
        .token-filter-group {
          min-width: 0;
        }
        .token-aggregation-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 1rem;
          margin-bottom: 1rem;
        }
        .token-aggregation-card {
          background: rgba(var(--surface-rgb), 0.82);
          border: 1px solid rgba(var(--border-rgb), 0.56);
          border-radius: 1.2rem;
          padding: 1rem 1.1rem;
        }
        .token-aggregation-title {
          font-size: 0.85rem;
          font-weight: 700;
          color: var(--muted-fg);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.85rem;
        }
        .token-aggregation-list {
          display: flex;
          flex-direction: column;
          gap: 0.7rem;
        }
        .token-aggregation-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
        }
        .token-aggregation-item-label {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
          min-width: 0;
        }
        .token-aggregation-item-name {
          font-weight: 700;
          color: var(--foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .token-aggregation-item-meta {
          font-size: 0.82rem;
          color: var(--muted-fg);
        }
        .token-aggregation-item-value {
          font-weight: 800;
          color: var(--primary);
          white-space: nowrap;
        }
        .dashboard-empty-state {
          padding: 3.5rem 1.25rem;
          text-align: center;
          color: var(--muted-fg);
        }
        .dashboard-empty-title {
          font-weight: 600;
          color: var(--foreground);
        }
        .dashboard-empty-description {
          margin-top: 0.5rem;
          font-size: 0.9rem;
          opacity: 0.8;
        }
        .dashboard-empty-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 5rem;
          height: 5rem;
          margin-bottom: 1rem;
          border-radius: 1.5rem;
          background: var(--primary-muted);
          color: var(--primary);
        }
        .dashboard-agent-cell {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        .dashboard-agent-icon {
          background: linear-gradient(180deg, rgba(var(--primary-rgb), 0.12), rgba(var(--surface-rgb), 0.96));
          padding: 0.5rem;
          border-radius: 0.8rem;
          display: flex;
          box-shadow: var(--shine-soft);
        }
        .dashboard-uptime-value {
          display: flex;
          align-items: baseline;
          gap: 0.35rem;
          font-size: 2rem;
          font-weight: 700;
          color: var(--foreground);
        }
        .dashboard-uptime-unit {
          font-size: 0.98rem;
          color: var(--muted-fg);
          font-weight: 600;
        }
        .dashboard-table-timestamp {
          white-space: nowrap;
          color: var(--muted-fg);
        }
        .dashboard-table-number-muted {
          color: var(--muted-fg);
          font-weight: 600;
        }
        .dashboard-table-number-strong {
          font-weight: 700;
          color: var(--primary);
        }
        .dashboard-table-number-subtle {
          color: var(--muted-fg);
        }
        .dashboard-table-cell-strong {
          font-weight: 600;
        }
        .dashboard-table-cell-medium {
          font-weight: 500;
        }
        .dashboard-resource-value {
          font-size: 1.1rem;
          font-weight: 700;
        }
        .dashboard-resource-meta {
          margin-top: 0.75rem;
          text-align: right;
          font-size: 0.8rem;
          font-weight: 500;
          color: var(--muted-fg);
        }
        .dashboard-stat-card-center {
          justify-content: center;
        }
        @media (max-width: 960px) {
          .dashboard-container {
            padding: 1.2rem 1rem 1.3rem;
          }
          .dashboard-hero {
            flex-direction: column;
          }
          .dashboard-hero-meta {
            width: 100%;
            min-width: 0;
          }
          .token-filter-panel {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 720px) {
          .dashboard-hero-meta {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      {view === 'tokenDetails' ? (
        <>
          <div className="token-detail-toolbar animate-stagger-1">
            <div>
              <button className="btn btn-secondary" onClick={() => setView('overview')}>
                <IconArrowLeft size={16} />
                {t('dashboard.backToOverview')}
              </button>
              <div className="dashboard-detail-header">
                <IconCpu size={36} color="var(--primary)" />
                <h2 className="dashboard-detail-title">{t('dashboard.agentTokenDetailsTitle', { agent: selectedAgentName })}</h2>
              </div>
              <div className="token-detail-subtitle">{t('dashboard.agentTokenDetailsSubtitle', { agent: selectedAgentName })}</div>
            </div>
            <button className="btn btn-secondary" onClick={refreshTokenDetails} disabled={detailLoading}>
              <IconRefresh size={16} className={detailLoading ? 'spinning' : ''} />
              {t('common.refresh')}
            </button>
          </div>

          <div className="dashboard-summary-grid animate-stagger-2">
            <div className="stat-card">
              <div className="dashboard-stat-label">{t('dashboard.promptTokens')}</div>
              <div className="dashboard-stat-value is-accent">{tokenDetails.aggregations.promptTokens.toLocaleString()}</div>
            </div>
            <div className="stat-card">
              <div className="dashboard-stat-label">{t('dashboard.completionTokens')}</div>
              <div className="dashboard-stat-value">{tokenDetails.aggregations.completionTokens.toLocaleString()}</div>
            </div>
            <div className="stat-card">
              <div className="dashboard-stat-label">{t('dashboard.totalTokens')}</div>
              <div className="dashboard-stat-value">{tokenDetails.aggregations.totalTokens.toLocaleString()}</div>
            </div>
            <div className="stat-card">
              <div className="dashboard-stat-label">{t('dashboard.tokenRecords')}</div>
              <div className="dashboard-stat-value">{tokenDetails.aggregations.totalRecords.toLocaleString()}</div>
            </div>
          </div>

          <div className="animate-stagger-3">
            <div className="token-filter-panel">
              <div className="token-filter-group">
                <input
                  className="form-control"
                  value={detailSearchText}
                  onChange={(event) => {
                    setDetailSearchText(event.target.value);
                    setDetailPage(1);
                  }}
                  placeholder={t('dashboard.searchPlaceholder')}
                />
              </div>
              <div className="token-filter-group">
                <Select
                  value={detailModelFilter}
                  onChange={(value) => {
                    setDetailModelFilter(value);
                    setDetailPage(1);
                  }}
                  options={modelSelectOptions}
                  className="select-fill"
                />
              </div>
              <div className="token-filter-group">
                <Select
                  value={detailRoleFilter}
                  onChange={(value) => {
                    setDetailRoleFilter(value);
                    setDetailPage(1);
                  }}
                  options={roleSelectOptions}
                  className="select-fill"
                />
              </div>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setDetailSearchText('');
                  setDetailModelFilter('all');
                  setDetailRoleFilter('all');
                  setDetailPage(1);
                }}
              >
                {t('dashboard.clearFilters')}
              </button>
            </div>

            <div className="token-aggregation-grid">
              <div className="token-aggregation-card">
                <div className="token-aggregation-title">{t('dashboard.topModels')}</div>
                <div className="token-aggregation-list">
                  {tokenDetails.aggregations.models.length === 0 ? (
                    <div className="token-aggregation-item-meta">{t('dashboard.noAggregationData')}</div>
                  ) : (
                    tokenDetails.aggregations.models.slice(0, 5).map((item) => (
                      <div key={item.value} className="token-aggregation-item">
                        <div className="token-aggregation-item-label">
                          <div className="token-aggregation-item-name">{item.value}</div>
                          <div className="token-aggregation-item-meta">
                            {t('dashboard.tokenFacetMeta', { count: item.count, prompt: item.promptTokens, completion: item.completionTokens })}
                          </div>
                        </div>
                        <div className="token-aggregation-item-value">{item.totalTokens.toLocaleString()}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="token-aggregation-card">
                <div className="token-aggregation-title">{t('dashboard.topRoles')}</div>
                <div className="token-aggregation-list">
                  {tokenDetails.aggregations.roles.length === 0 ? (
                    <div className="token-aggregation-item-meta">{t('dashboard.noAggregationData')}</div>
                  ) : (
                    tokenDetails.aggregations.roles.slice(0, 5).map((item) => (
                      <div key={item.value} className="token-aggregation-item">
                        <div className="token-aggregation-item-label">
                          <div className="token-aggregation-item-name">{item.value}</div>
                          <div className="token-aggregation-item-meta">
                            {t('dashboard.tokenFacetMeta', { count: item.count, prompt: item.promptTokens, completion: item.completionTokens })}
                          </div>
                        </div>
                        <div className="token-aggregation-item-value">{item.totalTokens.toLocaleString()}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('dashboard.requestTime')}</th>
                    <th>{t('dashboard.model')}</th>
                    <th>{t('dashboard.role')}</th>
                    <th>{t('dashboard.promptTokens')}</th>
                    <th>{t('dashboard.completionTokens')}</th>
                    <th>{t('dashboard.totalTokens')}</th>
                  </tr>
                </thead>
                <tbody>
                  {!detailLoading && tokenDetails.items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="dashboard-empty-state">
                        {t('dashboard.noTokenDetails')}
                      </td>
                    </tr>
                  ) : (
                    tokenDetails.items.map((item) => (
                      <tr key={item.id}>
                        <td className="dashboard-table-timestamp">{formatTimestamp(item.timestamp)}</td>
                        <td><span className="token-model-chip" title={item.model}>{item.model}</span></td>
                        <td><span className="token-badge">{item.role}</span></td>
                        <td className="dashboard-table-number-muted">{item.promptTokens.toLocaleString()}</td>
                        <td className="dashboard-table-number-muted">{item.completionTokens.toLocaleString()}</td>
                        <td className="dashboard-table-number-strong">{item.totalTokens.toLocaleString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="token-pagination">
              <div className="token-pagination-info">
                {t('dashboard.pageInfo', { page: tokenDetails.page, totalPages: tokenDetails.totalPages, total: tokenDetails.total })}
              </div>
              <div className="token-pagination-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => setDetailPage((current) => Math.max(1, current - 1))}
                  disabled={detailLoading || tokenDetails.page <= 1}
                >
                  {t('common.previous')}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => setDetailPage((current) => Math.min(tokenDetails.totalPages, current + 1))}
                  disabled={detailLoading || tokenDetails.page >= tokenDetails.totalPages}
                >
                  {t('common.next')}
                </button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="dashboard-hero animate-stagger-1">
            <div className="dashboard-hero-copy">
              <span className="dashboard-eyebrow">{t('dashboard.liveUpdates')}</span>
              <div className="dashboard-title-row">
                <IconDashboard size={34} color="var(--primary)" />
                <h2 className="dashboard-title">{t('dashboard.title')}</h2>
                <span className="live-dot" title={t('dashboard.liveUpdates')}></span>
              </div>
              <p className="dashboard-subtitle">{t('audit.runCenterSubtitle')}</p>
            </div>
            <div className="dashboard-hero-meta">
              <div className="dashboard-hero-chip">
                <span className="dashboard-hero-chip-label">{t('dashboard.totalRuns')}</span>
                <span className="dashboard-hero-chip-value">{totalRuns.toLocaleString()}</span>
              </div>
              <div className="dashboard-hero-chip">
                <span className="dashboard-hero-chip-label">{t('dashboard.totalTokens')}</span>
                <span className="dashboard-hero-chip-value">{totalTokens.toLocaleString()}</span>
              </div>
              <div className="dashboard-hero-chip">
                <span className="dashboard-hero-chip-label">{t('dashboard.cpuUsage')}</span>
                <span className="dashboard-hero-chip-value">{systemStats ? `${systemStats.cpuUsage}%` : '—'}</span>
              </div>
              <div className="dashboard-hero-chip">
                <span className="dashboard-hero-chip-label">{t('dashboard.memoryUsage')}</span>
                <span className="dashboard-hero-chip-value">{systemStats ? `${systemStats.memoryUsage}%` : '—'}</span>
              </div>
            </div>
          </div>

          <div className="dashboard-summary-grid animate-stagger-2">
            {summaryCards.map((card) => (
              <div key={card.label} className="stat-card">
                {card.icon ? (
                  <div className="dashboard-stat-header">
                    <div className="dashboard-stat-label">{card.label}</div>
                    <div className="stat-icon-wrapper" style={card.iconStyle}>{card.icon}</div>
                  </div>
                ) : (
                  <div className="dashboard-stat-label">{card.label}</div>
                )}
                <div className={`dashboard-stat-value ${card.accent ? 'is-accent' : ''}`}>{card.value}</div>
                {card.meta && <div className="dashboard-stat-meta">{card.meta}</div>}
              </div>
            ))}
          </div>

          <div className="dashboard-section animate-stagger-3">
            <h3 className="dashboard-section-title">{t('dashboard.agentActivity')}</h3>
            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('dashboard.agentName')}</th>
                    <th>{t('dashboard.sessions')}</th>
                    <th>{t('dashboard.runs')}</th>
                    <th>{t('dashboard.messages')}</th>
                    <th>{t('dashboard.runCompletionRate')}</th>
                    <th>{t('dashboard.approvalAcceptRate')}</th>
                    <th>{t('dashboard.toolSuccessRate')}</th>
                    <th>{t('dashboard.promptTokens')}</th>
                    <th>{t('dashboard.completionTokens')}</th>
                    <th>{t('dashboard.totalTokens')}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="dashboard-empty-state">
                        <div className="dashboard-empty-icon">
                          <IconBot size={48} />
                        </div>
                        <div className="dashboard-empty-title">{t('dashboard.noActivity')}</div>
                        <div className="dashboard-empty-description">{t('dashboard.startChatting')}</div>
                      </td>
                    </tr>
                  ) : (
                    stats.map((stat) => (
                      <tr key={stat.agentId}>
                        <td className="dashboard-table-cell-strong">
                          <div className="dashboard-agent-cell">
                            <div className="dashboard-agent-icon">
                              <IconBot size={18} color="var(--primary)" />
                            </div>
                            {getAgentName(stat.agentId)}
                          </div>
                        </td>
                        <td className="dashboard-table-cell-medium">{stat.totalSessions}</td>
                        <td className="dashboard-table-cell-medium">{stat.totalRuns}</td>
                        <td className="dashboard-table-cell-medium">{stat.totalMessages}</td>
                        <td className="dashboard-table-cell-medium">{formatRate(stat.completedRuns, stat.totalRuns)}</td>
                        <td className="dashboard-table-cell-medium">{formatRate(stat.approvalApproved, stat.approvalRequests)}</td>
                        <td className="dashboard-table-cell-medium">{formatRate(stat.successfulToolCalls, stat.toolCalls)}</td>
                        <td className="dashboard-table-number-subtle">{stat.promptTokens.toLocaleString()}</td>
                        <td className="dashboard-table-number-subtle">{stat.completionTokens.toLocaleString()}</td>
                        <td>
                          <button
                            className="agent-token-trigger"
                            onClick={() => {
                              setSelectedAgentId(stat.agentId);
                              setDetailPage(1);
                              setDetailSearchText('');
                              setDetailModelFilter('all');
                              setDetailRoleFilter('all');
                              setView('tokenDetails');
                            }}
                            title={t('dashboard.openAgentTokenDetails', { agent: getAgentName(stat.agentId) })}
                          >
                            {stat.totalTokens.toLocaleString()}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {systemStats && (
            <div className="dashboard-section animate-stagger-4">
              <h3 className="dashboard-section-title">{t('dashboard.systemResources')}</h3>
              <div className="dashboard-resource-grid">
                <div className="stat-card">
                  <div className="dashboard-stat-header">
                    <div className="dashboard-stat-label">{t('dashboard.cpuUsage')}</div>
                    <div className="dashboard-resource-value">{systemStats.cpuUsage}%</div>
                  </div>
                  <div className="progress-bar-bg">
                    <div
                      className="progress-bar-fill"
                      style={{ width: `${Math.min(systemStats.cpuUsage, 100)}%`, backgroundColor: systemStats.cpuUsage > 80 ? 'var(--danger)' : 'var(--primary)' }}
                    />
                  </div>
                </div>

                <div className="stat-card">
                  <div className="dashboard-stat-header">
                    <div className="dashboard-stat-label">{t('dashboard.memoryUsage')}</div>
                    <div className="dashboard-resource-value">{systemStats.memoryUsage}%</div>
                  </div>
                  <div className="progress-bar-bg">
                    <div
                      className="progress-bar-fill"
                      style={{ width: `${Math.min(systemStats.memoryUsage, 100)}%`, backgroundColor: systemStats.memoryUsage > 80 ? 'var(--danger)' : 'var(--success)' }}
                    />
                  </div>
                  <div className="dashboard-resource-meta">
                    {t('dashboard.totalGb', { total: systemStats.totalMemory })}
                  </div>
                </div>

                <div className="stat-card dashboard-stat-card-center">
                  <div className="dashboard-stat-label">{t('dashboard.systemUptime')}</div>
                  <div className="dashboard-uptime-value">
                    {systemStats.uptime} <span className="dashboard-uptime-unit">{t('dashboard.hrs')}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
});
