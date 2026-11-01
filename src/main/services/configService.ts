import { assertWorkbenchIdle } from './workbenchExecution';
import { clearAgentRuntimes } from '../assistant/agentRuntime';
import { deleteModel, saveModel } from '../store/config';
import type { ModelConfig } from '../../shared/contracts';
export function saveModelAndRefreshAgents(model: ModelConfig) {
  assertWorkbenchIdle();
  saveModel(model);
  clearAgentRuntimes();
}
export function deleteModelAndRefreshAgents(modelId: string) {
  assertWorkbenchIdle();
  deleteModel(modelId);
  clearAgentRuntimes();
}
