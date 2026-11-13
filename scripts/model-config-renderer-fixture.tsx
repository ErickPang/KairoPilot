import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigPanel } from '../src/renderer/components/ConfigPanel';
import { I18nProvider } from '../src/renderer/components/layout/I18nProvider';
import { useModelConfig } from '../src/renderer/hooks/useModelConfig';
import { useTranslation } from '../src/renderer/hooks/useTranslation';
import { KAIRO_INVOKE as C } from '../src/shared/ipc';
import type { ModelConfig } from '../src/shared/contracts';
import { applyAppearanceTheme } from '../src/renderer/theme';
import '../src/renderer/index.css';
import '../src/renderer/App.css';
import '../src/renderer/components/Workbench.css';

applyAppearanceTheme('light');

// Exercise the real component and save hook with synthetic IPC failures only.
window.kairo = { invoke: async (channel: string, config: ModelConfig) => {
  const state = document.documentElement.dataset;
  if (channel === C.llmDescribeProvider) return {
    provider: config.provider, supported: config.provider !== 'anthropic',
    protocol: config.provider === 'anthropic' ? 'native' : 'openai-compatible',
    capabilities: { modelListing: config.provider !== 'anthropic' }
  };
  if (channel === C.llmListModels) {
    if (config.baseUrl.includes('slow-fixture')) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return ['slow-model'];
    }
    return [config.baseUrl.includes('fast-fixture') ? 'fast-model' : 'listed-model'];
  }
  if (channel === C.configSaveModel) {
    state.saveCalls = String(Number(state.saveCalls || 0) + 1);
    await new Promise<void>(resolve => {
      const timer = setInterval(() => { if (state.releaseSave === 'yes') { clearInterval(timer); resolve(); } }, 10);
    });
    if (state.saveOutcome !== 'success') throw new Error('Synthetic secure storage failure');
    state.savedModel = config.model;
    return { success: true };
  }
  throw new Error(`Unexpected fixture IPC: ${channel}`);
} } as unknown as KairoBridge;

export function Fixture() {
  const { t } = useTranslation();
  const [notice, setNotice] = useState('');
  const modelConfig = useModelConfig({
    t, requestConfirmation: async () => true,
    refreshConfig: async () => { document.documentElement.dataset.refreshed = 'yes'; },
    reportConfigError: message => setNotice(message)
  });
  return <div className="workbench-app"><div className="workbench-content"><p role="alert">{notice}</p><ConfigPanel models={[]} activeSection="model"
    onSaveWorkbench={async () => {}} onClearNotice={() => setNotice('')}
    onReportNotice={value => setNotice(value.message)} onSaveModel={modelConfig.handleSaveModel}
    onDeleteModel={modelConfig.handleDeleteModel} onDescribeProvider={modelConfig.describeProvider}
    onFetchModels={modelConfig.fetchModels}/></div></div>;
}
createRoot(document.getElementById('root')!).render(<I18nProvider><Fixture/></I18nProvider>);
