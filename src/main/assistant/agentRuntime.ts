import path from 'path';
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { WebContents } from 'electron';
import { AgentRuntime } from '../core/agent/runtime';
import { ToolDefinition } from '../core/llm/types';
import { createLLMProvider } from '../core/llm/provider';
import { PromptBuilder } from '../core/llm/prompt';
import { PermissionGuard } from '../core/security/permissions';
import { ReadFileTool, WriteFileTool, ListDirectoryTool, DeleteFileTool } from '../core/tools/filesystem';
import { createExecuteCommandTool } from '../core/tools/shell';
import { SystemInfoTool } from '../core/tools/system';
import { WebSearchTool, FetchWebpageTool } from '../core/tools/web';
import { addAuditLog } from '../store/audit';
import { AgentConfig, ModelConfig, getAgent, getModelForAgent } from '../store/config';
import { pluginManager } from '../core/plugins/manager';
import { skillsManager } from '../core/skills/manager';
import { DEFAULT_SHELL_COMMANDS } from '../../shared/contracts';

type RuntimeRegistryEntry = {
  runtime: AgentRuntime;
  signature: string;
};

const runtimeRegistry = new Map<string, RuntimeRegistryEntry>();

function createRuntimeSignature(config: ResolvedAgentConfig) {
  const { agent, model } = config;
  const workspace = agent.workspace ? path.resolve(agent.workspace) : process.cwd();
  const allowedPaths = Array.isArray(agent.permissions.fileSystem.allowedPaths)
    ? agent.permissions.fileSystem.allowedPaths
      .filter((value: string) => value && value.trim().length > 0)
      .map((value: string) => path.resolve(value))
      .sort()
    : [];
  const allowedDomains = Array.isArray(agent.permissions.network.allowedDomains)
    ? agent.permissions.network.allowedDomains
      .filter((value: string) => value && value.trim().length > 0)
      .sort()
    : [];
  const allowedCommands = Array.isArray(agent.permissions.shell.allowedCommands)
    ? agent.permissions.shell.allowedCommands
      .filter((value: string) => value && value.trim().length > 0)
      .sort()
    : [];

  return JSON.stringify({
    workspace,
    model: {
      provider: model.provider || 'openai',
      baseUrl: model.baseUrl || '',
      model: model.model || 'gpt-3.5-turbo',
      hasApiKey: Boolean(model.apiKey)
    },
    permissions: {
      executionProfile: agent.permissions.executionProfile,
      policy: agent.permissions.policy,
      fileSystem: {
        read: agent.permissions.fileSystem.read,
        write: agent.permissions.fileSystem.write,
        allowedPaths
      },
      network: {
        enabled: agent.permissions.network.enabled,
        allowedDomains
      },
      shell: {
        enabled: agent.permissions.shell.enabled,
        allowedCommands
      }
    }
  });
}

const execFileAsync = promisify(execFile);
const SKILL_SCRIPT_MAX_BUFFER_BYTES = 1024 * 1024;

interface ResolvedAgentConfig {
  agent: AgentConfig;
  model: ModelConfig;
}

function resolveSkillScriptCommand(absoluteScriptPath: string) {
  const extension = path.extname(absoluteScriptPath).toLowerCase();
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return 'node';
  }
  if (extension === '.py') {
    return 'python3';
  }
  if (extension === '.sh') {
    return 'bash';
  }
  throw new Error(`Unsupported skill script type: ${extension || 'unknown'}`);
}

function isInternalSkillResource(resourcePath: string) {
  const normalizedPath = resourcePath.trim().replace(/\\/g, '/');
  if (!normalizedPath) {
    return true;
  }

  return normalizedPath
    .split('/')
    .some((segment) => segment === '_meta.json' || segment.startsWith('.'));
}

async function buildSkillCatalogSection(agentId: string) {
  const skills = await skillsManager.listMergedSkills(agentId);
  if (skills.length === 0) {
    return '<available_skills>\nNo skills available.\n</available_skills>';
  }

  const entries = skills
    .map((skill) => {
      const versionText = skill.version ? ` | version: ${skill.version}` : '';
      const sourceText = ` | scope: ${skill.source}`;
      return `- ${skill.id}: ${skill.description}${versionText}${sourceText}`;
    })
    .join('\n');

  return `<available_skills>\n${entries}\n</available_skills>`;
}

async function buildSystemPromptWithSkills(agent: AgentConfig, workspace: string) {
  const basePrompt = PromptBuilder.buildSystemPrompt({
    workspace,
    kairopilotPrompt: agent.systemPrompt,
    identityPrompt: agent.identityPrompt,
    userPrompt: agent.userPrompt,
    soulPrompt: agent.soulPrompt
  }, {
    includeWorkspacePrompts: false,
    includeMemory: false,
    includeEnvironment: true
  });
  const skillCatalog = await buildSkillCatalogSection(agent.id);
  return `${basePrompt}\n\n${skillCatalog}`;
}

