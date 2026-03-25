import { useCallback, useMemo } from 'react';
import { AgentConfig, KairoPilotConfig, ModelConfig, SessionContextState } from '../types';
import { I18nContextValue } from '../components/layout/I18nContext';
import { canInitAgentFromConfig } from './configUtils';

interface UseAgentConfigOptions {
  agents: AgentConfig[];
  models: ModelConfig[];
  refreshConfig: () => Promise<KairoPilotConfig>;
  sessionContext: SessionContextState;
  t: I18nContextValue['t'];
  updateSessionContext: (patch: Partial<SessionContextState>) => void;
  loadActiveSession: () => Promise<void>;
  loadSessions: () => Promise<void>;
}

export function useAgentConfig(options: UseAgentConfigOptions) {
  const {
    agents,
    models,
    refreshConfig,
    sessionContext,
    t,
    updateSessionContext,
    loadActiveSession,
    loadSessions
  } = options;

  const handleSaveAgent = useCallback(async (agent: AgentConfig) => {
    try {
      await window.kairo.invoke('config:save-agent', agent);
      const fullConfig = await refreshConfig();
      if (sessionContext.activeAgentId === agent.id && canInitAgentFromConfig(fullConfig, agent.id)) {
        await window.kairo.invoke('agent:init', agent.id);
      }
    } catch (error) {
      console.error('Failed to save agent:', error);
    }
  }, [refreshConfig, sessionContext.activeAgentId]);

  const handleDeleteAgent = useCallback(async (id: string) => {
    if (!confirm(t('app.deleteAgentConfirm'))) {
      return;
    }

    try {
      await window.kairo.invoke('config:delete-agent', id);
      const fullConfig = await refreshConfig();
      if (sessionContext.activeAgentId === id) {
        updateSessionContext({
          activeAgentId: fullConfig.agents.activeAgentId || null
        });
        if (canInitAgentFromConfig(fullConfig, fullConfig.agents.activeAgentId)) {
          await window.kairo.invoke('agent:init', fullConfig.agents.activeAgentId);
        }
        await loadSessions();
        await loadActiveSession();
      }
    } catch (error) {
      console.error('Failed to delete agent:', error);
    }
  }, [loadActiveSession, loadSessions, refreshConfig, sessionContext.activeAgentId, t, updateSessionContext]);

  const handleSetActiveAgent = useCallback(async (id: string) => {
    try {
      await window.kairo.invoke('config:set-active-agent', id);
      updateSessionContext({
        activeAgentId: id,
        activeSessionId: null,
        confirmationRequest: null
      });

      const providerKeys = new Set(models.map((item) => item.id));
      const agent = agents.find((item) => item.id === id);
      const slashIndex = agent?.model?.indexOf('/') ?? -1;
      const providerKey = slashIndex > 0 && agent?.model ? agent.model.slice(0, slashIndex) : '';
      const canInit = Boolean(agent?.model) && providerKeys.has(providerKey);

      if (canInit) {
        const result = await window.kairo.invoke('agent:init', id) as { success: boolean; error?: string };
        if (!result.success) {
          alert(t('app.initAgentFailed', { error: result.error || 'Unknown' }));
          return;
        }
      }

      await loadSessions();
      await loadActiveSession();
    } catch (error) {
      console.error('Failed to set active agent:', error);
      throw error;
    }
  }, [agents, loadActiveSession, loadSessions, models, t, updateSessionContext]);

  const activeAgentName = useMemo(() => {
    const activeAgent = agents.find((agent) => agent.id === sessionContext.activeAgentId);
    if (activeAgent?.name?.trim()) {
      return activeAgent.name;
    }
    return activeAgent?.id === 'mainAgent' ? t('agent.defaultName') : t('chat.agentName');
  }, [agents, sessionContext.activeAgentId, t]);

  return {
    activeAgentName,
    handleDeleteAgent,
    handleSaveAgent,
    handleSetActiveAgent
  };
}
