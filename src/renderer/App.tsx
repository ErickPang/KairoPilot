import './App.css'
import { ConfigPanel } from './components/ConfigPanel';
import { Sidebar } from './components/Sidebar';
import { SettingsSidebar } from './components/SettingsSidebar';
import { ChatInterface } from './components/ChatInterface';
import { ConfirmationModal } from './components/ConfirmationModal';
import AuditLogViewer from './components/AuditLogViewer';
import { PluginStorePanel } from './components/PluginStorePanel';
import { SkillStorePanel } from './components/SkillStorePanel';
import { Dashboard } from './components/Dashboard';
import { IconChat, IconShield, IconSettings, IconPlugin, IconDashboard, IconSkill } from './components/Icons';
import { useAppController } from './hooks/useAppController';
import { useTranslation } from './hooks/useTranslation';

function App() {
  const { t } = useTranslation();
  const {
    activeAgentName,
    activeConfigSection,
    activeTab,
    agents,
    availableModels,
    confirmationRequest,
    describeProvider,
    fetchModels,
    handleCancelRun,
    handleClear,
    handleConfirm,
    handleCreateSession,
    handleDeleteAgent,
    handleDeleteModel,
    handleDeleteSession,
    handleDeny,
    handlePauseRun,
    handleResumeRun,
    handleRetryStep,
    handleSaveAgent,
    handleSaveModel,
    handleSelectSession,
    handleSend,
    handleSetActiveAgent,
    handleUpdateSessionTitle,
    input,
    loading,
    messages,
    messagesEndRef,
    models,
    sessionContext,
    sessions,
    setActiveConfigSection,
    setActiveTab,
    setInput,
    systemStats
  } = useAppController();

  const activeAgentId = sessionContext.activeAgentId;
  const activeSessionId = sessionContext.activeSessionId;

  return (
    <div className="app-container">
      <div className="window-drag-strip" aria-hidden="true" />
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
          <IconSkill size={24} /> 
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
          activeModelId={agents.find((agent) => agent.id === activeAgentId)?.model || null}
          activeAgentName={activeAgentName}
          onModelChange={(model: string) => {
            const activeAgent = agents.find((agent) => agent.id === activeAgentId);
            if (activeAgent) {
              handleSaveAgent({ ...activeAgent, model });
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
            onDescribeProvider={describeProvider}
            onFetchModels={fetchModels}
            availableModels={availableModels}
            activeSection={activeConfigSection}
          />
        </div>
      )}

      {activeTab === 'audit' && (
        <div className="main-content" style={{ padding: 0, height: '100%', overflow: 'hidden' }}>
          <AuditLogViewer
            latestRun={sessionContext.latestRun}
            activeRunSteps={sessionContext.activeRunSteps}
            handleCancelRun={handleCancelRun}
            handlePauseRun={handlePauseRun}
            handleResumeRun={handleResumeRun}
            handleRetryStep={handleRetryStep}
          />
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
