import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { WebContents } from 'electron';
import { AgentRuntime } from '../core/agent/runtime';
import type { LoadedSkillCapability } from '../core/agent/capabilityOrchestrator';
import type { SkillCatalogSnapshot } from '../core/agent/runtimeHelpers';
import { ToolDefinition } from '../core/llm/types';
import { createLLMProvider } from '../core/llm/provider';
import { PromptBuilder } from '../core/llm/prompt';
import { PermissionGuard } from '../core/security/permissions';
import { SUPPORTED_SKILL_SCRIPT_EXTENSIONS } from '../core/security/policyConstants';
import { ReadFileTool, WriteFileTool, ListDirectoryTool, DeleteFileTool } from '../core/tools/filesystem';
import { toolError, toolOk } from '../core/tools/result';
import { createExecuteCommandTool } from '../core/tools/shell';
import { SystemInfoTool } from '../core/tools/system';
import { WebSearchTool, FetchWebpageTool, HttpRequestTool } from '../core/tools/web';
import { addAuditLog } from '../store/audit';
import { AgentConfig, ModelConfig, getAgent, getModelForAgent } from '../store/config';
import { pluginManager } from '../core/plugins/manager';
import { skillsManager } from '../core/skills/manager';
import { checkSkillBodySize, estimateTokenCount, validateSkillMetadata } from '../core/skills/skillStoreUtils';
import { DEFAULT_SHELL_COMMANDS } from '../../shared/contracts';

type RuntimeRegistryEntry = {
  runtime: AgentRuntime;
  signature: string;
};

type PendingRuntimeInitialization = {
  signature: string;
  promise: Promise<AgentRuntime>;
};

const runtimeRegistry = new Map<string, RuntimeRegistryEntry>();
const pendingRuntimeInitializations = new Map<string, PendingRuntimeInitialization>();

// Progressive Disclosure Level 1: Token-based budget for metadata injection.
// Claude Code standard: ~100 tokens per skill metadata, ~2000 tokens total for the catalog.
// We use token estimation instead of raw character count for cross-language accuracy.
const METADATA_BUDGET_TOKENS_PER_SKILL = 100;
const METADATA_BUDGET_TOKENS_TOTAL = 2000;

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