async function createLoadSkillTool(agentId: string): Promise<ToolDefinition> {
  return {
    name: 'load_skill',
    description: 'Load the instructions of a matching skill by name before executing a skill-guided workflow.',
    parameters: z.object({
      name: z.string().trim().min(1).describe('The skill name or skill directory name.')
    }),
    execute: async (args: Record<string, unknown>) => {
      const name = String(args.name ?? '').trim();
      const metadata = await skillsManager.getMetadata(name, agentId);
      const content = await skillsManager.readSkillContent(name, agentId);
      const skillPath = await skillsManager.resolveSkillPath(name, agentId);

      if (!metadata || !content || !skillPath) {
        throw new Error(`Skill not found: ${name}`);
      }

      const entries = await fs.readdir(skillPath, { withFileTypes: true });
      const resources = entries
        .filter((entry) => entry.name !== 'SKILL.md' && !entry.name.startsWith('.') && entry.name !== '_meta.json')
        .map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file'
        }));

      return {
        name: metadata.name,
        description: metadata.description,
        version: metadata.metadata.version,
        allowedTools: metadata.metadata.allowedTools,
        skillPath,
        content,
        resources
      };
    }
  };
}

function createReadSkillResourceTool(agentId: string): ToolDefinition {
  return {
    name: 'read_skill_resource',
    description: 'Read an additional resource file from a loaded skill using a path relative to the skill root.',
    parameters: z.object({
      skill: z.string().trim().min(1).describe('The skill name or skill directory name.'),
      path: z.string().trim().min(1).describe('A relative path inside the skill directory.')
    }),
    execute: async (args: Record<string, unknown>) => {
      const skill = String(args.skill ?? '').trim();
      const resourcePath = String(args.path ?? '').trim();
      if (isInternalSkillResource(resourcePath)) {
        throw new Error(`Skill resource is internal-only: ${skill}/${resourcePath}`);
      }
      const resource = await skillsManager.readSkillResource(skill, resourcePath, agentId);
      if (!resource) {
        throw new Error(`Skill resource not found: ${skill}/${resourcePath}`);
      }
      return resource;
    }
  };
}

function createRunSkillScriptTool(agentId: string): ToolDefinition {
  return {
    name: 'run_skill_script',
    description: 'Run a bundled script from a skill when the skill explicitly requires executable helper logic.',
    parameters: z.object({
      skill: z.string().trim().min(1).describe('The skill name or skill directory name.'),
      scriptPath: z.string().trim().min(1).describe('A relative path to the script inside the skill directory.'),
      args: z.array(z.string()).default([]).describe('Arguments passed to the skill script.')
    }),
    execute: async (args: Record<string, unknown>) => {
      const skill = String(args.skill ?? '').trim();
      const scriptPath = String(args.scriptPath ?? '').trim();
      const scriptArgs = Array.isArray(args.args)
        ? args.args.map((value) => String(value))
        : [];

      const allowed = await skillsManager.canUseAllowedTool(skill, 'run_skill_script', agentId);
      if (!allowed) {
        throw new Error(`Skill ${skill} does not allow run_skill_script.`);
      }

      const absoluteScriptPath = await skillsManager.resolveResourcePath(skill, scriptPath, agentId);
      if (!absoluteScriptPath) {
        throw new Error(`Skill script not found: ${skill}/${scriptPath}`);
      }

      const command = resolveSkillScriptCommand(absoluteScriptPath);
      const { stdout, stderr } = await execFileAsync(command, [absoluteScriptPath, ...scriptArgs], {
        cwd: path.dirname(absoluteScriptPath),
        maxBuffer: SKILL_SCRIPT_MAX_BUFFER_BYTES,
        windowsHide: true
      });

      return {
        command,
        scriptPath: absoluteScriptPath,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0
      };
    }
  };
}

