import { useState, useEffect } from 'react';
import { AuditLogEntry } from '../types';
import { IconRefresh, IconShield, IconTool, IconCheck, IconX } from './Icons';
import { useTranslation } from '../hooks/useTranslation';
import './AuditLogViewer.css';

export default function AuditLogViewer() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const data = await window.ipcRenderer.invoke('audit:get', 100);
      setLogs(data as AuditLogEntry[]);
    } catch (error) {
      console.error('Failed to load audit logs:', error);
    } finally {
      setLoading(false);
    }
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
        ) : logs.length === 0 ? (
          <div className="audit-viewer-empty">
            <div className="audit-viewer-empty-icon">
              <IconShield size={56} />
            </div>
            <div className="audit-viewer-empty-text">{t('audit.noLogs')}</div>
          </div>
        ) : (
          <div className="config-section audit-log-list">
            {logs.map((log) => (
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
      </div>
    </div>
  );
}
