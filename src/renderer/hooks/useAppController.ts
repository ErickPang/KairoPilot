import { useState } from 'react';
import { useTranslation } from './useTranslation';
import { useSessionContextState } from './useSessionContextState';
import { useSystemStats } from './useSystemStats';
import { useChatController } from './useChatController';
import { useConfigController } from './useConfigController';
import { useSessionData } from './useSessionData';

export function useAppController() {
  const [activeTab, setActiveTab] = useState<'chat' | 'plugins' | 'skills' | 'settings' | 'audit' | 'dashboard'>('chat');
  const [activeConfigSection, setActiveConfigSection] = useState<string>('general');
  const { t } = useTranslation();
  const { sessionContext, updateSessionContext } = useSessionContextState();
  const { loadActiveSession, loadRunState, loadSessions, messages, messagesEndRef, sessions, setMessages, setSessions } = useSessionData(updateSessionContext);
  const {
    activeAgentName,
    agents,
    availableModels,
    describeProvider,
    fetchModels,
    handleDeleteAgent,
    handleDeleteModel,
    handleSaveAgent,
    handleSaveModel,
    handleSetActiveAgent: handleSetActiveAgentBase,
    models
  } = useConfigController({
    sessionContext,
    t,
    updateSessionContext,
    loadActiveSession,
    loadSessions
  });
  const systemStats = useSystemStats();
  const [agentLoading, setAgentLoading] = useState(false);
  const {
    handleCancelRun,
    handleClear,
    handleConfirm,
    handleCreateSession,
    handleDeleteSession,
    handleDeny,
    handlePauseRun,
    handleResumeRun,
    handleRetryStep,
    handleSelectSession,
    handleSend,
    handleUpdateSessionTitle,
    input,
    loading: chatLoading,
    setInput
  } = useChatController({
    agentCount: agents.length,
    loadActiveSession,
    loadRunState,
    loadSessions,
    messages,
    messagesEndRef,
    sessionContext,
    setMessages,
    setSessions,
    t,
    updateSessionContext
  });

  const handleSetActiveAgent = async (id: string) => {
    try {
      setAgentLoading(true);
      await handleSetActiveAgentBase(id);
    } finally {
      setAgentLoading(false);
    }
  };

  return {
    activeAgentName,
    activeConfigSection,
    activeTab,
    agents,
    availableModels,
    confirmationRequest: sessionContext.confirmationRequest,
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
    loading: chatLoading || agentLoading,
    messages,
    messagesEndRef,
    models,
    sessionContext,
    sessions,
    setActiveConfigSection,
    setActiveTab,
    setInput,
    systemStats
  };
}
