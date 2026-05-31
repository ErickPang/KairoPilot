import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
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
import { createReadAttachmentTool } from '../core/tools/attachments';
import { toolError, toolOk } from '../core/tools/result';
import { createExecuteCommandTool } from '../core/tools/shell';
import { SystemInfoTool } from '../core/tools/system';
import { WebSearchTool, FetchWebpageTool, HttpRequestTool } from '../core/tools/web';
import { addAuditLog } from '../store/audit';
import { AgentConfig, ModelConfig, getAgent, getModelForAgent } from '../store/config';
import { pluginManager } from '../core/plugins/manager';
import { skillsManager } from '../core/skills/manager';
import { resolveRelevantSkills } from '../core/skills/resolver';
import {
  DEFAULT_SHELL_COMMANDS,
  SkillMetadata,
  SkillSummary
} from '../../shared/contracts';

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

interface SkillArgumentResolution {
  resolvedArguments: Record<string, string>;
  missingRequiredArguments: string[];
}

interface ResolvedSkillLoad {
  metadata: SkillMetadata;
  renderedContent: string;
  resolvedArguments: Record<string, string>;
  skillId: string;
  skillPath: string;
  skillFiles: string[];
  contentHash: string;
  source: string;
  loadedAt: number;
  scopeRevision: string;
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

function deriveSkillInvocationMode(metadata: Pick<SkillMetadata, 'userInvocable' | 'modelInvocable'>) {
  if (metadata.modelInvocable === false) {
    return metadata.userInvocable === false ? 'hidden' : 'manual_only';
  }
  return metadata.userInvocable === false ? 'hidden_auto' : 'auto';
}

function resolveSkillArguments(
  metadata: Pick<SkillMetadata, 'arguments'>,
  rawArguments: Record<string, unknown>
): SkillArgumentResolution {
  const resolvedArguments: Record<string, string> = {};
  const missingRequiredArguments: string[] = [];
  const declaredArguments = new Map(metadata.arguments.map((argument) => [argument.name, argument]));

  for (const argument of metadata.arguments) {
    const rawValue = rawArguments[argument.name];
    const normalizedValue = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (normalizedValue) {
      resolvedArguments[argument.name] = normalizedValue;
      continue;
    }

    if (typeof argument.defaultValue === 'string' && argument.defaultValue.trim()) {
      resolvedArguments[argument.name] = argument.defaultValue.trim();
      continue;
    }

    if (argument.required) {
      missingRequiredArguments.push(argument.name);
    }
  }

  for (const [key, value] of Object.entries(rawArguments)) {
    if (typeof value !== 'string' || !value.trim() || declaredArguments.has(key)) {
      continue;
    }
    resolvedArguments[key] = value.trim();
  }

  return {
    resolvedArguments,
    missingRequiredArguments
  };
}

function renderSkillTemplate(content: string, resolvedArguments: Record<string, string>) {
  return content.replace(/\{\{\s*([a-zA-Z0-9._-]+)\s*\}\}/g, (match, key: string) => {
    return Object.prototype.hasOwnProperty.call(resolvedArguments, key)
      ? resolvedArguments[key]
      : match;
  });
}

function hashSkillContent(content: string) {
  return createHash('sha256').update(content).digest('hex');
}

async function resolveSkillLoad(
  skillName: string,
  agentId: string,
  rawArguments: Record<string, unknown> = {}
): Promise<ResolvedSkillLoad | null> {
  const skillRecord = await skillsManager.getSkillRecord(skillName, agentId);
  if (!skillRecord) {
    return null;
  }

  const skillFiles = await skillsManager.listSkillFilesForRecord(skillRecord);
  const metadata = skillRecord.metadata;
  const content = skillRecord.content;
  const skillPath = skillRecord.skillDir;

  const { resolvedArguments, missingRequiredArguments } = resolveSkillArguments(metadata, rawArguments);
  if (missingRequiredArguments.length > 0) {
    throw new Error(`Missing required skill arguments: ${missingRequiredArguments.join(', ')}`);
  }

  return {
    metadata,
    renderedContent: renderSkillTemplate(content, resolvedArguments),
    resolvedArguments,
    skillId: path.basename(skillPath),
    skillPath,
    skillFiles,
    contentHash: skillRecord.contentHash,
    source: skillRecord.scope,
    loadedAt: Date.now(),
    scopeRevision: skillsManager.getSkillScopeRevision(agentId)
  };
}

export function createListAvailableSkillsTool(agentId: string): ToolDefinition {
  return {
    name: 'list_available_skills',
    description: 'List currently available skills for this agent, including public skills and agent-specific skills.',
    parameters: z.object({}),
    execute: async () => {
      const [publicSkills, agentSkills, mergedSkills] = await Promise.all([
        skillsManager.listPublicSkills(),
        skillsManager.listAgentSkills(agentId),
        skillsManager.listMergedSkills(agentId)
      ]);
      const visiblePublicSkills = publicSkills.filter((skill) => skill.userInvocable !== false);
      const visibleAgentSkills = agentSkills.filter((skill) => skill.userInvocable !== false);
      const visibleMergedSkills = mergedSkills.filter((skill) => skill.userInvocable !== false);
      const hiddenSkills = mergedSkills.filter((skill) => skill.userInvocable === false);
      const toToolPayload = (skill: SkillSummary) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        whenToUse: skill.whenToUse,
        source: skill.source,
        invocation: deriveSkillInvocationMode(skill),
        executionMode: skill.executionMode,
        allowedTools: skill.allowedTools
      });

      return toolOk({
        counts: {
          public: visiblePublicSkills.length,
          agent: visibleAgentSkills.length,
          totalAvailable: visibleMergedSkills.length,
          hidden: hiddenSkills.length
        },
        publicSkills: visiblePublicSkills.map(toToolPayload),
        agentSkills: visibleAgentSkills.map(toToolPayload),
        availableSkills: visibleMergedSkills.map(toToolPayload)
      });
    }
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

async function resolveInitialSkillsForRun(userInput: string, agentId: string): Promise<LoadedSkillCapability[]> {
  const skills = await skillsManager.listMergedSkills(agentId);
  const candidates = resolveRelevantSkills(userInput, skills, {
    maxResults: 2,
    autoLoadThreshold: 18
  });

  const selectedCandidates = candidates.filter((candidate, index) => (
    candidate.explicitMention
    || candidate.score >= 26
    || index === 0
  ));
  addAuditLog({
    tool: 'skill_resolver',
    args: {
      agentId,
      inputPreview: userInput.slice(0, 240),
      candidateCount: candidates.length,
      selectedCount: selectedCandidates.length
    },
    result: {
      candidates: candidates.map((candidate) => ({
        skillId: candidate.skill.id,
        skillName: candidate.skill.name,
        score: candidate.score,
        explicitMention: candidate.explicitMention,
        reasons: candidate.reasons
      })),
      selectedSkillIds: selectedCandidates.map((candidate) => candidate.skill.id)
    },
    policyTags: ['skill:resolver']
  });

  const loadedSkills: LoadedSkillCapability[] = []
  for (const candidate of selectedCandidates) {
    let resolvedSkill: ResolvedSkillLoad | null = null
    try {
      resolvedSkill = await resolveSkillLoad(candidate.skill.id, agentId)
    } catch (error) {
      console.warn(`[Skills] Failed to auto-load skill ${candidate.skill.id}:`, error)
      continue
    }
    if (!resolvedSkill) {
      continue
    }

    loadedSkills.push({
      skillName: resolvedSkill.metadata.name || resolvedSkill.skillId,
      skillId: resolvedSkill.skillId,
      contentHash: resolvedSkill.contentHash,
      source: resolvedSkill.source,
      aliases: [candidate.skill.id, candidate.skill.name, resolvedSkill.skillId]
        .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index),
      description: resolvedSkill.metadata.description,
      whenToUse: resolvedSkill.metadata.whenToUse,
      instructions: resolvedSkill.renderedContent,
      arguments: resolvedSkill.metadata.arguments,
      userInvocable: resolvedSkill.metadata.userInvocable,
      modelInvocable: resolvedSkill.metadata.modelInvocable,
      executionMode: resolvedSkill.metadata.executionMode,
      activationSource: 'automatic',
      allowedTools: resolvedSkill.metadata.allowedTools,
      resolvedArguments: resolvedSkill.resolvedArguments,
      resolverScore: candidate.score,
      resolverReasons: candidate.reasons,
      explicitMention: candidate.explicitMention,
      loadedAt: resolvedSkill.loadedAt,
      scopeRevision: resolvedSkill.scopeRevision,
      resourcePaths: resolvedSkill.skillFiles,
      scriptPaths: resolvedSkill.skillFiles.filter((filePath) => isSupportedSkillScriptPath(filePath))
    })
  }

