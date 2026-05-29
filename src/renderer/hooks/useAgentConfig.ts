import { useCallback, useMemo } from 'react';
import { AgentConfig, AppConfirmationOptions, KairoPilotConfig, ModelConfig, SessionContextState, SessionContextUpdate } from '../types';
import { I18nContextValue } from '../components/layout/I18nContext';
import { canInitAgentFromConfig } from './configUtils';
import { KAIRO_INVOKE } from '../../shared/ipc';
import { getErrorMessage, logRendererError } from './errorUtils';

interface UseAgentConfigOptions {
  agents: AgentConfig[];
  models: ModelConfig[];
  refreshConfig: () => Promise<KairoPilotConfig>;
  reportConfigError: (message: string, source: string) => void;
  requestConfirmation: (request: AppConfirmationOptions) => Promise<boolean>;
  sessionContext: SessionContextState;
  t: I18nContextValue['t'];
  updateSessionContext: (patch: SessionContextUpdate) => void;
  loadActiveSession: () => Promise<void>;
  loadSessions: () => Promise<void>;
}

export function useAgentConfig(options: UseAgentConfigOptions) {
  const {
    agents,
    models,
    refreshConfig,
    reportConfigError,
    requestConfirmation,
    sessionContext,
    t,
    updateSessionContext,
    loadActiveSession,
    loadSessions
  } = options;

  const handleSaveAgent = useCallback(async (agent: AgentConfig) => {
    try {
      updateSessionContext({ appNotice: null });
      await window.kairo.invoke(KAIRO_INVOKE.configSaveAgent, agent);
      const fullConfig = await refreshConfig();
      if (sessionContext.activeAgentId === agent.id && canInitAgentFromConfig(fullConfig, agent.id)) {
        await window.kairo.invoke(KAIRO_INVOKE.agentInit, agent.id);
      }
    } catch (error) {
      logRendererError('Failed to save agent', error);
      reportConfigError(t('app.error.saveAgent', { error: getErrorMessage(error) }), 'save_agent');
    }
  }, [refreshConfig, reportConfigError, sessionContext.activeAgentId, t, updateSessionContext]);

  const handleDeleteAgent = useCallback(async (id: string) => {
    const confirmed = await requestConfirmation({
      title: t('common.confirm'),
      message: t('app.deleteAgentConfirm'),
      confirmLabel: t('common.delete'),
      variant: 'danger'
    });

    if (!confirmed) {
      return;
    }

    try {
      updateSessionContext({ appNotice: null });
      await window.kairo.invoke(KAIRO_INVOKE.configDeleteAgent, {
        id,
        deleteWorkspace: true,
        confirmation: `delete-agent:${id}:workspace`
      });
      const fullConfig = await refreshConfig();
      if (sessionContext.activeAgentId === id) {
        updateSessionContext({
          activeAgentId: fullConfig.agents.activeAgentId || null
        });
        if (canInitAgentFromConfig(fullConfig, fullConfig.agents.activeAgentId)) {
          await window.kairo.invoke(KAIRO_INVOKE.agentInit, fullConfig.agents.activeAgentId);
        }
        await loadSessions();
        await loadActiveSession();
      }
    } catch (error) {
      logRendererError('Failed to delete agent', error);
      reportConfigError(t('app.error.deleteAgent', { error: getErrorMessage(error) }), 'delete_agent');
    }
  }, [loadActiveSession, loadSessions, refreshConfig, reportConfigError, requestConfirmation, sessionContext.activeAgentId, t, updateSessionContext]);

  const handleSetActiveAgent = useCallback(async (id: string) => {
    try {
      updateSessionContext({ appNotice: null });
      await window.kairo.invoke(KAIRO_INVOKE.configSetActiveAgent, id);
      updateSessionContext({
        activeAgentId: id,
        activeSessionId: null,
        appNotice: null,
        confirmationRequest: null
      });

      const providerKeys = new Set(models.map((item) => item.id));
      const agent = agents.find((item) => item.id === id);
      const slashIndex = agent?.model?.indexOf('/') ?? -1;
      const providerKey = slashIndex > 0 && agent?.model ? agent.model.slice(0, slashIndex) : '';
      const canInit = Boolean(agent?.model) && providerKeys.has(providerKey);

      if (canInit) {
        const result = await window.kairo.invoke(KAIRO_INVOKE.agentInit, id);
        if (!result.success) {
          reportConfigError(t('app.error.initAgent', { error: result.error || 'Unknown error' }), 'set_active_agent');
          return;
        }
      }

      await loadSessions();
      await loadActiveSession();
    } catch (error) {
      logRendererError('Failed to set active agent', error);
      reportConfigError(t('app.error.switchAgent', { error: getErrorMessage(error) }), 'set_active_agent');
      throw error;
    }
  }, [agents, loadActiveSession, loadSessions, models, reportConfigError, t, updateSessionContext]);

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
