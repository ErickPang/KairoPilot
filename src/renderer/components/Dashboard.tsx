import { useState, useEffect } from 'react';
import { AgentConfig, SystemStats } from '../types';
import { IconDashboard, IconBot, IconChat, IconCpu } from './Icons';
import { useTranslation } from '../hooks/useTranslation';

interface AgentStats {
  agentId: string;
  totalSessions: number;
  totalMessages: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface DashboardProps {
  agents: AgentConfig[];
  systemStats: SystemStats | null;
}

export function Dashboard({ agents, systemStats }: DashboardProps) {
  const [stats, setStats] = useState<AgentStats[]>([]);
  const { t } = useTranslation();

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const data = await window.ipcRenderer.invoke('chat:getAgentStats');
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
        .dashboard-table-container {
          background: rgba(255, 255, 255, 0.85);
          border-radius: 20px;
          border: 1px solid rgba(255, 255, 255, 0.8);
          overflow: hidden;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), inset 0 1px 0 rgba(255, 255, 255, 1);
        }
        .dashboard-table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          text-align: left;
        }
        .dashboard-table th {
          background: rgba(255, 255, 255, 0.4);
          padding: 1rem 1.25rem;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-fg, #6b7280);
          font-weight: 600;
          border-bottom: 1px solid rgba(226, 232, 240, 0.5);
        }
        .dashboard-table td {
          padding: 1rem 1.25rem;
          border-bottom: 1px solid rgba(226, 232, 240, 0.5);
          vertical-align: middle;
        }
        .dashboard-table tbody tr {
          transition: background-color 0.2s ease;
        }
        .dashboard-table tbody tr:hover {
          background-color: rgba(255, 255, 255, 0.5);
        }
        .dashboard-table tbody tr:last-child td {
          border-bottom: none;
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
      `}</style>

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
      </div>

      <div className="animate-stagger-3" style={{ marginBottom: '3rem' }}>
        <h3 style={{ marginBottom: '1rem', fontSize: '1.25rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {t('dashboard.agentActivity')}
        </h3>
        <div className="dashboard-table-container">
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>{t('dashboard.agentName')}</th>
                <th>{t('dashboard.sessions')}</th>
                <th>{t('dashboard.messages')}</th>
                <th>{t('dashboard.promptTokens')}</th>
                <th>{t('dashboard.completionTokens')}</th>
                <th>{t('dashboard.totalTokens')}</th>
              </tr>
            </thead>
            <tbody>
              {stats.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '4rem', textAlign: 'center', color: 'var(--muted-fg)', fontSize: '1.1rem' }}>
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
                    <td style={{ fontWeight: 500 }}>{stat.totalMessages}</td>
                    <td style={{ color: 'var(--muted-fg)' }}>{stat.promptTokens.toLocaleString()}</td>
                    <td style={{ color: 'var(--muted-fg)' }}>{stat.completionTokens.toLocaleString()}</td>
                    <td style={{ fontWeight: 700, color: '#8b5cf6' }}>{stat.totalTokens.toLocaleString()}</td>
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
    </div>
  );
}
