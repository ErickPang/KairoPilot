import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppConfirmationOptions,
  KairoPilotConfig,
  ModelConfig,
  SessionContextState,
  SessionContextUpdate
} from '../types';
import { I18nContextValue } from '../components/layout/I18nContext';
import { canInitAgentFromConfig, toModelList } from './configUtils';
import { useModelConfig } from './useModelConfig';
import { useAgentConfig } from './useAgentConfig';
import { KAIRO_INVOKE } from '../../shared/ipc';
import { createErrorNotice, getErrorMessage, logRendererError } from './errorUtils';

interface UseConfigControllerOptions {
  sessionContext: SessionContextState;
  requestConfirmation: (request: AppConfirmationOptions) => Promise<boolean>;
  t: I18nContextValue['t'];
  updateSessionContext: (patch: SessionContextUpdate) => void;
  loadActiveSession: () => Promise<void>;
  loadSessions: () => Promise<void>;
}

export function useConfigController(options: UseConfigControllerOptions) {
  const { sessionContext, requestConfirmation, t, updateSessionContext, loadActiveSession, loadSessions } = options;
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [agents, setAgents] = useState<KairoPilotConfig['agents']['list']>([]);
  const autoInitializedAgentIdRef = useRef<string | null>(null);

  const applyConfigToState = useCallback((fullConfig: KairoPilotConfig) => {
    setModels(toModelList(fullConfig.models.providers || {}));
    setAgents(fullConfig.agents.list || []);
    updateSessionContext({
      activeAgentId: fullConfig.agents.activeAgentId || null
    });
  }, [updateSessionContext]);

  const refreshConfig = useCallback(async () => {
    const fullConfig = await window.kairo.invoke(KAIRO_INVOKE.configGetAll);
    applyConfigToState(fullConfig);
    return fullConfig;
  }, [applyConfigToState]);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const fullConfig = await window.kairo.invoke(KAIRO_INVOKE.configGetAll);
        if (!fullConfig) {
          return;
        }

        applyConfigToState(fullConfig);

        const activeAgentId = fullConfig.agents.activeAgentId || null;

        if (!canInitAgentFromConfig(fullConfig, activeAgentId)) {
          autoInitializedAgentIdRef.current = null;
          return;
        }

        if (autoInitializedAgentIdRef.current === activeAgentId) {
          return;
        }

        try {
          const result = await window.kairo.invoke(KAIRO_INVOKE.agentInit, activeAgentId) as {
            success?: boolean;
            error?: string;
          } | null;
          if (result?.success) {
            autoInitializedAgentIdRef.current = activeAgentId;
            await loadSessions();
            await loadActiveSession();
            return;
          }

          autoInitializedAgentIdRef.current = null;
          updateSessionContext({
            appNotice: createErrorNotice(t('app.error.initAgent', { error: result?.error || 'Unknown error' }), 'auto_init')
          });
        } catch (error) {
          autoInitializedAgentIdRef.current = null;
          logRendererError('Auto-init failed', error);
          updateSessionContext({
            appNotice: createErrorNotice(t('app.error.initAgent', { error: getErrorMessage(error) }), 'auto_init')
          });
        }
      } catch (error) {
        logRendererError('Failed to load config', error);
        updateSessionContext({
          appNotice: createErrorNotice(t('app.error.loadConfig', { error: getErrorMessage(error) }), 'load_config')
        });
      }
    };

    loadConfig();
  }, [applyConfigToState, loadActiveSession, loadSessions, t, updateSessionContext]);

  const { availableModels, describeProvider, fetchModels, handleDeleteModel, handleSaveModel } = useModelConfig({
    requestConfirmation,
    refreshConfig: async () => {
      await refreshConfig();
    },
    reportConfigError: (message, source) => {
      updateSessionContext({
        appNotice: createErrorNotice(message, source)
      });
    },
    t
  });
  const { activeAgentName, handleDeleteAgent, handleSaveAgent, handleSetActiveAgent } = useAgentConfig({
    agents,
    models,
    refreshConfig,
    sessionContext,
    requestConfirmation,
    t,
    updateSessionContext,
    loadActiveSession,
    loadSessions,
    reportConfigError: (message, source) => {
      updateSessionContext({
        appNotice: createErrorNotice(message, source)
      });
    }
  });

  return {
    activeAgentName,
    agents,
    availableModels,
    describeProvider,
    fetchModels,
    handleDeleteAgent,
    handleDeleteModel,
    handleSaveAgent,
    handleSaveModel,
    handleSetActiveAgent,
    models
  };
}
