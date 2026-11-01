import {UsageOverview} from './UsageOverview';
import {DateField} from './DateField';
import { memo, useState, useEffect, useMemo, useCallback } from 'react';
import { MonitoringTokenQueryResult } from '../types';
import { IconCpu, IconArrowLeft, IconRefresh } from './Icons';
import { useTranslation } from '../hooks/useTranslation';
import { KAIRO_INVOKE } from '../../shared/ipc';
import { Select } from './Select';
import { getErrorMessage, logRendererError } from '../hooks/errorUtils';
import './Dashboard.css';

interface DashboardProps {
  isActive: boolean;
  onReportError?: (message: string, source: string) => void;
}

const TOKEN_DETAIL_PAGE_SIZE = 10;

export const Dashboard = memo(function Dashboard({ isActive, onReportError }: DashboardProps) {
  const [view, setView] = useState<'overview' | 'tokenDetails'>('overview');
  const [projectId,setProjectId]=useState('');
  const [sessionId,setSessionId]=useState('');
  const [startDate,setStartDate]=useState('');
  const [endDate,setEndDate]=useState('');
  const [projects,setProjects]=useState<Array<{id:string;name:string}>>([]);
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
    if (!isActive) {
      return;
    }

    let cancelled = false;
    const fetchProjects = async () => {
      try {
        const data = await window.kairo.invoke(KAIRO_INVOKE.projectList);
        if (!cancelled) {
          setProjects(data);
        }
      } catch (error) {
        if (!cancelled) {
          logRendererError('Failed to fetch usage projects', error);
          onReportError?.(t('dashboard.error.loadProjects', { error: getErrorMessage(error) }), 'dashboard_projects');
        }
      }
    };

    void fetchProjects();
    return () => { cancelled = true; };
  }, [isActive, onReportError, t]);

  const selectedAgentName = t('workbench.workbenchScope');

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
    try {
      setDetailLoading(true);
      const data = await window.kairo.invoke(KAIRO_INVOKE.chatGetTokenUsageDetails, {
        projectId: projectId || undefined,
        sessionId: sessionId.trim() || undefined,
        startTime: startDate ? new Date(`${startDate}T00:00:00`).getTime() : undefined,
        endTime: endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : undefined,
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
  }, [detailModelFilter, detailPage, detailRoleFilter, detailSearchText, onReportError, projectId, sessionId, startDate, endDate, t]);

  useEffect(() => {
    if (view !== 'tokenDetails') {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void fetchTokenDetails();
    }, detailSearchText.trim() ? 250 : 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [detailSearchText, fetchTokenDetails, view]);

  const formatTimestamp = (timestamp: number) =>
    new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(timestamp);

  const refreshTokenDetails = async () => {
    await fetchTokenDetails();
  };

  return (
    <div className="dashboard-container">
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
              <Select aria-label={t('workbench.project')} value={projectId} onChange={value=>{setProjectId(value);setDetailPage(1);}} options={[{value:'',label:t('workbench.allProjects')},...projects.map(project=>({value:project.id,label:project.name}))]}/>
              <input className="form-control" aria-label={t('workbench.taskId')} placeholder={t('workbench.taskId')} value={sessionId} onChange={event=>{setSessionId(event.target.value);setDetailPage(1);}}/>
              <DateField label={t('workbench.startDate')} value={startDate} onChange={value=>{setStartDate(value);setDetailPage(1);}}/>
              <DateField label={t('workbench.endDate')} value={endDate} onChange={value=>{setEndDate(value);setDetailPage(1);}}/>
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
                  setProjectId('');setSessionId('');setStartDate('');setEndDate('');
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
        <UsageOverview isActive={isActive} projects={projects} onDetails={selection=>{setProjectId(selection.projectId||'');setSessionId('');setStartDate(selection.date||'');setEndDate(selection.date||'');setDetailModelFilter(selection.model||'all');setDetailRoleFilter('all');setDetailSearchText('');setDetailPage(1);setView('tokenDetails');}}/>
      )}
    </div>
  );
});