  return loadedSkills
}

async function reloadRetainedSkillsForSession(
  skills: LoadedSkillCapability[],
  agentId: string
): Promise<LoadedSkillCapability[]> {
  const currentScopeRevision = skillsManager.getSkillScopeRevision(agentId);
  if (skills.every((skill) => skill.scopeRevision === currentScopeRevision)) {
    return skills;
  }

  const refreshedSkills: LoadedSkillCapability[] = [];

  for (const skill of skills) {
    const skillReference = skill.skillId || skill.skillName;
    const resolvedSkill = await resolveSkillLoad(skillReference, agentId, skill.resolvedArguments ?? {});
    if (!resolvedSkill) {
      continue;
    }

    refreshedSkills.push({
      skillName: resolvedSkill.metadata.name || resolvedSkill.skillId,
      skillId: resolvedSkill.skillId,
      contentHash: resolvedSkill.contentHash,
      source: resolvedSkill.source,
      aliases: skill.aliases,
      description: resolvedSkill.metadata.description,
      whenToUse: resolvedSkill.metadata.whenToUse,
      instructions: resolvedSkill.renderedContent,
      arguments: resolvedSkill.metadata.arguments,
      userInvocable: resolvedSkill.metadata.userInvocable,
      modelInvocable: resolvedSkill.metadata.modelInvocable,
      executionMode: resolvedSkill.metadata.executionMode,
      activationSource: skill.activationSource === 'automatic' ? 'automatic' : 'manual',
      allowedTools: resolvedSkill.metadata.allowedTools,
      resolvedArguments: resolvedSkill.resolvedArguments,
      resolverScore: skill.resolverScore,
      resolverReasons: skill.resolverReasons ? [...skill.resolverReasons] : undefined,
      explicitMention: skill.explicitMention,
      loadedAt: resolvedSkill.loadedAt,
      scopeRevision: resolvedSkill.scopeRevision,
      resourcePaths: resolvedSkill.skillFiles,
      scriptPaths: resolvedSkill.skillFiles.filter((filePath) => isSupportedSkillScriptPath(filePath))
    });
  }

  return refreshedSkills;
}

