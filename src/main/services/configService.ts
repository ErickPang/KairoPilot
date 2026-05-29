import { pluginManager } from '../core/plugins/manager';
import { removeAgentRuntime } from '../assistant/agentRuntime';
import { deleteAuditLogsBySessionIds } from '../store/audit';
import { deleteSessionsByAgent } from '../store/chat';
import {
  deleteAgent,
  deleteAgentWorkspace,
  deleteModel,
  getAgent,
  getAgents,
  getActiveAgentId,
  saveAgent,
  saveAgentConfig,
  saveModel
} from '../store/config';
import type { AgentConfig, LegacyAgentConfig, ModelConfig } from '../../shared/contracts';

export interface AgentDeleteCleanupResult {
  agentDeleted: boolean;
  deletedSessionCount: number;
  pluginCleanupCount?: number;
  pluginCleanupError?: string;
  workspaceDeleted?: boolean;
  workspaceDeleteError?: string;
}

function removeRuntimesForAgents(agentIds: string[]) {
  const uniqueAgentIds = [...new Set(agentIds.filter((id) => typeof id === 'string' && id.length > 0))];
  for (const agentId of uniqueAgentIds) {
    removeAgentRuntime(agentId);
  }
}

function findAgentIdsByProvider(providerId: string) {
  return getAgents()
    .filter((agent) => agent.model === providerId || agent.model.startsWith(`${providerId}/`))
    .map((agent) => agent.id);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

export function saveLegacyAgentConfigAndRefreshRuntime(config: LegacyAgentConfig) {
  const activeAgentId = getActiveAgentId();
  saveAgentConfig(config);
  removeRuntimesForAgents([activeAgentId]);
}

export function saveModelAndRefreshAgents(model: ModelConfig) {
  saveModel(model);
  removeRuntimesForAgents(findAgentIdsByProvider(model.id));
}

export function deleteModelAndRefreshAgents(modelId: string) {
  removeRuntimesForAgents(findAgentIdsByProvider(modelId));
  deleteModel(modelId);
}

export function saveAgentAndRefreshRuntime(agent: AgentConfig) {
  saveAgent(agent);
  removeRuntimesForAgents([agent.id]);
}

export async function deleteAgentWithCleanup(agentId: string, deleteWorkspace: boolean): Promise<AgentDeleteCleanupResult> {
  if (agentId === 'mainAgent') {
    throw new Error('Main Agent cannot be deleted');
  }

  const agent = getAgent(agentId);
  if (!agent) {
    return {
      agentDeleted: false,
      deletedSessionCount: 0
    };
  }

  const sessionIds = deleteSessionsByAgent(agentId);
  deleteAuditLogsBySessionIds(sessionIds);
  removeAgentRuntime(agentId);
  deleteAgent(agentId);

  const cleanup: AgentDeleteCleanupResult = {
    agentDeleted: true,
    deletedSessionCount: sessionIds.length
  };

  try {
    cleanup.pluginCleanupCount = await pluginManager.cleanupAgentScopedPlugins(agentId);
  } catch (error) {
    cleanup.pluginCleanupError = getErrorMessage(error);
    console.warn(`[ConfigService] Failed to clean up scoped plugins for agent ${agentId}:`, error);
  }

  if (deleteWorkspace) {
    try {
      cleanup.workspaceDeleted = deleteAgentWorkspace(agent);
    } catch (error) {
      cleanup.workspaceDeleteError = getErrorMessage(error);
      console.warn(`[ConfigService] Failed to delete workspace for agent ${agentId}:`, error);
    }
  }

  return cleanup;
}