function isSupportedSkillScriptPath(resourcePath: string) {
  const normalizedPath = normalizeSkillRelativePath(resourcePath).toLowerCase();
  if (!normalizedPath.startsWith('scripts/')) {
    return false;
  }
  return SUPPORTED_SKILL_SCRIPT_EXTENSIONS.some((extension) => normalizedPath.endsWith(extension));
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

function normalizeSkillRelativePath(resourcePath: string) {
  const normalizedPath = resourcePath.trim().replace(/\\/g, '/');
  if (!normalizedPath || normalizedPath.startsWith('/') || normalizedPath.includes('..')) {
    return '';
  }
  return normalizedPath;
}

function getSkillResourceCategory(resourcePath: string) {
  if (isSupportedSkillScriptPath(resourcePath)) {
    return 'script';
  }
  if (resourcePath.startsWith('references/')) {
    return 'reference';
  }
  if (resourcePath.startsWith('assets/')) {
    return 'asset';
  }
  return 'file';
}

async function buildSkillCatalogSnapshot(agentId: string): Promise<SkillCatalogSnapshot> {
  const skills = await skillsManager.listMergedSkills(agentId);
  if (skills.length === 0) {
    return {
      fingerprint: 'empty',
      fullSummary: 'No skills available.',
      entries: []
    };
  }

  const prioritizedSkills = skills
    .slice()
    .sort((left, right) => {
      if (left.source !== right.source) {
        return left.source === 'agent' ? -1 : 1;
      }
      return left.id.localeCompare(right.id);
    });

  // Progressive Disclosure Level 1: Token-aware metadata budgeting.
  // Each skill entry is capped at ~100 tokens. Total catalog capped at ~2000 tokens.
  // Unlike character-based truncation, this ensures consistent behavior across
  // English and CJK text, matching Claude Code's ~100 tokens/skill standard.
  const entryRecords = prioritizedSkills.map((skill) => {
    const description = skill.description.replace(/\s+/g, ' ').trim();
    const versionText = skill.version ? ` | version: ${skill.version}` : '';
    const sourceText = ` | scope: ${skill.source}`;
    const prefix = `- ${skill.id}: `;
    const suffix = `${versionText}${sourceText}`;

    // Budget: ~100 tokens per entry. Reserve tokens for prefix + suffix.
    const prefixSuffixTokens = estimateTokenCount(prefix + suffix);
    const descriptionBudgetTokens = Math.max(20, METADATA_BUDGET_TOKENS_PER_SKILL - prefixSuffixTokens);
    const descriptionTokens = estimateTokenCount(description);

    // Trim description if it exceeds per-skill token budget
    let trimmedDescription = description;
    if (descriptionTokens > descriptionBudgetTokens) {
      // Estimate character count for the target token budget
      const targetChars = Math.floor(descriptionBudgetTokens * 3.5); // conservative estimate
      trimmedDescription = `${description.slice(0, targetChars).trimEnd()}…`;
    }

    return {
      id: skill.id,
      summary: `${prefix}${trimmedDescription}${suffix}`,
      tokens: estimateTokenCount(`${prefix}${trimmedDescription}${suffix}`)
    };
  });

  // Assemble catalog within total token budget
  const entries: string[] = [];
  let totalTokens = 0;

  for (const record of entryRecords) {
    if (totalTokens + record.tokens > METADATA_BUDGET_TOKENS_TOTAL) {
      // Budget exhausted — stop including more skills
      break;
    }
    entries.push(record.summary);
    totalTokens += record.tokens;
  }

  const omittedCount = entryRecords.length - entries.length;
  const omittedSuffix = omittedCount > 0
    ? `\n- ${omittedCount} more skills available (use load_skill by name).`
    : '';

  return {
    fingerprint: JSON.stringify(entryRecords.map((record) => record.summary)),
    fullSummary: entries.length > 0
      ? `${entries.join('\n')}${omittedSuffix}`
      : 'No skills available.',
    entries: entryRecords.map((record) => ({ id: record.id, summary: record.summary }))
  };
}

async function buildBaseSystemPrompt(agent: AgentConfig, workspace: string) {
  return PromptBuilder.buildSystemPrompt({
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
}

async function createLoadSkillTool(
  agentId: string,
  onSkillLoaded?: (payload: LoadedSkillCapability) => void
): Promise<ToolDefinition> {
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
      const skillFiles = await skillsManager.listSkillFiles(name, agentId);

      if (!metadata || !content || !skillPath) {
        return toolError(`Skill not found: ${name}`);
      }

      // Progressive Disclosure: Validate metadata quality (Claude Code schema compliance)
      const validation = validateSkillMetadata(metadata);
      if (!validation.valid) {
        console.warn(`[SkillLoader] Skill "${name}" has metadata issues: ${validation.errors.join('; ')}`);
      }
      if (validation.warnings.length > 0) {
        console.warn(`[SkillLoader] Skill "${name}" metadata warnings: ${validation.warnings.join('; ')}`);
      }

      // Progressive Disclosure: Check SKILL.md body size (< 5000 tokens recommended)
      const bodyCheck = checkSkillBodySize(content);
      if (!bodyCheck.withinLimit) {
        console.warn(`[SkillLoader] ${bodyCheck.warning}`);
      }

      const loadedAt = Date.now();
      const skillId = path.basename(skillPath);
      const aliases = [name, metadata.name, skillId]
        .filter((value, index, values): value is string => typeof value === 'string' && value.trim().length > 0 && values.indexOf(value) === index);
      onSkillLoaded?.({
        skillName: metadata.name || skillId || name,
        skillId,
        aliases,
        allowedTools: metadata.metadata.allowedTools,
        loadedAt,
        resourcePaths: skillFiles,
        scriptPaths: skillFiles.filter((filePath) => isSupportedSkillScriptPath(filePath))
      });

      const resources = skillFiles.map((resourcePath) => ({
        path: resourcePath,
        category: getSkillResourceCategory(resourcePath)
      }));

      return toolOk({
        id: skillId,
        name: metadata.name,
        description: metadata.description,
        version: metadata.metadata.version,
        allowedTools: metadata.metadata.allowedTools,
        loadedAt,
        content,
        // Progressive Disclosure Level 2: Only return instructions, not resource listing.
        // The LLM reads the SKILL.md body which references files by path.
        // It should use read_skill_resource or run_skill_script to access them on demand.
        resourceHint: 'Use read_skill_resource to read reference files or assets from this skill. Use run_skill_script to execute scripts in the scripts/ directory.',
        // Body size warning for observability
        ...(bodyCheck.withinLimit ? {} : { bodySizeWarning: bodyCheck.warning })
      });
    }
  };
}

function createReadSkillResourceTool(agentId: string, getRuntime: () => AgentRuntime | null): ToolDefinition {
  return {
    name: 'read_skill_resource',
    description: 'Read a file from an already loaded skill using a relative path inside that skill package.',
    parameters: z.object({
      skill: z.string().trim().min(1).describe('The skill name or skill directory name.'),
      path: z.string().trim().min(1).describe('A relative path inside the skill directory.')
    }),
    execute: async (args: Record<string, unknown>) => {
      const skill = String(args.skill ?? '').trim();
      const resourcePath = String(args.path ?? '').trim();
      const normalizedResourcePath = normalizeSkillRelativePath(resourcePath);
      if (!normalizedResourcePath || isInternalSkillResource(normalizedResourcePath)) {
        return toolError(`Skill resource is internal-only: ${skill}/${resourcePath}`);
      }
      const runtime = getRuntime();
      if (!runtime?.canAccessLoadedSkillResource(skill, normalizedResourcePath)) {
        return toolError(`Skill resource access requires loading the skill first via load_skill: ${skill}/${normalizedResourcePath}`);
      }
      const resource = await skillsManager.readSkillResource(skill, normalizedResourcePath, agentId);
      if (!resource) {
        return toolError(`Skill resource not found: ${skill}/${normalizedResourcePath}`);
      }
      return toolOk(resource);
    }
  };
}

function createRunSkillScriptTool(agentId: string, getRuntime: () => AgentRuntime | null): ToolDefinition {
  return {
    name: 'run_skill_script',
    description: 'Run a bundled script from an already loaded skill when that skill explicitly requires executable helper logic.',
    parameters: z.object({
      skill: z.string().trim().min(1).describe('The skill name or skill directory name.'),
      scriptPath: z.string().trim().min(1).describe('A relative path to the script inside the skill directory.'),
      args: z.array(z.string()).default([]).describe('Arguments passed to the skill script.')
    }),
    execute: async (args: Record<string, unknown>) => {
      try {
        const skill = String(args.skill ?? '').trim();
        const scriptPath = String(args.scriptPath ?? '').trim();
        const normalizedScriptPath = normalizeSkillRelativePath(scriptPath);
        const scriptArgs = Array.isArray(args.args)
          ? args.args.map((value) => String(value))
          : [];
        const runtime = getRuntime();

        if (!isSupportedSkillScriptPath(normalizedScriptPath)) {
          return toolError(`Skill scripts must live under scripts/ and use a supported extension (${SUPPORTED_SKILL_SCRIPT_EXTENSIONS.join(', ')}).`);
        }

        if (!normalizedScriptPath || !runtime?.canRunLoadedSkillScript(skill, normalizedScriptPath)) {
          return toolError(`Skill script access requires loading the skill first via load_skill: ${skill}/${scriptPath}`);
        }

        const allowed = await skillsManager.canUseAllowedTool(skill, 'run_skill_script', agentId);
        if (!allowed) {
          return toolError(`Skill ${skill} does not allow run_skill_script.`);
        }

        const absoluteScriptPath = await skillsManager.resolveResourcePath(skill, normalizedScriptPath, agentId);
        if (!absoluteScriptPath) {
          return toolError(`Skill script not found: ${skill}/${normalizedScriptPath}`);
        }

        const command = resolveSkillScriptCommand(absoluteScriptPath);
        const { stdout, stderr } = await execFileAsync(command, [absoluteScriptPath, ...scriptArgs], {
          cwd: path.dirname(absoluteScriptPath),
          maxBuffer: SKILL_SCRIPT_MAX_BUFFER_BYTES,
          windowsHide: true
        });

        return toolOk({
          command,
          scriptPath: absoluteScriptPath,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: 0
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return toolError(message);
      }
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

  let availableSkillsCatalog = await buildSkillCatalogSnapshot(agent.id);
  const baseSystemPrompt = await buildBaseSystemPrompt(agent, workspace);

  let runtimeRef: AgentRuntime | null = null;
  const runtime = new AgentRuntime(
    llm,
    permissions,
    workspace,
    baseSystemPrompt,
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
    async () => {
      const [nextPrompt, nextAvailableSkillsCatalog] = await Promise.all([
        buildBaseSystemPrompt(agent, workspace),
        buildSkillCatalogSnapshot(agent.id)
      ]);
      availableSkillsCatalog = nextAvailableSkillsCatalog;
      return nextPrompt;
    },
    () => ({
      availableSkillsCatalog
    })
  );
  runtimeRef = runtime;

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
  runtime.registerTool(HttpRequestTool as unknown as ToolDefinition);
  runtime.registerTool(await createLoadSkillTool(agent.id, (loadedSkill) => {
    runtime.activateLoadedSkill(loadedSkill);
  }));
  runtime.registerTool(createReadSkillResourceTool(agent.id, () => runtimeRef));
  runtime.registerTool(createRunSkillScriptTool(agent.id, () => runtimeRef));

  try {
    const dynamicTools = await pluginManager.loadAllTools(agent.id);
    for (const tool of dynamicTools) {
      runtime.registerTool(tool as unknown as ToolDefinition);
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

  const pending = pendingRuntimeInitializations.get(config.agent.id);
  if (pending && pending.signature === signature) {
    return pending.promise;
  }

  const initializationPromise = initializeAgent(config, sender)
    .finally(() => {
      const current = pendingRuntimeInitializations.get(config.agent.id);
      if (current?.promise === initializationPromise) {
        pendingRuntimeInitializations.delete(config.agent.id);
      }
    });

  pendingRuntimeInitializations.set(config.agent.id, {
    signature,
    promise: initializationPromise
  });

  return initializationPromise;
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
  pendingRuntimeInitializations.delete(agentId);
  runtimeRegistry.delete(agentId);
}

export {
  ensureAgentRuntime,
  initializeAgent,
  resolveAgentConfig,
  getAgentRuntime,
  removeAgentRuntime
};
