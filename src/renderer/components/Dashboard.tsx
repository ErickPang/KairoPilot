import { useState, useEffect, useMemo, useCallback } from 'react';
import { AgentConfig, AgentStats, MonitoringTokenQueryResult, SystemStats } from '../types';
import { IconDashboard, IconBot, IconChat, IconCpu, IconArrowLeft, IconRefresh } from './Icons';
import { useTranslation } from '../hooks/useTranslation';
import { KAIRO_INVOKE } from '../../shared/ipc';
import { Select } from './Select';

interface DashboardProps {
  agents: AgentConfig[];
  systemStats: SystemStats | null;
}

const TOKEN_DETAIL_PAGE_SIZE = 10;

export function Dashboard({ agents, systemStats }: DashboardProps) {
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

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const data = await window.kairo.invoke(KAIRO_INVOKE.chatGetAgentStats);
        setStats(data);
      } catch (error) {
        console.error('Failed to fetch agent stats:', error);
      }
    };
    fetchStats();
    // Refresh stats every 10 seconds
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, []);

  const getAgentName = (id: string) => {
    if (id === 'mainAgent') return t('agent.defaultName');
    const agent = agents.find(a => a.id === id);
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
  const modelSelectOptions = useMemo(() => (
    [
      { value: 'all', label: t('dashboard.modelAll') },
      ...tokenDetails.aggregations.models.map((item) => ({
        value: item.value,
        label: `${item.value} (${item.count})`
      }))
    ]
  ), [t, tokenDetails.aggregations.models]);
  const roleSelectOptions = useMemo(() => (
    [
      { value: 'all', label: t('dashboard.roleAll') },
      ...tokenDetails.aggregations.roles.map((item) => ({
        value: item.value,
        label: `${item.value} (${item.count})`
      }))
    ]
  ), [t, tokenDetails.aggregations.roles]);

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
      console.error('Failed to fetch token usage details:', error);
    } finally {
      setDetailLoading(false);
    }
  }, [detailModelFilter, detailPage, detailRoleFilter, detailSearchText, selectedAgentId]);

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

  const formatTimestamp = (timestamp: number) => (
    new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(timestamp)
  );

  const formatRate = (value: number, total: number) => {
    if (total <= 0) {
      return '—';
    }
    return `${((value / total) * 100).toFixed(1)}%`;
  };

  const refreshTokenDetails = async () => {
    await fetchTokenDetails();
  };

  return (
    <div className="dashboard-container" style={{ padding: '2.5rem', height: '100%', overflowY: 'auto', backgroundColor: 'transparent', color: 'var(--foreground)' }}>
      <style>{`
        .stat-card {
          background: rgba(255, 255, 255, 0.85);
          padding: 1.5rem;
          border-radius: 20px;
          border: 1px solid rgba(255, 255, 255, 0.8);
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03), inset 0 1px 0 rgba(255, 255, 255, 1);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          position: relative;
          overflow: hidden;
        }
        .stat-card::before {
          content: "";
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: linear-gradient(135deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0) 100%);
          z-index: 0;
          pointer-events: none;
        }
        .stat-card > * {
          z-index: 1;
        }
        .stat-card:hover {
          transform: translateY(-4px) scale(1.01);
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04), inset 0 1px 0 rgba(255, 255, 255, 1);
          border-color: rgba(255, 255, 255, 0.9);
        }
        .stat-icon-wrapper {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 44px;
          height: 44px;
          border-radius: 12px;
          margin-bottom: 0.5rem;
          box-shadow: inset 0 2px 4px rgba(255, 255, 255, 0.5), 0 4px 8px rgba(0,0,0,0.05);
        }
        .progress-bar-bg {
          height: 8px;
          background: rgba(226, 232, 240, 0.5);
          border-radius: 4px;
          overflow: hidden;
          margin-top: 0.5rem;
          width: 100%;
          box-shadow: inset 0 1px 2px rgba(0,0,0,0.05);
        }
        .progress-bar-fill {
          height: 100%;
          border-radius: 4px;
          transition: width 1s cubic-bezier(0.4, 0, 0.2, 1);
          background-image: linear-gradient(90deg, rgba(255,255,255,0.15) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.15) 75%, transparent 75%, transparent);
          background-size: 1rem 1rem;
        }
        @keyframes pulse-dot {
          0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
          70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
          100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }
        .live-dot {
          width: 8px;
          height: 8px;
          background-color: #10b981;
          border-radius: 50%;
          display: inline-block;
          margin-left: 0.75rem;
          animation: pulse-dot 2s infinite;
        }
        .token-link-button {
          border: none;
          background: transparent;
          padding: 0;
          text-align: left;
          cursor: pointer;
          font: inherit;
        }
        .token-link-button:hover {
          transform: translateY(-1px);
        }
        .agent-token-trigger {
          border: none;
          background: transparent;
          padding: 0;
          color: #8b5cf6;
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
        .token-link-button:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 4px;
          border-radius: 12px;
        }
        .token-detail-toolbar {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 1rem;
          margin-bottom: 2rem;
          flex-wrap: wrap;
        }
        .token-detail-subtitle {
          color: var(--muted-fg);
          margin-top: 0.5rem;
          font-size: 0.95rem;
        }
        .token-badge {
          display: inline-flex;
          align-items: center;
          padding: 0.25rem 0.55rem;
          border-radius: 999px;
          background: rgba(139, 92, 246, 0.12);
          color: #6d28d9;
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
          background: rgba(15, 23, 42, 0.06);
          color: var(--foreground);
          font-size: 0.8rem;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .token-content-cell {
          max-width: 260px;
          color: var(--muted-fg);
          line-height: 1.5;
        }
        .token-pagination {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
          margin-top: 1.25rem;
          flex-wrap: wrap;
        }
        .token-pagination-info {
          color: var(--muted-fg);
          font-size: 0.9rem;
          font-weight: 500;
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
          margin-bottom: 1.5rem;
        }
        .token-filter-group {
          min-width: 0;
        }
        .token-aggregation-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 1rem;
          margin-bottom: 1.5rem;
        }
        .token-aggregation-card {
          background: rgba(255, 255, 255, 0.72);
          border: 1px solid rgba(255, 255, 255, 0.85);
          border-radius: 18px;
          padding: 1rem 1.1rem;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
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
          color: #6d28d9;
          white-space: nowrap;
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
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '1rem 0 0', fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.02em', textShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
                <IconCpu size={36} color="var(--primary)" />
                {t('dashboard.agentTokenDetailsTitle', { agent: selectedAgentName })}
              </h2>
              <div className="token-detail-subtitle">{t('dashboard.agentTokenDetailsSubtitle', { agent: selectedAgentName })}</div>
            </div>
            <button className="btn btn-secondary" onClick={refreshTokenDetails} disabled={detailLoading}>
              <IconRefresh size={16} className={detailLoading ? 'spinning' : ''} />
              {t('common.refresh')}
            </button>
          </div>

          <div className="animate-stagger-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
            <div className="stat-card">
              <div style={{ color: 'var(--muted-fg)', fontWeight: 600, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('dashboard.promptTokens')}
              </div>
              <div style={{ fontSize: '2.5rem', fontWeight: 800, letterSpacing: '-0.03em', background: 'linear-gradient(135deg, #6d28d9 0%, #8b5cf6 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                {tokenDetails.aggregations.promptTokens.toLocaleString()}
              </div>
            </div>
            <div className="stat-card">
              <div style={{ color: 'var(--muted-fg)', fontWeight: 600, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('dashboard.completionTokens')}
              </div>
              <div style={{ fontSize: '2.5rem', fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--foreground)' }}>
                {tokenDetails.aggregations.completionTokens.toLocaleString()}
              </div>
            </div>
            <div className="stat-card">
              <div style={{ color: 'var(--muted-fg)', fontWeight: 600, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('dashboard.totalTokens')}
              </div>
              <div style={{ fontSize: '2.5rem', fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--foreground)' }}>
                {tokenDetails.aggregations.totalTokens.toLocaleString()}
              </div>
            </div>
            <div className="stat-card">
              <div style={{ color: 'var(--muted-fg)', fontWeight: 600, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('dashboard.tokenRecords')}
              </div>
              <div style={{ fontSize: '2.5rem', fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--foreground)' }}>
                {tokenDetails.aggregations.totalRecords.toLocaleString()}
              </div>
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
                  style={{ width: '100%' }}
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
                  style={{ width: '100%' }}
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
                      <td colSpan={6} style={{ padding: '4rem', textAlign: 'center', color: 'var(--muted-fg)', fontSize: '1rem' }}>
                        {t('dashboard.noTokenDetails')}
                      </td>
                    </tr>
                  ) : (
                    tokenDetails.items.map((item) => (
                      <tr key={item.id}>
                        <td style={{ whiteSpace: 'nowrap', color: 'var(--muted-fg)' }}>{formatTimestamp(item.timestamp)}</td>
                        <td><span className="token-model-chip" title={item.model}>{item.model}</span></td>
                        <td><span className="token-badge">{item.role}</span></td>
                        <td style={{ color: 'var(--muted-fg)', fontWeight: 600 }}>{item.promptTokens.toLocaleString()}</td>
                        <td style={{ color: 'var(--muted-fg)', fontWeight: 600 }}>{item.completionTokens.toLocaleString()}</td>
                        <td style={{ fontWeight: 700, color: '#8b5cf6' }}>{item.totalTokens.toLocaleString()}</td>
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
          <h2 className="animate-stagger-1" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem', fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.02em', textShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
            <IconDashboard size={36} color="var(--primary)" /> {t('dashboard.title')}
            <span className="live-dot" title={t('dashboard.liveUpdates')}></span>
          </h2>

          <div className="animate-stagger-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem', marginBottom: '3rem' }}>
            <div className="stat-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ color: 'var(--muted-fg)', fontWeight: 600, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('dashboard.totalTokens')}</div>
                <div className="stat-icon-wrapper" style={{ background: 'linear-gradient(135deg, #a78bfa 0%, #8b5cf6 100%)', color: '#ffffff' }}>
                  <IconCpu size={22} />
                </div>
              </div>
              <div style={{ fontSize: '2.75rem', fontWeight: 800, letterSpacing: '-0.03em', background: 'linear-gradient(135deg, #6d28d9 0%, #8b5cf6 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                {totalTokens.toLocaleString()}
              </div>
            </div>

            <div className="stat-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ color: 'var(--muted-fg)', fontWeight: 600, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('dashboard.totalMessages')}</div>
                <div className="stat-icon-wrapper" style={{ background: 'linear-gradient(135deg, #34d399 0%, #10b981 100%)', color: '#ffffff' }}>
                  <IconChat size={22} />
                </div>
              </div>
              <div style={{ fontSize: '2.75rem', fontWeight: 800, letterSpacing: '-0.03em', background: 'linear-gradient(135deg, #047857 0%, #10b981 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                {totalMessages.toLocaleString()}
              </div>
            </div>

            <div className="stat-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ color: 'var(--muted-fg)', fontWeight: 600, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('dashboard.totalSessions')}</div>
                <div className="stat-icon-wrapper" style={{ background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)', color: '#ffffff' }}>
                  <IconBot size={22} />
                </div>
              </div>
              <div style={{ fontSize: '2.75rem', fontWeight: 800, letterSpacing: '-0.03em', background: 'linear-gradient(135deg, #b45309 0%, #f59e0b 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                {totalSessions.toLocaleString()}
              </div>
            </div>

            <div className="stat-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ color: 'var(--muted-fg)', fontWeight: 600, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('dashboard.totalRuns')}</div>
                <div className="stat-icon-wrapper" style={{ background: 'linear-gradient(135deg, #60a5fa 0%, #2563eb 100%)', color: '#ffffff' }}>
                  <IconRefresh size={22} />
                </div>
              </div>
              <div style={{ fontSize: '2.75rem', fontWeight: 800, letterSpacing: '-0.03em', background: 'linear-gradient(135deg, #1d4ed8 0%, #60a5fa 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                {totalRuns.toLocaleString()}
              </div>
            </div>

            <div className="stat-card">
              <div style={{ color: 'var(--muted-fg)', fontWeight: 600, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('dashboard.runCompletionRate')}
              </div>
              <div style={{ fontSize: '2.5rem', fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--foreground)' }}>
                {formatRate(totalCompletedRuns, totalRuns)}
              </div>
              <div style={{ color: 'var(--muted-fg)', fontSize: '0.85rem' }}>
                {t('dashboard.completedRunsMeta', { completed: totalCompletedRuns, total: totalRuns })}
              </div>
            </div>

            <div className="stat-card">
              <div style={{ color: 'var(--muted-fg)', fontWeight: 600, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('dashboard.approvalAcceptRate')}
              </div>
              <div style={{ fontSize: '2.5rem', fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--foreground)' }}>
                {formatRate(totalApprovalApproved, totalApprovalRequests)}
              </div>
              <div style={{ color: 'var(--muted-fg)', fontSize: '0.85rem' }}>
                {t('dashboard.approvalMeta', { approved: totalApprovalApproved, total: totalApprovalRequests })}
              </div>
            </div>

            <div className="stat-card">
              <div style={{ color: 'var(--muted-fg)', fontWeight: 600, fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('dashboard.toolSuccessRate')}
              </div>
              <div style={{ fontSize: '2.5rem', fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--foreground)' }}>
                {formatRate(totalSuccessfulToolCalls, totalToolCalls)}
              </div>
              <div style={{ color: 'var(--muted-fg)', fontSize: '0.85rem' }}>
                {t('dashboard.toolMeta', { success: totalSuccessfulToolCalls, total: totalToolCalls })}
              </div>
            </div>
          </div>

          <div className="animate-stagger-3" style={{ marginBottom: '3rem' }}>
            <h3 style={{ marginBottom: '1rem', fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {t('dashboard.agentActivity')}
            </h3>
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
                      <td colSpan={9} style={{ padding: '4rem', textAlign: 'center', color: 'var(--muted-fg)', fontSize: '1.1rem' }}>
                        <div style={{ opacity: 0.8, marginBottom: '1rem', display: 'flex', justifyContent: 'center' }}>
                          <div style={{
                            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(16, 185, 129, 0.2) 100%)',
                            padding: '1.5rem',
                            borderRadius: '50%',
                            color: 'var(--primary)',
                            boxShadow: 'inset 0 2px 4px rgba(255,255,255,0.8), 0 4px 12px rgba(16, 185, 129, 0.1)'
                          }}>
                            <IconBot size={48} />
                          </div>
                        </div>
                        <div style={{ fontWeight: 600, color: 'var(--foreground)' }}>{t('dashboard.noActivity')}</div>
                        <div style={{ fontSize: '0.9rem', marginTop: '0.5rem', opacity: 0.8 }}>{t('dashboard.startChatting')}</div>
                      </td>
                    </tr>
                  ) : (
                    stats.map(stat => (
                      <tr key={stat.agentId}>
                        <td style={{ fontWeight: 600 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <div style={{ background: 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)', padding: '0.5rem', borderRadius: '10px', display: 'flex', boxShadow: 'inset 0 1px 2px #fff, 0 1px 2px rgba(0,0,0,0.05)' }}>
                              <IconBot size={18} color="var(--primary)" />
                            </div>
                            {getAgentName(stat.agentId)}
                          </div>
                        </td>
                        <td style={{ fontWeight: 500 }}>{stat.totalSessions}</td>
                        <td style={{ fontWeight: 500 }}>{stat.totalRuns}</td>
                        <td style={{ fontWeight: 500 }}>{stat.totalMessages}</td>
                        <td style={{ fontWeight: 500 }}>{formatRate(stat.completedRuns, stat.totalRuns)}</td>
                        <td style={{ fontWeight: 500 }}>{formatRate(stat.approvalApproved, stat.approvalRequests)}</td>
                        <td style={{ fontWeight: 500 }}>{formatRate(stat.successfulToolCalls, stat.toolCalls)}</td>
                        <td style={{ color: 'var(--muted-fg)' }}>{stat.promptTokens.toLocaleString()}</td>
                        <td style={{ color: 'var(--muted-fg)' }}>{stat.completionTokens.toLocaleString()}</td>
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
            <div className="animate-stagger-4">
               <h3 style={{ marginBottom: '1rem', fontSize: '1.25rem', fontWeight: 700 }}>{t('dashboard.systemResources')}</h3>
               <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' }}>
                  <div className="stat-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <div style={{ color: 'var(--muted-fg)', fontSize: '0.875rem', fontWeight: 600, textTransform: 'uppercase' }}>{t('dashboard.cpuUsage')}</div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{systemStats.cpuUsage}%</div>
                    </div>
                    <div className="progress-bar-bg">
                      <div className="progress-bar-fill" style={{ width: `${Math.min(systemStats.cpuUsage, 100)}%`, backgroundColor: systemStats.cpuUsage > 80 ? '#ef4444' : '#3b82f6' }}></div>
                    </div>
                  </div>

                  <div className="stat-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <div style={{ color: 'var(--muted-fg)', fontSize: '0.875rem', fontWeight: 600, textTransform: 'uppercase' }}>{t('dashboard.memoryUsage')}</div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{systemStats.memoryUsage}%</div>
                    </div>
                    <div className="progress-bar-bg">
                      <div className="progress-bar-fill" style={{ width: `${Math.min(systemStats.memoryUsage, 100)}%`, backgroundColor: systemStats.memoryUsage > 80 ? '#ef4444' : '#10b981' }}></div>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', marginTop: '0.75rem', textAlign: 'right', fontWeight: 500 }}>
                      {t('dashboard.totalGb', { total: systemStats.totalMemory })}
                    </div>
                  </div>

                  <div className="stat-card" style={{ display: 'flex', justifyContent: 'center' }}>
                    <div style={{ color: 'var(--muted-fg)', fontSize: '0.875rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.5rem' }}>{t('dashboard.systemUptime')}</div>
                    <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--foreground)' }}>
                      {systemStats.uptime} <span style={{ fontSize: '1rem', color: 'var(--muted-fg)', fontWeight: 500 }}>{t('dashboard.hrs')}</span>
                    </div>
                  </div>
               </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
