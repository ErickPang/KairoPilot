import path from 'path';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { WebContents } from 'electron';
import { AgentRuntime } from '../core/agent/runtime';
import { ToolDefinition } from '../core/llm/types';
import { OpenAIProvider } from '../core/llm/provider';
import { PromptBuilder } from '../core/llm/prompt';
import { PermissionGuard } from '../core/security/permissions';
import { ReadFileTool, WriteFileTool, ListDirectoryTool, DeleteFileTool } from '../core/tools/filesystem';
import { createExecuteCommandTool } from '../core/tools/shell';
import { SystemInfoTool } from '../core/tools/system';
import { WebSearchTool, FetchWebpageTool } from '../core/tools/web';
import { addAuditLog } from '../store/audit';
import { getActiveSession } from '../store/chat';
import { AgentConfig, ModelConfig, getAgent, getModel } from '../store/config';
import { pluginManager } from '../core/plugins/manager';

let currentAgent: AgentRuntime | null = null;
const pendingConfirmations = new Map<string, (approved: boolean) => void>();

interface ResolvedAgentConfig {
  agent: AgentConfig;
  model: ModelConfig;
}

async function initializeAgent(config: ResolvedAgentConfig, sender?: WebContents) {
  const { agent, model } = config;
  const workspace = agent.workspace ? path.resolve(agent.workspace) : process.cwd();
  const userAllowedPaths = Array.isArray(agent.allowedPaths)
    ? agent.allowedPaths.filter((p: string) => p && p.trim().length > 0).map((p: string) => path.resolve(p))
    : [];
  const allowedPaths = [...new Set([workspace, ...userAllowedPaths])];
  const defaultCommands = ['ls', 'cd', 'pwd', 'mkdir', 'rm', 'touch', 'cat', 'grep', 'echo', 'npm', 'node', 'git', 'python', 'python3', 'open', 'curl'];
  const userAllowedCommands = Array.isArray(agent.allowedCommands)
    ? agent.allowedCommands.filter((c: string) => c && c.trim().length > 0)
    : [];
  const allowedCommands = userAllowedCommands.length > 0 ? userAllowedCommands : defaultCommands;

  const permissions = new PermissionGuard({
    fileSystem: {
      read: true,
      write: true,
      allowedPaths
    },
    network: {
      enabled: true,
      allowedDomains: []
    },
    shell: {
      enabled: agent.enableShell || false,
      allowedCommands: agent.enableShell ? allowedCommands : []
    }
  });

  const llm = new OpenAIProvider({
    provider: model.provider || 'openai',
    apiKey: model.apiKey,
    baseUrl: model.baseUrl,
    model: model.model || 'gpt-3.5-turbo'
  });

  const systemPromptWithContext = PromptBuilder.buildSystemPrompt({
    workspace,
    agentPrompt: agent.systemPrompt
  });

  console.log('\n--- [DEBUG] Assembled System Prompt Start ---\n');
  console.log(systemPromptWithContext);
  console.log('\n--- [DEBUG] Assembled System Prompt End ---\n');

  currentAgent = new AgentRuntime(
    llm,
    permissions,
    systemPromptWithContext,
    async (toolName, args) => {
      if (!sender) {
        console.warn('No sender available for confirmation, auto-denying.');
        return false;
      }
      const confirmationId = uuidv4();
      return new Promise<boolean>((resolve) => {
        pendingConfirmations.set(confirmationId, resolve);
        sender.send('agent:ask-confirmation', { id: confirmationId, tool: toolName, args });
      });
    },
    (log) => {
      addAuditLog({
        tool: log.tool,
        args: log.args,
        result: log.result,
        error: log.error,
        policyTags: log.policyTags,
        sessionId: getActiveSession()?.id
      });
    }
  );

  currentAgent.registerTool(ReadFileTool as unknown as ToolDefinition);
  currentAgent.registerTool(WriteFileTool as unknown as ToolDefinition);
  currentAgent.registerTool(ListDirectoryTool as unknown as ToolDefinition);
  currentAgent.registerTool(DeleteFileTool as unknown as ToolDefinition);
  currentAgent.registerTool(createExecuteCommandTool(workspace) as unknown as ToolDefinition);
  currentAgent.registerTool(SystemInfoTool as unknown as ToolDefinition);
  currentAgent.registerTool(WebSearchTool as unknown as ToolDefinition);
  currentAgent.registerTool(FetchWebpageTool as unknown as ToolDefinition);

  try {
    const dynamicTools = await pluginManager.loadAllTools(agent.id);
    for (const tool of dynamicTools) {
      currentAgent.registerTool(tool as unknown as ToolDefinition);
      console.log(`[Agent] Registered dynamic tool: ${tool.name}`);
    }
  } catch (error) {
    console.error('Failed to load dynamic plugins:', error);
  }

  try {
    const agentSkills = await pluginManager.getMergedSkillsForAgent(agent.id);
    for (const skill of agentSkills) {
      const skillTool = {
        name: `skill_${skill.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
        description: `Use this skill when you need to: ${skill.description}. Calling this will return the standard operating procedure (SOP) or instructions.`,
        parameters: z.object({}),
        execute: async () => {
          return `[SKILL INSTRUCTIONS: ${skill.name}]\n\n${skill.content}`;
        }
      };
      currentAgent.registerTool(skillTool as unknown as ToolDefinition);
      console.log(`[Agent] Registered skill tool: ${skillTool.name} (Source: ${skill.source})`);
    }
  } catch (error) {
    console.error('Failed to load agent skills:', error);
  }
}

async function resolveAgentConfig(configOrId: string | AgentConfig | ResolvedAgentConfig): Promise<ResolvedAgentConfig> {
  if (typeof configOrId === 'string') {
    const agent = getAgent(configOrId);
    if (!agent) throw new Error(`Agent not found: ${configOrId}`);
    const model = getModel(agent.modelConfigId);
    if (!model) throw new Error(`Model not found: ${agent.modelConfigId}`);
    return { agent, model };
  }

  if ('agent' in configOrId && 'model' in configOrId) {
    return configOrId as ResolvedAgentConfig;
  }

  const agent = configOrId as AgentConfig;
  const model = getModel(agent.modelConfigId);
  if (!model) throw new Error(`Model not found: ${agent.modelConfigId}`);
  return { agent, model };
}

function getCurrentAgent() {
  return currentAgent;
}

export {
  pendingConfirmations,
  initializeAgent,
  resolveAgentConfig,
  getCurrentAgent
};
