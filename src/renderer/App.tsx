import { useState, useEffect, useRef } from 'react'
import './App.css'
import { ModelConfig, AgentConfig, Message, Session, SystemStats } from './types';
import { ConfigPanel } from './components/ConfigPanel';
import { Sidebar } from './components/Sidebar';
import { SettingsSidebar } from './components/SettingsSidebar';
import { ChatInterface } from './components/ChatInterface';
import { ConfirmationModal } from './components/ConfirmationModal';
import AuditLogViewer from './components/AuditLogViewer';
import { PluginStorePanel } from './components/PluginStorePanel';
import { SkillStorePanel } from './components/SkillStorePanel';
import { Dashboard } from './components/Dashboard';
import { IconChat, IconShield, IconSettings, IconPlugin, IconDashboard } from './components/Icons';
import { useTranslation } from './hooks/useTranslation';

interface AgentUpdate {
  type: string;
  message?: string;
  plugin?: string;
  params?: Record<string, unknown>;
  logs?: string;
  content?: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

function App() {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [confirmationRequest, setConfirmationRequest] = useState<{ id: string; tool: string; args: Record<string, unknown> } | null>(null);
  const [activeTab, setActiveTab] = useState<'chat' | 'plugins' | 'skills' | 'settings' | 'audit' | 'dashboard'>('chat');
  const [activeConfigSection, setActiveConfigSection] = useState<string>('general');

  const { t } = useTranslation();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchModels = async (config: ModelConfig) => {
    try {
      const modelList = await window.ipcRenderer.invoke('llm:listModels', config) as string[];
      if (modelList && modelList.length > 0) {
        setAvailableModels(modelList);
      }
    } catch (error) {
      console.error('Failed to fetch models:', error);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Poll system stats
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const stats = await window.ipcRenderer.invoke('system:stats') as SystemStats | null;
        setSystemStats(stats);
      } catch (error) {
        // console.error('Failed to fetch system stats:', error);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const loadSessions = async () => {
    try {
      const allSessions = await window.ipcRenderer.invoke('chat:getSessions') as Session[];
      setSessions(allSessions);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  };

  const loadActiveSession = async () => {
    try {
      const session = await window.ipcRenderer.invoke('chat:getActiveSession') as Session | null;
      if (session) {
        setMessages(session.messages);
        setActiveSessionId(session.id);
      } else {
        setMessages([]);
        setActiveSessionId(null);
      }
    } catch (error) {
      console.error('Failed to load active session:', error);
    }
  };

  const handleCreateSession = async () => {
    try {
      const newSession = await window.ipcRenderer.invoke('chat:createSession') as Session;
      setSessions(prev => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
      setMessages([]);
      await window.ipcRenderer.invoke('chat:setActiveSession', newSession.id);
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  };

  const handleSelectSession = async (sessionId: string) => {
    try {
      await window.ipcRenderer.invoke('chat:setActiveSession', sessionId);
      setActiveSessionId(sessionId);
      
      const active = await window.ipcRenderer.invoke('chat:getActiveSession') as Session | null;
      if (active) {
        setMessages(active.messages);
      } else {
        setMessages([]);
      }
      
      await loadSessions();
    } catch (error) {
      console.error('Failed to switch session:', error);
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (!confirm(t('app.deleteChatConfirm'))) return;
    
    try {
      await window.ipcRenderer.invoke('chat:deleteSession', sessionId);
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
        setMessages([]);
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  const handleUpdateSessionTitle = async (sessionId: string, title: string) => {
    try {
      await window.ipcRenderer.invoke('chat:updateSessionTitle', { sessionId, title });
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title } : s));
    } catch (error) {
      console.error('Failed to update session title:', error);
    }
  };

  // Load saved config on mount
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const fullConfig = await window.ipcRenderer.invoke('config:get-all') as { models: ModelConfig[], agents: AgentConfig[], activeAgentId?: string };
        if (fullConfig) {
          setModels(fullConfig.models || []);
          setAgents(fullConfig.agents || []);
          setActiveAgentId(fullConfig.activeAgentId || null);

          // Auto-init active agent if exists
          if (fullConfig.activeAgentId) {
             try {
               const result = await window.ipcRenderer.invoke('agent:init', fullConfig.activeAgentId) as { success: boolean, error?: string };
               if (result.success) {
                 await loadSessions();
                 await loadActiveSession();
               }
             } catch (e) {
               console.error("Auto-init failed:", e);
             }
          }
        }
      } catch (error) {
        console.error('Failed to load config:', error);
      }
    };
    loadConfig();
  }, []);

  // Listen for agent updates
  useEffect(() => {
    const removeListener = window.ipcRenderer.on('agent:update', (_event: unknown, ...args: unknown[]) => {
      const update = args[0] as AgentUpdate;
      if (update.type === 'thinking') {
        setMessages(prev => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.role === 'thinking') {
            return [...prev.slice(0, -1), { role: 'thinking', content: update.content || '' }];
          }
          return [...prev, { role: 'thinking', content: update.content || '' }];
        });
      } else if (update.type === 'tool-call') {
        setMessages(prev => [...prev, { 
          role: 'tool', 
          content: t('app.toolCall', { tool: update.tool || 'unknown' }),
          details: update.args 
        }]);
      } else if (update.type === 'tool-result') {
        setMessages(prev => [...prev, { 
          role: 'tool', 
          content: t('app.toolResult', { tool: update.tool || 'unknown' }),
          details: (update.result as Record<string, unknown>) || {}
        }]);
      } else if (update.type === 'tool-error') {
        setMessages(prev => [...prev, { 
          role: 'tool', 
          content: t('app.toolError', { tool: update.tool || 'unknown' }),
          details: { error: update.error } 
        }]);
      }
    });

    return () => {
      removeListener();
    };
  }, [t]);

  // Listen for confirmation requests
  useEffect(() => {
    const removeListener = window.ipcRenderer.on('agent:ask-confirmation', (_event: unknown, ...args: unknown[]) => {
      const request = args[0] as { id: string; tool: string; args: Record<string, unknown> };
      setConfirmationRequest(request);
    });
    return () => removeListener();
  }, []);

  const handleConfirm = async () => {
    if (!confirmationRequest) return;
    await window.ipcRenderer.invoke('agent:confirm-response', { id: confirmationRequest.id, approved: true });
    setConfirmationRequest(null);
  };

  const handleDeny = async () => {
    if (!confirmationRequest) return;
    await window.ipcRenderer.invoke('agent:confirm-response', { id: confirmationRequest.id, approved: false });
    setConfirmationRequest(null);
  };

  const handleClear = async () => {
    try {
      await window.ipcRenderer.invoke('chat:clearAllSessions');
      setMessages([]);
      await loadSessions();
      setActiveSessionId(null);
    } catch (error) {
      console.error('Failed to clear history:', error);
    }
  };

  const handleSend = async () => {
    if (!input.trim()) return;
    
    // Check if agent is initialized/selected
    if (!activeAgentId && agents.length > 0) {
      // Auto-select first agent? Or warn user?
      // For now, warn user
      setMessages(prev => [...prev, { role: 'assistant', content: t('app.selectAgentWarn') }]);
      return;
    } else if (agents.length === 0) {
       setMessages(prev => [...prev, { role: 'assistant', content: t('app.configureAgentWarn') }]);
       return;
    }

    // Ensure active session exists
    if (!activeSessionId) {
      const newSession = await window.ipcRenderer.invoke('chat:createSession', input.substring(0, 30)) as Session;
      setSessions(prev => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
      await window.ipcRenderer.invoke('chat:setActiveSession', newSession.id);
    }

    const userMsg: Message = { role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const result = await window.ipcRenderer.invoke('agent:chat', input) as { error?: string, content: string };
      
      if (result.error) {
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${result.error}` }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: result.content }]);
      }
      
      await loadSessions();
    } catch (error) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${(error as Error).message}` }]);
    } finally {
      setLoading(false);
    }
  };

  // --- Config Handlers ---

  const handleSaveModel = async (model: ModelConfig) => {
    try {
      await window.ipcRenderer.invoke('config:save-model', model);
      // Refresh
      const fullConfig = await window.ipcRenderer.invoke('config:get-all') as { models: ModelConfig[], agents: AgentConfig[], activeAgentId?: string };
      setModels(fullConfig.models);
    } catch (error) {
      console.error('Failed to save model:', error);
    }
  };

  const handleDeleteModel = async (id: string) => {
    if (!confirm(t('app.deleteModelConfirm'))) return;
    try {
      await window.ipcRenderer.invoke('config:delete-model', id);
      const fullConfig = await window.ipcRenderer.invoke('config:get-all') as { models: ModelConfig[], agents: AgentConfig[], activeAgentId?: string };
      setModels(fullConfig.models);
    } catch (error) {
      console.error('Failed to delete model:', error);
    }
  };

  const handleSaveAgent = async (agent: AgentConfig) => {
    try {
      await window.ipcRenderer.invoke('config:save-agent', agent);
      const fullConfig = await window.ipcRenderer.invoke('config:get-all') as { models: ModelConfig[], agents: AgentConfig[], activeAgentId?: string };
      setAgents(fullConfig.agents);
      
      // If this is the active agent, re-init?
      if (activeAgentId === agent.id) {
        await window.ipcRenderer.invoke('agent:init', agent.id);
      }
    } catch (error) {
      console.error('Failed to save agent:', error);
    }
  };

  const handleDeleteAgent = async (id: string) => {
    if (!confirm(t('app.deleteAgentConfirm'))) return;
    try {
      await window.ipcRenderer.invoke('config:delete-agent', id);
      const fullConfig = await window.ipcRenderer.invoke('config:get-all') as { models: ModelConfig[], agents: AgentConfig[], activeAgentId?: string };
      setAgents(fullConfig.agents);
      if (activeAgentId === id) {
        setActiveAgentId(fullConfig.activeAgentId || null);
        if (fullConfig.activeAgentId) {
          await window.ipcRenderer.invoke('agent:init', fullConfig.activeAgentId);
        }
        await loadSessions();
        await loadActiveSession();
      }
    } catch (error) {
      console.error('Failed to delete agent:', error);
    }
  };

  const handleSetActiveAgent = async (id: string) => {
    try {
      await window.ipcRenderer.invoke('config:set-active-agent', id);
      setActiveAgentId(id);
      // Init agent
      setLoading(true);
      const result = await window.ipcRenderer.invoke('agent:init', id) as { success: boolean, error?: string };
      setLoading(false);
      
      if (result.success) {
        // Refresh sessions for the newly selected agent
        await loadSessions();
        await loadActiveSession();
      } else {
        alert(t('app.initAgentFailed', { error: result.error || 'Unknown' }));
      }
    } catch (error) {
      console.error('Failed to set active agent:', error);
      setLoading(false);
    }
  };

  return (
    <div className="app-container">
      <div className="nav-rail">
        <div 
          className={`nav-icon ${activeTab === 'chat' ? 'active' : ''}`}
          onClick={() => setActiveTab('chat')}
          title={t('nav.chat')}
        >
          <IconChat size={24} />
        </div>

        <div 
          className={`nav-icon ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
          title={t('nav.dashboard')}
        >
          <IconDashboard size={24} />
        </div>

        <div 
          className={`nav-icon ${activeTab === 'plugins' ? 'active' : ''}`}
          onClick={() => setActiveTab('plugins')}
          title={t('nav.plugins')}
        >
          <IconPlugin size={24} />
        </div>

        <div 
          className={`nav-icon ${activeTab === 'skills' ? 'active' : ''}`}
          onClick={() => setActiveTab('skills')}
          title={t('nav.skills')}
        >
          {/* We'll use a generic icon for skills for now, like a star or magic wand. Using IconPlugin temporarily or you can add IconSkill */}
          <IconPlugin size={24} /> 
        </div>
        
        <div className="nav-spacer" />
        
        <div 
          className={`nav-icon ${activeTab === 'audit' ? 'active' : ''}`}
          onClick={() => setActiveTab('audit')}
          title={t('nav.auditLogs')}
        >
          <IconShield size={24} />
        </div>
        
        <div 
          className={`nav-icon ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
          title={t('nav.settings')}
        >
          <IconSettings size={24} />
        </div>
      </div>

      {activeTab === 'chat' && (
        <Sidebar 
          sessions={sessions} 
          activeSessionId={activeSessionId} 
          handleCreateSession={handleCreateSession} 
          handleSelectSession={handleSelectSession} 
          handleDeleteSession={handleDeleteSession}
          handleUpdateSessionTitle={handleUpdateSessionTitle}
        />
      )}
      {activeTab === 'settings' && (
        <SettingsSidebar 
          activeSection={activeConfigSection} 
          onSelectSection={setActiveConfigSection} 
        />
      )}

      {activeTab === 'chat' && (
        <ChatInterface 
          messages={messages} 
          input={input} 
          setInput={setInput} 
          loading={loading} 
          handleSend={handleSend} 
          handleClear={handleClear} 
          systemStats={systemStats} 
          messagesEndRef={messagesEndRef}
          models={models}
          activeModelId={agents.find(a => a.id === activeAgentId)?.modelConfigId || null}
          onModelChange={(modelId: string) => {
            const activeAgent = agents.find(a => a.id === activeAgentId);
            if (activeAgent) {
              handleSaveAgent({ ...activeAgent, modelConfigId: modelId });
            }
          }}
        />
      )}

      {activeTab === 'dashboard' && (
        <div className="main-content" style={{ padding: 0, height: '100%', overflow: 'hidden' }}>
          <Dashboard agents={agents} systemStats={systemStats} />
        </div>
      )}

      {activeTab === 'plugins' && (
        <div className="main-content" style={{ padding: 0, height: '100%', overflow: 'hidden' }}>
          <PluginStorePanel />
        </div>
      )}

      {activeTab === 'skills' && (
        <div className="main-content" style={{ padding: 0, height: '100%', overflow: 'hidden' }}>
          <SkillStorePanel />
        </div>
      )}
      
      {activeTab === 'settings' && (
        <div className="main-content" style={{ padding: 0, height: '100%', overflow: 'hidden' }}>
          <ConfigPanel 
            models={models}
            agents={agents}
            activeAgentId={activeAgentId}
            onSaveModel={handleSaveModel}
            onDeleteModel={handleDeleteModel}
            onSaveAgent={handleSaveAgent}
            onDeleteAgent={handleDeleteAgent}
            onSetActiveAgent={handleSetActiveAgent}
            onFetchModels={fetchModels}
            availableModels={availableModels}
            activeSection={activeConfigSection}
          />
        </div>
      )}

      {activeTab === 'audit' && (
        <div className="main-content" style={{ padding: 0, height: '100%', overflow: 'hidden' }}>
          <AuditLogViewer />
        </div>
      )}
      
      {confirmationRequest && (
        <ConfirmationModal 
          request={confirmationRequest} 
          onConfirm={handleConfirm} 
          onDeny={handleDeny} 
        />
      )}
    </div>
  )
}

export default App
