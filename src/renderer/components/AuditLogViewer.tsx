import { useState, useEffect } from 'react';
import { AuditLogEntry } from '../types';
import { IconRefresh } from './Icons';

interface AuditLogViewerProps {
  onClose: () => void;
}

export default function AuditLogViewer({ onClose }: AuditLogViewerProps) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLogs();
  }, []);

  const loadLogs = async () => {
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="audit-content" style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>Loading...</div>
        ) : logs.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#666' }}>No audit logs found.</div>
        ) : (
          <table className="audit-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Tool</th>
                <th>Arguments</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className={log.error ? 'error-row' : ''}>
                  <td>{new Date(log.timestamp).toLocaleString()}</td>
                  <td>{log.tool}</td>
                  <td>
                    <pre title={JSON.stringify(log.args, null, 2)} style={{ margin: 0, fontSize: '0.85em', background: 'transparent', border: 'none', padding: 0 }}>
                      {JSON.stringify(log.args).substring(0, 50)}
                      {JSON.stringify(log.args).length > 50 ? '...' : ''}
                    </pre>
                  </td>
                  <td>
                    {log.error ? (
                      <span className="status-error" title={log.error}>Error</span>
                    ) : (
                      <span className="status-success">Success</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      
      <div className="modal-actions">
        <button 
          className="secondary" 
          onClick={loadLogs}
          title="Refresh Logs"
        >
          <IconRefresh size={16} /> Refresh
        </button>
        <button className="primary" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
