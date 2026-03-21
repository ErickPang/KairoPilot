import React, { useState, useEffect } from 'react';
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
    if (id === 'mainAgent') return 'Main Agent';
    const agent = agents.find(a => a.id === id);
    return agent ? agent.name : 'Unknown Agent';
  };

  const totalTokens = stats.reduce((acc, stat) => acc + stat.totalTokens, 0);
  const totalMessages = stats.reduce((acc, stat) => acc + stat.totalMessages, 0);
  const totalSessions = stats.reduce((acc, stat) => acc + stat.totalSessions, 0);

  return (
    <div className="dashboard-container" style={{ padding: '2.5rem', height: '100%', overflowY: 'auto', backgroundColor: 'var(--bg-color)', color: 'var(--foreground)' }}>
      <style>{`
        .stat-card {
          background: var(--sidebar-bg, #ffffff);
          padding: 1.5rem;
          border-radius: 16px;
          border: 1px solid var(--border, #e5e7eb);
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .stat-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
        }
        .stat-icon-wrapper {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          border-radius: 10px;
          margin-bottom: 0.5rem;
        }
        .dashboard-table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          text-align: left;
        }
        .dashboard-table th {
          background: rgba(0, 0, 0, 0.03);
          padding: 1rem 1.25rem;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-fg, #6b7280);
          font-weight: 600;
          border-bottom: 1px solid var(--border, #e5e7eb);
        }
        .dashboard-table td {
          padding: 1rem 1.25rem;
          border-bottom: 1px solid var(--border, #e5e7eb);
          vertical-align: middle;
        }
        .dashboard-table tbody tr {
          transition: background-color 0.15s ease;
        }
        .dashboard-table tbody tr:hover {
          background-color: rgba(0, 0, 0, 0.02);
        }
        .dashboard-table tbody tr:last-child td {
          border-bottom: none;
        }
        .progress-bar-bg {
          height: 6px;
          background: var(--border, #e5e7eb);
          border-radius: 4px;
          overflow: hidden;
          margin-top: 0.5rem;
          width: 100%;
        }
        .progress-bar-fill {
          height: 100%;
          border-radius: 4px;
          transition: width 0.5s ease;
        }
      `}</style>

      <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem', fontSize: '1.75rem', fontWeight: 600 }}>
        <IconDashboard size={32} /> Monitoring Dashboard
      </h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem', marginBottom: '3rem' }}>
        <div className="stat-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ color: 'var(--muted-fg)', fontWeight: 500 }}>Total Tokens Used</div>
            <div className="stat-icon-wrapper" style={{ background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6' }}>
              <IconCpu size={20} />
            </div>
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, letterSpacing: '-0.025em' }}>
            {totalTokens.toLocaleString()}
          </div>
        </div>

        <div className="stat-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ color: 'var(--muted-fg)', fontWeight: 500 }}>Total Messages</div>
            <div className="stat-icon-wrapper" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>
              <IconChat size={20} />
            </div>
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, letterSpacing: '-0.025em' }}>
            {totalMessages.toLocaleString()}
          </div>
        </div>

        <div className="stat-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ color: 'var(--muted-fg)', fontWeight: 500 }}>Total Sessions</div>
            <div className="stat-icon-wrapper" style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b' }}>
              <IconBot size={20} />
            </div>
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, letterSpacing: '-0.025em' }}>
            {totalSessions.toLocaleString()}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: '3rem' }}>
        <h3 style={{ marginBottom: '1rem', fontSize: '1.25rem', fontWeight: 600 }}>Agent Activity Breakdown</h3>
        <div style={{ background: 'var(--sidebar-bg)', borderRadius: '16px', border: '1px solid var(--border)', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>Agent Name</th>
                <th>Sessions</th>
                <th>Messages</th>
                <th>Prompt Tokens</th>
                <th>Completion Tokens</th>
                <th>Total Tokens</th>
              </tr>
            </thead>
            <tbody>
              {stats.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted-fg)' }}>
                    No agent activity data available yet.
                  </td>
                </tr>
              ) : (
                stats.map(stat => (
                  <tr key={stat.agentId}>
                    <td style={{ fontWeight: 500 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ background: 'var(--border)', padding: '0.4rem', borderRadius: '8px', display: 'flex' }}>
                          <IconBot size={16} />
                        </div>
                        {getAgentName(stat.agentId)}
                      </div>
                    </td>
                    <td>{stat.totalSessions}</td>
                    <td>{stat.totalMessages}</td>
                    <td style={{ color: 'var(--muted-fg)' }}>{stat.promptTokens.toLocaleString()}</td>
                    <td style={{ color: 'var(--muted-fg)' }}>{stat.completionTokens.toLocaleString()}</td>
                    <td style={{ fontWeight: 600, color: '#8b5cf6' }}>{stat.totalTokens.toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      {systemStats && (
        <div>
           <h3 style={{ marginBottom: '1rem', fontSize: '1.25rem', fontWeight: 600 }}>System Resources</h3>
           <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' }}>
              <div className="stat-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                  <div style={{ color: 'var(--muted-fg)', fontSize: '0.875rem', fontWeight: 500 }}>CPU Usage</div>
                  <div style={{ fontSize: '1.125rem', fontWeight: 600 }}>{systemStats.cpuUsage}%</div>
                </div>
                <div className="progress-bar-bg">
                  <div className="progress-bar-fill" style={{ width: `${Math.min(systemStats.cpuUsage, 100)}%`, background: systemStats.cpuUsage > 80 ? '#ef4444' : '#3b82f6' }}></div>
                </div>
              </div>

              <div className="stat-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                  <div style={{ color: 'var(--muted-fg)', fontSize: '0.875rem', fontWeight: 500 }}>Memory Usage</div>
                  <div style={{ fontSize: '1.125rem', fontWeight: 600 }}>{systemStats.memoryUsage}%</div>
                </div>
                <div className="progress-bar-bg">
                  <div className="progress-bar-fill" style={{ width: `${Math.min(systemStats.memoryUsage, 100)}%`, background: systemStats.memoryUsage > 80 ? '#ef4444' : '#10b981' }}></div>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted-fg)', marginTop: '0.5rem', textAlign: 'right' }}>
                  {systemStats.totalMemory} GB Total
                </div>
              </div>

              <div className="stat-card">
                <div style={{ color: 'var(--muted-fg)', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>System Uptime</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{systemStats.uptime} <span style={{ fontSize: '1rem', color: 'var(--muted-fg)', fontWeight: 400 }}>hrs</span></div>
              </div>
           </div>
        </div>
      )}
    </div>
  );
}
