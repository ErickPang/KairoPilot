import { useState, useEffect } from 'react';
import { AuditLogEntry } from '../types';
import { IconRefresh, IconShield, IconTool, IconCheck, IconX } from './Icons';
import { useTranslation } from '../hooks/useTranslation';

interface AuditLogViewerProps {
  onClose?: () => void;
}

export default function AuditLogViewer({ onClose }: AuditLogViewerProps) {
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
      setLogs(data);
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
            <div style={{ 
              width: '40px', height: '40px', borderRadius: '12px', 
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', 
              display: 'flex', alignItems: 'center', justifyContent: 'center', 
              color: '#ffffff', boxShadow: '0 4px 12px rgba(16, 185, 129, 0.2)'
            }}>
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
          <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--muted-fg)' }}>
            <IconRefresh size={32} className="spinning" style={{ opacity: 0.5, marginBottom: '1rem', display: 'inline-block' }} />
            <div style={{ fontSize: '1.1rem' }}>{t('common.loading')}</div>
          </div>
        ) : logs.length === 0 ? (
          <div style={{ padding: '5rem', textAlign: 'center', color: 'var(--muted-fg)' }}>
            <div style={{ opacity: 0.8, marginBottom: '1.5rem', display: 'flex', justifyContent: 'center' }}>
              <div style={{ 
                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(16, 185, 129, 0.2) 100%)', 
                padding: '2rem', 
                borderRadius: '50%', 
                color: 'var(--primary)',
                boxShadow: 'inset 0 2px 4px rgba(255,255,255,0.8), 0 4px 12px rgba(16, 185, 129, 0.1)'
              }}>
                <IconShield size={56} />
              </div>
            </div>
            <div style={{ fontWeight: 600, color: 'var(--foreground)', fontSize: '1.25rem' }}>{t('audit.noLogs')}</div>
          </div>
        ) : (
          <div className="config-section" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {logs.map((log) => (
              <div key={log.id} className="config-card" style={{ 
                flexDirection: 'column', 
                alignItems: 'stretch',
                gap: '1rem',
                margin: 0,
                background: log.error ? 'linear-gradient(135deg, rgba(254,242,242,0.6) 0%, rgba(254,242,242,0.9) 100%)' : undefined,
                borderColor: log.error ? 'rgba(239, 68, 68, 0.2)' : undefined
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ 
                      width: '36px', height: '36px', borderRadius: '8px', 
                      background: log.error ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)', 
                      display: 'flex', alignItems: 'center', justifyContent: 'center', 
                      color: log.error ? 'var(--destructive)' : 'var(--primary)' 
                    }}>
                      <IconTool size={18} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '1.05rem', color: 'var(--foreground)' }}>{log.tool}</div>
                      <div style={{ color: 'var(--muted-fg)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                        {new Date(log.timestamp).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div>
                    {log.error ? (
                      <span className="badge" style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--destructive)', padding: '0.4rem 0.75rem' }}>
                        <IconX size={14} style={{ marginRight: '4px', verticalAlign: 'text-bottom' }} />
                        {t('common.error')}
                      </span>
                    ) : (
                      <span className="badge" style={{ background: 'rgba(16, 185, 129, 0.1)', color: 'var(--success)', padding: '0.4rem 0.75rem' }}>
                        <IconCheck size={14} style={{ marginRight: '4px', verticalAlign: 'text-bottom' }} />
                        {t('common.success')}
                      </span>
                    )}
                  </div>
                </div>
                
                <div style={{ 
                  background: log.error ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.02)',
                  borderRadius: '8px',
                  border: '1px solid',
                  borderColor: log.error ? 'rgba(239, 68, 68, 0.15)' : 'rgba(0, 0, 0, 0.05)',
                  padding: '1rem',
                }}>
                  <div style={{ 
                    fontSize: '0.75rem', 
                    fontWeight: 600, 
                    textTransform: 'uppercase', 
                    letterSpacing: '0.05em', 
                    color: 'var(--muted-fg)',
                    marginBottom: '0.5rem'
                  }}>
                    {t('audit.arguments')}
                  </div>
                  <div style={{ 
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    fontSize: '0.85rem',
                    color: 'var(--foreground)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: '200px',
                    overflowY: 'auto'
                  }}>
                    {typeof log.args === 'string' ? log.args : JSON.stringify(log.args, null, 2)}
                  </div>
                  
                  {log.error && (
                    <div style={{ 
                      marginTop: '1rem', 
                      paddingTop: '1rem', 
                      borderTop: '1px dashed rgba(239, 68, 68, 0.3)',
                      color: 'var(--destructive)'
                    }}>
                      <div style={{ 
                        fontSize: '0.75rem', 
                        fontWeight: 600, 
                        textTransform: 'uppercase', 
                        letterSpacing: '0.05em',
                        marginBottom: '0.5rem'
                      }}>
                        {t('audit.errorDetails')}
                      </div>
                      <div style={{ fontSize: '0.9rem', whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>
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