async function createLoadSkillTool(
  agentId: string,
  onSkillLoaded?: (payload: LoadedSkillCapability) => void
): Promise<ToolDefinition> {
  return {
    name: 'load_skill',
    description: 'Load the instructions of a matching skill by name before executing a skill-guided workflow.',
    parameters: z.object({
      name: z.string().trim().min(1).describe('The skill name or skill directory name.'),
      arguments: z.record(z.string(), z.string()).optional().describe('Optional skill arguments used to render templated instructions.')
    }),
    execute: async (args: Record<string, unknown>) => {
      const name = String(args.name ?? '').trim();
      const resolvedSkill = await resolveSkillLoad(
        name,
        agentId,
        args.arguments && typeof args.arguments === 'object' ? args.arguments as Record<string, unknown> : {}
      );

      if (!resolvedSkill) {
        return toolError(`Skill not found: ${name}`);
      }

      if (resolvedSkill.metadata.userInvocable === false) {
        return toolError(`Skill ${name} is not user-invocable.`);
      }

      const aliases = [name, resolvedSkill.metadata.name, resolvedSkill.skillId]
        .filter((value, index, values): value is string => typeof value === 'string' && value.trim().length > 0 && values.indexOf(value) === index);
      onSkillLoaded?.({
        skillName: resolvedSkill.metadata.name || resolvedSkill.skillId || name,
        skillId: resolvedSkill.skillId,
        contentHash: resolvedSkill.contentHash,
        source: resolvedSkill.source,
        aliases,
        description: resolvedSkill.metadata.description,
        whenToUse: resolvedSkill.metadata.whenToUse,
        instructions: resolvedSkill.renderedContent,
        arguments: resolvedSkill.metadata.arguments,
        userInvocable: resolvedSkill.metadata.userInvocable,
        modelInvocable: resolvedSkill.metadata.modelInvocable,
        executionMode: resolvedSkill.metadata.executionMode,
        activationSource: 'manual',
        allowedTools: resolvedSkill.metadata.allowedTools,
        resolvedArguments: resolvedSkill.resolvedArguments,
        resolverReasons: ['manual_load_skill'],
        explicitMention: true,
        loadedAt: resolvedSkill.loadedAt,
        scopeRevision: resolvedSkill.scopeRevision,
        resourcePaths: resolvedSkill.skillFiles,
        scriptPaths: resolvedSkill.skillFiles.filter((filePath) => isSupportedSkillScriptPath(filePath))
      });

      const resources = resolvedSkill.skillFiles.map((resourcePath) => ({
        path: resourcePath,
        category: getSkillResourceCategory(resourcePath)
      }));

      return toolOk({
        id: resolvedSkill.skillId,
        name: resolvedSkill.metadata.name,
        description: resolvedSkill.metadata.description,
        version: resolvedSkill.metadata.version,
        whenToUse: resolvedSkill.metadata.whenToUse,
        argumentDefinitions: resolvedSkill.metadata.arguments,
        resolvedArguments: resolvedSkill.resolvedArguments,
        invocation: {
          userInvocable: resolvedSkill.metadata.userInvocable,
          modelInvocable: resolvedSkill.metadata.modelInvocable
        },
        executionMode: resolvedSkill.metadata.executionMode,
        allowedTools: resolvedSkill.metadata.allowedTools,
        loadedAt: resolvedSkill.loadedAt,
        content: resolvedSkill.renderedContent,
        resources
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
      const activeSkill = runtime.getLoadedSkillCapability(skill);
      const renderedContent = activeSkill?.resolvedArguments
        ? renderSkillTemplate(resource.content, activeSkill.resolvedArguments)
        : resource.content;
      return toolOk({
        ...resource,
        skill: activeSkill?.skillId || skill,
        skillName: activeSkill?.skillName || skill,
        skillContentHash: activeSkill?.contentHash,
        relativePath: normalizedResourcePath,
        sizeBytes: Buffer.byteLength(renderedContent, 'utf-8'),
        contentHash: hashSkillContent(renderedContent),
        content: renderedContent
      });
    }
  };
}

function createRunSkillScriptTool(
  agentId: string,
  getRuntime: () => AgentRuntime | null,
  permissionGuard: PermissionGuard
): ToolDefinition {
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
        const shellPolicy = permissionGuard.getShellExecutionPolicy();
        const { stdout, stderr } = await execFileAsync(command, [absoluteScriptPath, ...scriptArgs], {
          cwd: path.dirname(absoluteScriptPath),
          maxBuffer: Math.min(shellPolicy.maxBufferBytes, SKILL_SCRIPT_MAX_BUFFER_BYTES),
          windowsHide: true,
          timeout: shellPolicy.timeoutMs
        });

        return toolOk({
          skill,
          relativeScriptPath: normalizedScriptPath,
          command,
          args: scriptArgs,
          scriptPath: absoluteScriptPath,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: 0
        });
      } catch (error) {
        const err = error as { stdout?: string | Buffer; stderr?: string | Buffer; code?: number; message?: string };
        const message = typeof err?.message === 'string' ? err.message : 'Unknown error';
        return toolError(message, {
          stdout: String(err?.stdout || '').trim(),
          stderr: String(err?.stderr || '').trim() || message,
          exitCode: err?.code || 1
        });
      }
    }
  };
}

