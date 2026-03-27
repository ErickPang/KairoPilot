import { useState, useEffect, useMemo } from 'react';
import { AuditLogEntry, AuditLogQueryResult } from '../types';
import { IconRefresh, IconShield, IconTool, IconCheck, IconX } from './Icons';
import { Select } from './Select';
import { useTranslation } from '../hooks/useTranslation';
import './AuditLogViewer.css';
import { KAIRO_INVOKE } from '../../shared/ipc';

const AUDIT_PAGE_SIZE = 20;

export default function AuditLogViewer() {
  const [result, setResult] = useState<AuditLogQueryResult>({
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
  });
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error'>('all');
  const [toolFilter, setToolFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [page, setPage] = useState(1);
  const { t } = useTranslation();
  const logs = result.items;

  useEffect(() => {
    const timeoutId = window.setTimeout(async () => {
      setLoading(true);
      try {
        const data = await window.kairo.invoke(KAIRO_INVOKE.auditGet, {
          page,
          pageSize: AUDIT_PAGE_SIZE,
          search: searchText.trim() || undefined,
          status: statusFilter,
          tool: toolFilter !== 'all' ? toolFilter : undefined,
          tag: tagFilter !== 'all' ? tagFilter : undefined
        });
        setResult(data);
      } catch (error) {
        console.error('Failed to load audit logs:', error);
      } finally {
        setLoading(false);
      }
    }, searchText.trim() ? 250 : 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [page, searchText, statusFilter, tagFilter, toolFilter]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const data = await window.kairo.invoke(KAIRO_INVOKE.auditGet, {
        page,
        pageSize: AUDIT_PAGE_SIZE,
        search: searchText.trim() || undefined,
        status: statusFilter,
        tool: toolFilter !== 'all' ? toolFilter : undefined,
        tag: tagFilter !== 'all' ? tagFilter : undefined
      });
      setResult(data);
    } catch (error) {
      console.error('Failed to load audit logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const toolOptions = useMemo(() => {
    return result.aggregations.tools;
  }, [result.aggregations.tools]);

  const tagOptions = useMemo(() => {
    return result.aggregations.tags;
  }, [result.aggregations.tags]);

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
  }, [toolOptions, t]);

  const tagSelectOptions = useMemo(() => {
    return [
      { value: 'all', label: t('audit.tagAll') },
      ...tagOptions.map((tag) => ({ value: tag.value, label: `${tag.value} (${tag.count})` }))
    ];
  }, [tagOptions, t]);

  const handleClearFilters = () => {
    setSearchText('');
    setStatusFilter('all');
    setToolFilter('all');
    setTagFilter('all');
    setPage(1);
  };

  return (
    <div className="config-panel">
      <div className="config-header animate-stagger-1">
        <div>
          <h2 className="config-title">
            <div className="audit-viewer-icon-header">
              <IconShield size={24} />
            </div>
            {t('nav.auditLogs')}
          </h2>
          <p className="config-subtitle">
            {t('audit.subtitle')}
          </p>
        </div>
        <button onClick={loadLogs} className="btn btn-secondary" disabled={loading}>
          <IconRefresh size={16} className={loading ? 'spinning' : ''} />
          {t('audit.refreshLogs')}
        </button>
      </div>

      <div className="config-content animate-stagger-2">
        {loading ? (
          <div className="audit-viewer-loading">
            <IconRefresh size={32} className="spinning" style={{ opacity: 0.5, marginBottom: '1rem', display: 'inline-block' }} />
            <div style={{ fontSize: '1.1rem' }}>{t('common.loading')}</div>
          </div>
        ) : result.total === 0 ? (
          <div className="audit-viewer-empty">
            <div className="audit-viewer-empty-icon">
              <IconShield size={56} />
            </div>
            <div className="audit-viewer-empty-text">{t('audit.noLogs')}</div>
          </div>
        ) : (
          <>
            <div className="config-section audit-filter-panel">
              <div className="audit-filter-group">
                <input
                  className="form-control"
                  value={searchText}
                  onChange={(e) => {
                    setSearchText(e.target.value);
                    setPage(1);
                  }}
                  placeholder={t('audit.searchPlaceholder')}
                />
              </div>
              <div className="audit-filter-group">
                <Select
                  value={statusFilter}
                  onChange={(val) => {
                    setStatusFilter(val as 'all' | 'success' | 'error');
                    setPage(1);
                  }}
                  options={statusSelectOptions}
                  style={{ width: '100%' }}
                />
              </div>
              <div className="audit-filter-group">
                <Select
                  value={toolFilter}
                  onChange={(value) => {
                    setToolFilter(value);
                    setPage(1);
                  }}
                  options={toolSelectOptions}
                  style={{ width: '100%' }}
                />
              </div>
              <div className="audit-filter-group">
                <Select
                  value={tagFilter}
                  onChange={(value) => {
                    setTagFilter(value);
                    setPage(1);
                  }}
                  options={tagSelectOptions}
                  style={{ width: '100%' }}
                />
              </div>
              <button className="btn btn-secondary" onClick={handleClearFilters}>
                {t('audit.clearFilters')}
              </button>
            </div>

            <div className="audit-summary-grid">
              <div className="config-card audit-summary-card">
                <div className="audit-summary-label">{t('audit.totalLogs')}</div>
                <div className="audit-summary-value">{result.total.toLocaleString()}</div>
              </div>
              <div className="config-card audit-summary-card">
                <div className="audit-summary-label">{t('audit.statusSuccess')}</div>
                <div className="audit-summary-value">{result.aggregations.successCount.toLocaleString()}</div>
              </div>
              <div className="config-card audit-summary-card">
                <div className="audit-summary-label">{t('audit.statusError')}</div>
                <div className="audit-summary-value">{result.aggregations.errorCount.toLocaleString()}</div>
              </div>
            </div>

            <div className="audit-filter-summary">
              {t('audit.filteredCount', { shown: logs.length, total: result.total })}
            </div>

            {logs.length === 0 ? (
              <div className="audit-viewer-empty">
                <div className="audit-viewer-empty-icon">
                  <IconShield size={56} />
                </div>
                <div className="audit-viewer-empty-text">{t('audit.noFilteredLogs')}</div>
              </div>
            ) : (
              <div className="config-section audit-log-list">
                {logs.map((log: AuditLogEntry) => (
              <div key={log.id} className={`config-card audit-log-card ${log.error ? 'is-error' : ''}`}>
                <div className="audit-log-header">
                  <div className="audit-log-tool-info">
                    <div className={`audit-log-icon ${log.error ? 'is-error' : 'is-success'}`}>
                      <IconTool size={18} />
                    </div>
                    <div>
                      <div className="audit-log-tool-name">{log.tool}</div>
                      <div className="audit-log-timestamp">
                        {new Date(log.timestamp).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div>
                    {log.error ? (
                      <span className="badge audit-log-badge is-error">
                        <IconX size={14} style={{ marginRight: '4px', verticalAlign: 'text-bottom' }} />
                        {t('common.error')}
                      </span>
                    ) : (
                      <span className="badge audit-log-badge is-success">
                        <IconCheck size={14} style={{ marginRight: '4px', verticalAlign: 'text-bottom' }} />
                        {t('common.success')}
                      </span>
                    )}
                  </div>
                </div>
                
                <div className={`audit-log-details ${log.error ? 'is-error' : 'is-success'}`}>
                  <div className="audit-log-section-title">
                    {t('audit.arguments')}
                  </div>
                  <div className="audit-log-args">
                    {typeof log.args === 'string' ? log.args : JSON.stringify(log.args, null, 2)}
                  </div>

                  {!!log.policyTags?.length && (
                    <div className="audit-log-tags-container">
                      <div className="audit-log-section-title">
                        {t('audit.policyTags')}
                      </div>
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
                      <div className="audit-log-error-title">
                        {t('audit.errorDetails')}
                      </div>
                      <div className="audit-log-error-text">
                        {log.error}
                      </div>
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
                  className="btn btn-secondary"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={loading || result.page <= 1}
                >
                  {t('common.previous')}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => setPage((current) => Math.min(result.totalPages, current + 1))}
                  disabled={loading || result.page >= result.totalPages}
                >
                  {t('common.next')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
