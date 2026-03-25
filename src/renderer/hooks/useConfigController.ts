import { useCallback, useEffect, useState } from 'react';
import {
  KairoPilotConfig,
  ModelConfig,
  SessionContextState
} from '../types';
import { I18nContextValue } from '../components/layout/I18nContext';
import { canInitAgentFromConfig, toModelList } from './configUtils';
import { useModelConfig } from './useModelConfig';
import { useAgentConfig } from './useAgentConfig';

interface UseConfigControllerOptions {
  sessionContext: SessionContextState;
  t: I18nContextValue['t'];
  updateSessionContext: (patch: Partial<SessionContextState>) => void;
  loadActiveSession: () => Promise<void>;
  loadSessions: () => Promise<void>;
}

export function useConfigController(options: UseConfigControllerOptions) {
  const { sessionContext, t, updateSessionContext, loadActiveSession, loadSessions } = options;
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [agents, setAgents] = useState<KairoPilotConfig['agents']['list']>([]);

  const applyConfigToState = useCallback((fullConfig: KairoPilotConfig) => {
    setModels(toModelList(fullConfig.models.providers || {}));
    setAgents(fullConfig.agents.list || []);
    updateSessionContext({
      activeAgentId: fullConfig.agents.activeAgentId || null
    });
  }, [updateSessionContext]);

  const refreshConfig = useCallback(async () => {
    const fullConfig = await window.kairo.invoke('config:get-all') as KairoPilotConfig;
    applyConfigToState(fullConfig);
    return fullConfig;
  }, [applyConfigToState]);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const fullConfig = await window.kairo.invoke('config:get-all') as KairoPilotConfig;
        if (!fullConfig) {
          return;
        }

        applyConfigToState(fullConfig);

        if (!canInitAgentFromConfig(fullConfig, fullConfig.agents.activeAgentId)) {
          return;
        }

        try {
          const result = await window.kairo.invoke('agent:init', fullConfig.agents.activeAgentId) as { success: boolean; error?: string };
          if (result.success) {
            await loadSessions();
            await loadActiveSession();
          }
        } catch (error) {
          console.error('Auto-init failed:', error);
        }
      } catch (error) {
        console.error('Failed to load config:', error);
      }
    };

    loadConfig();
  }, [applyConfigToState, loadActiveSession, loadSessions]);

  const { availableModels, fetchModels, handleDeleteModel, handleSaveModel } = useModelConfig({
    refreshConfig: async () => {
      await refreshConfig();
    },
    t
  });
  const { activeAgentName, handleDeleteAgent, handleSaveAgent, handleSetActiveAgent } = useAgentConfig({
    agents,
    models,
    refreshConfig,
    sessionContext,
    t,
    updateSessionContext,
    loadActiveSession,
    loadSessions
  });

  return {
    activeAgentName,
    agents,
    availableModels,
    fetchModels,
    handleDeleteAgent,
    handleDeleteModel,
    handleSaveAgent,
    handleSaveModel,
    handleSetActiveAgent,
    models
  };
}