async function registerRuntimeTools(params: {
  runtime: AgentRuntime;
  runtimeRef: () => AgentRuntime | null;
  agentId: string;
  workspace: string;
  permissions: PermissionGuard;
}) {
  const {
    runtime,
    runtimeRef,
    agentId,
    workspace,
    permissions
  } = params;

  runtime.registerTool(ReadFileTool as unknown as ToolDefinition);
  runtime.registerTool(createReadAttachmentTool(() => runtime.getActiveSessionId()));
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
  runtime.registerTool(createListAvailableSkillsTool(agentId));
  runtime.registerTool(await createLoadSkillTool(agentId, (loadedSkill) => {
    runtime.activateLoadedSkill(loadedSkill);
  }));
  runtime.registerTool(createReadSkillResourceTool(agentId, runtimeRef));
  runtime.registerTool(createRunSkillScriptTool(agentId, runtimeRef, permissions));

  const dynamicTools = await pluginManager.loadAllTools(agentId, permissions);
  for (const tool of dynamicTools) {
    runtime.registerTool(tool as unknown as ToolDefinition);
  }
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

  let availableSkillsCatalog: SkillCatalogSnapshot = await skillsManager.getSkillCatalogSnapshot(agent.id);
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
        skillsManager.getSkillCatalogSnapshot(agent.id)
      ]);
      availableSkillsCatalog = nextAvailableSkillsCatalog;
      return nextPrompt;
    },
    () => ({
      availableSkillsCatalog
    }),
    (userInput, runtimeAgentId) => resolveInitialSkillsForRun(userInput, runtimeAgentId),
    (skills, runtimeAgentId) => reloadRetainedSkillsForSession(skills, runtimeAgentId)
  );
  runtimeRef = runtime;

  try {
    await registerRuntimeTools({
      runtime,
      runtimeRef: () => runtimeRef,
      agentId: agent.id,
      workspace,
      permissions
    });
  } catch (error) {
    console.error('Failed to register runtime tools:', error);
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
