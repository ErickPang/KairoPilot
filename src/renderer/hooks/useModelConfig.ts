import { useCallback, useState } from 'react';
import { FetchModelsResult, ModelConfig } from '../types';
import { I18nContextValue } from '../components/layout/I18nContext';

interface UseModelConfigOptions {
  refreshConfig: () => Promise<void>;
  t: I18nContextValue['t'];
}

export function useModelConfig(options: UseModelConfigOptions) {
  const { refreshConfig, t } = options;
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  const fetchModels = useCallback(async (config: ModelConfig): Promise<FetchModelsResult> => {
    try {
      const modelList = await window.kairo.invoke('llm:listModels', config) as string[];
      const normalizedList = Array.isArray(modelList) ? modelList : [];
      setAvailableModels(normalizedList);
      if (normalizedList.length > 0) {
        return { success: true, models: normalizedList };
      }
      return { success: false, models: [], error: 'No models returned from provider' };
    } catch (error) {
      console.error('Failed to fetch models:', error);
      return { success: false, models: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }, []);

  const handleSaveModel = useCallback(async (model: ModelConfig) => {
    try {
      await window.kairo.invoke('config:save-model', model);
      await refreshConfig();
    } catch (error) {
      console.error('Failed to save model:', error);
    }
  }, [refreshConfig]);

  const handleDeleteModel = useCallback(async (id: string) => {
    if (!confirm(t('app.deleteModelConfirm'))) {
      return;
    }

    try {
      await window.kairo.invoke('config:delete-model', id);
      await refreshConfig();
    } catch (error) {
      console.error('Failed to delete model:', error);
    }
  }, [refreshConfig, t]);

  return {
    availableModels,
    fetchModels,
    handleDeleteModel,
    handleSaveModel
  };
}