async function initializeAgent(config: ResolvedAgentConfig, sender?: WebContents) {
  void sender;
  const { agent, model } = config;
  const signature = createRuntimeSignature(config);
  const workspace = agent.workspace ? path.resolve(agent.workspace) : process.cwd();
  const userAllowedPaths = Array.isArray(agent.permissions.fileSystem.allowedPaths)
    ? agent.permissions.fileSystem.allowedPaths.filter((p: string) => p && p.trim().length > 0).map((p: string) => path.resolve(p))
    : [];
  const allowedPaths = [...new Set([workspace, ...userAllowedPaths])];
  const allowedCommands = Array.isArray(agent.permissions.shell.allowedCommands)
    ? agent.permissions.shell.allowedCommands.filter((c: string) => c && c.trim().length > 0)
    : [...DEFAULT_SHELL_COMMANDS];
  const allowedDomains = Array.isArray(agent.permissions.network.allowedDomains)
    ? agent.permissions.network.allowedDomains.filter((domain: string) => domain && domain.trim().length > 0)
    : [];

  const permissions = new PermissionGuard({
    executionProfile: agent.permissions.executionProfile,
    policy: agent.permissions.policy,
    fileSystem: {
      read: agent.permissions.fileSystem.read,
      write: agent.permissions.fileSystem.write,
      allowedPaths
    },
    network: {
      enabled: agent.permissions.network.enabled,
      allowedDomains
    },
    shell: {
      enabled: agent.permissions.shell.enabled,
      allowedCommands: agent.permissions.shell.enabled ? allowedCommands : []
    }
  });

  const llm = createLLMProvider({
    provider: model.provider || 'openai',
    apiKey: model.apiKey,
    baseUrl: model.baseUrl,
    model: model.model || 'gpt-3.5-turbo'
  });

  const systemPromptWithContext = await buildSystemPromptWithSkills(agent, workspace);

  console.log(`[Agent] System prompt assembled. Length=${systemPromptWithContext.length}`);

  const runtime = new AgentRuntime(
    llm,
    permissions,
    workspace,
    systemPromptWithContext,
    (log) => {
      addAuditLog({
        tool: log.tool,
        args: log.args,
        result: log.result,
        error: log.error,
        policyTags: log.policyTags,
        sessionId: log.sessionId,
        runId: log.runId,
        stepId: log.stepId
      });
    },
    () => buildSystemPromptWithSkills(agent, workspace)
  );

  runtime.registerTool(ReadFileTool as unknown as ToolDefinition);
  runtime.registerTool(WriteFileTool as unknown as ToolDefinition);
  runtime.registerTool(ListDirectoryTool as unknown as ToolDefinition);
  runtime.registerTool(DeleteFileTool as unknown as ToolDefinition);
  runtime.registerTool(createExecuteCommandTool({
    cwd: workspace,
    policy: permissions.getShellExecutionPolicy()
  }) as unknown as ToolDefinition);
  runtime.registerTool(SystemInfoTool as unknown as ToolDefinition);
  runtime.registerTool(WebSearchTool as unknown as ToolDefinition);
  runtime.registerTool(FetchWebpageTool as unknown as ToolDefinition);
  runtime.registerTool(await createLoadSkillTool(agent.id));
  runtime.registerTool(createReadSkillResourceTool(agent.id));
  runtime.registerTool(createRunSkillScriptTool(agent.id));

  try {
    const dynamicTools = await pluginManager.loadAllTools(agent.id);
    for (const tool of dynamicTools) {
      runtime.registerTool(tool as unknown as ToolDefinition);
      console.log(`[Agent] Registered dynamic tool: ${tool.name}`);
    }
  } catch (error) {
    console.error('Failed to load dynamic plugins:', error);
  }

  runtimeRegistry.set(agent.id, {
    runtime,
    signature
  });
  return runtime;
}

async function ensureAgentRuntime(config: ResolvedAgentConfig, sender?: WebContents) {
  const signature = createRuntimeSignature(config);
  const existing = runtimeRegistry.get(config.agent.id);
  if (existing && existing.signature === signature) {
    return existing.runtime;
  }
  return initializeAgent(config, sender);
}

async function resolveAgentConfig(configOrId: string | AgentConfig | ResolvedAgentConfig): Promise<ResolvedAgentConfig> {
  if (typeof configOrId === 'string') {
    const agent = getAgent(configOrId);
    if (!agent) throw new Error(`Agent not found: ${configOrId}`);
    const model = getModelForAgent(agent);
    if (!model) throw new Error(`Model not found for agent model: ${agent.model}`);
    return { agent, model };
  }

  if ('agent' in configOrId && 'model' in configOrId) {
    return configOrId as ResolvedAgentConfig;
  }

  const agent = configOrId as AgentConfig;
  const model = getModelForAgent(agent);
  if (!model) throw new Error(`Model not found for agent model: ${agent.model}`);
  return { agent, model };
}

function getAgentRuntime(agentId: string) {
  return runtimeRegistry.get(agentId)?.runtime || null;
}

function removeAgentRuntime(agentId: string) {
  runtimeRegistry.delete(agentId);
}

export {
  ensureAgentRuntime,
  initializeAgent,
  resolveAgentConfig,
  getAgentRuntime,
  removeAgentRuntime
};
