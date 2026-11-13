import { assertWorkbenchIdle } from './workbenchExecution';
import { clearAgentRuntimes } from '../assistant/agentRuntime';
import { deleteModel, saveModel } from '../store/config';
import type { ModelConfig } from '../../shared/contracts';
import { prepareConfigSecret } from '../store/configSecrets';
export async function saveModelAndRefreshAgents(model: ModelConfig) {
  await prepareConfigSecret(model.apiKey);
  assertWorkbenchIdle();
  saveModel(model);
  clearAgentRuntimes();
}
export function deleteModelAndRefreshAgents(modelId: string) {
  assertWorkbenchIdle();
  deleteModel(modelId);
  clearAgentRuntimes();
}
