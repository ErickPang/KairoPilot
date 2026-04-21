import { useCallback, useState } from 'react';
import { AppConfirmationOptions, FetchModelsResult, ModelConfig, ProviderCapabilitySnapshot } from '../types';
import { I18nContextValue } from '../components/layout/I18nContext';
import { KAIRO_INVOKE } from '../../shared/ipc';
import { getErrorMessage, logRendererError } from './errorUtils';

interface UseModelConfigOptions {
  requestConfirmation: (request: AppConfirmationOptions) => Promise<boolean>;
  refreshConfig: () => Promise<void>;
  reportConfigError: (message: string, source: string) => void;
  t: I18nContextValue['t'];
}

export function useModelConfig(options: UseModelConfigOptions) {
  const { requestConfirmation, refreshConfig, reportConfigError, t } = options;
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  const fetchModels = useCallback(async (config: ModelConfig): Promise<FetchModelsResult> => {
    try {
      const modelList = await window.kairo.invoke(KAIRO_INVOKE.llmListModels, config);
      const normalizedList = Array.isArray(modelList) ? modelList : [];
      setAvailableModels(normalizedList);
      if (normalizedList.length > 0) {
        return { success: true, models: normalizedList };
      }
      return { success: false, models: [], error: 'No models returned from provider' };
    } catch (error) {
      logRendererError('Failed to fetch models', error);
      reportConfigError(t('app.error.fetchModels', { error: getErrorMessage(error) }), 'fetch_models');
      return { success: false, models: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }, [reportConfigError, t]);

  const describeProvider = useCallback(async (config: ModelConfig): Promise<ProviderCapabilitySnapshot | null> => {
    try {
      return await window.kairo.invoke(KAIRO_INVOKE.llmDescribeProvider, config) as ProviderCapabilitySnapshot;
    } catch (error) {
      logRendererError('Failed to describe provider', error);
      return null;
    }
  }, []);

  const handleSaveModel = useCallback(async (model: ModelConfig) => {
    try {
      await window.kairo.invoke(KAIRO_INVOKE.configSaveModel, model);
      await refreshConfig();
    } catch (error) {
      logRendererError('Failed to save model', error);
      reportConfigError(t('app.error.saveModel', { error: getErrorMessage(error) }), 'save_model');
    }
  }, [refreshConfig, reportConfigError, t]);

  const handleDeleteModel = useCallback(async (id: string) => {
    const confirmed = await requestConfirmation({
      title: t('common.confirm'),
      message: t('app.deleteModelConfirm'),
      confirmLabel: t('common.delete'),
      variant: 'danger'
    });

    if (!confirmed) {
      return;
    }

    try {
      await window.kairo.invoke(KAIRO_INVOKE.configDeleteModel, id);
      await refreshConfig();
    } catch (error) {
      logRendererError('Failed to delete model', error);
      reportConfigError(t('app.error.deleteModel', { error: getErrorMessage(error) }), 'delete_model');
    }
  }, [refreshConfig, reportConfigError, requestConfirmation, t]);

  return {
    availableModels,
    describeProvider,
    fetchModels,
    handleDeleteModel,
    handleSaveModel
  };
}
