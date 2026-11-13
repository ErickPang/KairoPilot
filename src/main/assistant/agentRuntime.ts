import {createDelegationTool} from '../services/delegationService';
import {createPlanningTools} from '../core/agent/planningTools';
import {getRunById} from '../store/chat';
import {sessionApprovalPolicy} from '../store/approvalGrants';
import {getTaskPlan,updateTaskPlan} from '../store/taskPlans';
import {memorySnapshotPrompt} from '../services/projectMemoryService';
import {requireTask,settingsForTask} from '../services/taskSettingsService';
import { WORKBENCH_OWNER } from '../store/configWorkbench';
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
import {discoverInstructions} from '../core/instructions/agents';
import { PermissionGuard } from '../core/security/permissions';
import { guardForExecution } from '../core/security/executionContext';
import type { RunExecutionContext } from '../../shared/contracts';
import { SUPPORTED_SKILL_SCRIPT_EXTENSIONS } from '../core/security/policyConstants';
import { ReadFileTool, WriteFileTool, ListDirectoryTool, DeleteFileTool } from '../core/tools/filesystem';
import { createReadAttachmentTool } from '../core/tools/attachments';
import { toolError, toolOk } from '../core/tools/result';
import { createExecuteCommandTool } from '../core/tools/shell';
import { SystemInfoTool } from '../core/tools/system';
import { WebSearchTool, FetchWebpageTool, HttpRequestTool } from '../core/tools/web';
import { createCodebaseTools } from '../core/tools/codebase';
import { addAuditLog } from '../store/audit';
import { AgentConfig, ModelConfig } from '../store/config';
import { pluginManager } from '../core/plugins/manager';
import {createPluginDiscovery} from '../core/plugins/discovery';
import { skillsManager } from '../core/skills/manager';
import { resolveExplicitSkills } from '../core/skills/resolver';
import {
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
    executionContext: config.executionContext,
    model: {
      provider: model.provider || 'openai',
      baseUrl: model.baseUrl || '',
      contextWindowTokens:model.contextWindowTokens,
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
  executionContext?: RunExecutionContext;
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
  await skillsManager.getSkillCatalogSnapshot(agentId,{force:true});
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
    parameters: z.object({query:z.string().trim().max(200).optional(),offset:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(30).optional()}),
    execute: async (args) => {
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

      const query=String(args.query||'').toLowerCase();const offset=Number(args.offset)||0;const limit=Number(args.limit)||20;
      const eligible=mergedSkills.filter(skill=>skill.userInvocable!==false||skill.modelInvocable!==false);
      const matching=eligible.filter(skill=>`${skill.id} ${skill.name} ${skill.description} ${skill.whenToUse}`.toLowerCase().includes(query));
      return toolOk({
        pagination:{offset,limit,total:matching.length,nextOffset:offset+limit<matching.length?offset+limit:null},
        counts: {
          public: visiblePublicSkills.length,
          agent: visibleAgentSkills.length,
          totalAvailable: visibleMergedSkills.length,
          hidden: hiddenSkills.length
        },
        publicSkills: visiblePublicSkills.filter(skill=>matching.slice(offset,offset+limit).some(item=>item.id===skill.id)).map(toToolPayload),
        agentSkills: visibleAgentSkills.filter(skill=>matching.slice(offset,offset+limit).some(item=>item.id===skill.id)).map(toToolPayload),
        availableSkills: matching.slice(offset,offset+limit).map(toToolPayload)
      });
    }
  };
}

async function buildBaseSystemPrompt(agent: AgentConfig, workspace: string) {
  if(agent.instructionSources){const current=discoverInstructions(agent.instructionRoot||agent.workspace,workspace).map(({path,hash,scope})=>({path,hash,scope}));if(JSON.stringify(current)!==JSON.stringify(agent.instructionSources))throw new Error('AGENTS.md changed during this run. Start a new run.');}
  return PromptBuilder.buildSystemPrompt({workspace,instructions:agent.systemPrompt});
}

async function resolveInitialSkillsForRun(userInput: string, agentId: string): Promise<LoadedSkillCapability[]> {
  const skills = await skillsManager.listMergedSkills(agentId);
  const selectedSkills = resolveExplicitSkills(userInput, skills);
  addAuditLog({tool:'skill_resolver',args:{agentId},result:{selectedSkillIds:selectedSkills.map(skill=>skill.id),reason:'explicit_user_invocation'},policyTags:['skill:resolver']});

  const loadedSkills: LoadedSkillCapability[] = []
  for (const selectedSkill of selectedSkills) {
    let resolvedSkill: ResolvedSkillLoad | null = null
    try {
      resolvedSkill = await resolveSkillLoad(selectedSkill.id, agentId)
    } catch (error) {
      console.warn(`[Skills] Failed to auto-load skill ${selectedSkill.id}:`, error)
      throw new Error(`Failed to load requested skill "${selectedSkill.id}": ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!resolvedSkill) {
      throw new Error(`Failed to load requested skill "${selectedSkill.id}": skill is no longer available.`)
    }

    loadedSkills.push({
      skillName: resolvedSkill.metadata.name || resolvedSkill.skillId,
      skillId: resolvedSkill.skillId,
      contentHash: resolvedSkill.contentHash,
      source: resolvedSkill.source,
      aliases: [selectedSkill.id, selectedSkill.name, resolvedSkill.skillId]
        .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index),
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
      resolverReasons: ['explicit_user_invocation'],
      explicitMention: true,
      loadedAt: resolvedSkill.loadedAt,
      scopeRevision: resolvedSkill.scopeRevision,
      resourcePaths: resolvedSkill.skillFiles,
      scriptPaths: resolvedSkill.skillFiles.filter((filePath) => isSupportedSkillScriptPath(filePath))
    })
  }

  return loadedSkills
}

async function createLoadSkillTool(
  agentId: string,
  onSkillLoaded?: (payload: LoadedSkillCapability) => void,
  getUserInput: () => string = () => ''
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

      const explicitlyInvoked = resolveExplicitSkills(getUserInput(), [{...resolvedSkill.metadata,id:resolvedSkill.skillId} as SkillSummary]).length > 0;
      if (resolvedSkill.metadata.modelInvocable === false && !explicitlyInvoked) {
        return toolError(`Skill ${name} requires an explicit user invocation.`);
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
        activationSource: explicitlyInvoked ? 'manual' : 'automatic',
        allowedTools: resolvedSkill.metadata.allowedTools,
        resolvedArguments: resolvedSkill.resolvedArguments,
        resolverReasons: [explicitlyInvoked ? 'explicit_user_invocation' : 'model_selected'],
        explicitMention: explicitlyInvoked,
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
        contentHash:resolvedSkill.contentHash,
        source:resolvedSkill.source,
        instructionStatus:'Full instructions are loaded into the dedicated skill context on the next inference; resources remain on demand.',
        resources
      });
    }
  };
}

async function assertLoadedSkillRevision(skill:string,agentId:string,runtime:AgentRuntime){
 const loaded=runtime.getLoadedSkillCapability(skill);if(!loaded)throw new Error('Load the skill before reading resources.');
 const current=await resolveSkillLoad(skill,agentId,loaded.resolvedArguments||{});
 if(!current||current.contentHash!==loaded.contentHash)throw new Error('Skill instructions or invocation policy changed after loading. Load the skill again before using resources.');
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
      await assertLoadedSkillRevision(skill,agentId,runtime);
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
  permissionGuard: PermissionGuard,
  executionWorkspace: string
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

        await assertLoadedSkillRevision(skill,agentId,runtime);
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
        const skillScriptStartedAt = Date.now();
        const { stdout, stderr } = await execFileAsync(command, [absoluteScriptPath, ...scriptArgs], {
          cwd: executionWorkspace,
          maxBuffer: Math.min(shellPolicy.maxBufferBytes, SKILL_SCRIPT_MAX_BUFFER_BYTES),
          windowsHide: true,
          timeout: shellPolicy.timeoutMs
        });

        const elapsedMs = Date.now() - skillScriptStartedAt;
        if (elapsedMs > 200) {
          console.warn(`[perf] skill script ${path.basename(absoluteScriptPath)} took ${elapsedMs}ms (threshold: 200ms)`);
        }

        return toolOk({
          skill,
          relativeScriptPath: normalizedScriptPath,
          command,
          args: scriptArgs,
          scriptPath: absoluteScriptPath,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: 0,
          elapsedMs
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

  runtime.registerTool(ReadFileTool);
  runtime.registerTool(createReadAttachmentTool(() => runtime.getActiveSessionId()));
  runtime.registerTool(WriteFileTool);
  runtime.registerTool(ListDirectoryTool);
  runtime.registerTool(DeleteFileTool);
  runtime.registerTool(createExecuteCommandTool({
    cwd: workspace,
    policy: permissions.getShellExecutionPolicy()
  }));
  runtime.registerTool(SystemInfoTool);
  runtime.registerTool(WebSearchTool);
  runtime.registerTool(FetchWebpageTool);
  runtime.registerTool(HttpRequestTool);
  createCodebaseTools(workspace, permissions).forEach((tool) => runtime.registerTool(tool));
  runtime.registerTool(createListAvailableSkillsTool(agentId));
  runtime.registerTool(await createLoadSkillTool(agentId, (loadedSkill) => {
    runtime.activateLoadedSkill(loadedSkill);
  }, () => {const id=runtime.getActiveRunId();return id?getRunById(id)?.userInput||'':'';}));
  runtime.registerTool(createReadSkillResourceTool(agentId, runtimeRef));
  runtime.registerTool(createRunSkillScriptTool(agentId, runtimeRef, permissions, workspace));

  const discovery=createPluginDiscovery(agentId,permissions,tool=>runtime.registerTool(tool),()=>runtime.getActiveSessionId());
  runtime.registerTool(discovery.search);
  runtime.setDeferredToolLoader(discovery.load);
}

async function initializeAgent(config: ResolvedAgentConfig, sender?: WebContents) {
  void sender;
  const { agent, model } = config;
  const planning=config.executionContext?.phase==='planning';
  const signature = createRuntimeSignature(config);
  const workspace = config.executionContext?.executionRoot || path.resolve(agent.workspace);
  const permissions = guardForExecution(agent, config.executionContext);
  if (config.executionContext?.sessionId) permissions.bindSessionApprovals(sessionApprovalPolicy(config.executionContext.sessionId, permissions.getApprovalContextKey()));

  const llm = createLLMProvider({
    provider: model.provider || 'openai',
    apiKey: model.apiKey,
    baseUrl: model.baseUrl,
    contextWindowTokens:model.contextWindowTokens,
    model: model.model || 'gpt-3.5-turbo'
  });

  const pluginSummary=async()=>{
    if(planning||permissions.getExecutionProfile()==='chat_only')return '';
    const catalog=await pluginManager.listToolCatalog(WORKBENCH_OWNER,permissions,config.executionContext?.sessionId);
    const groups=Array.from(new Map(catalog.map(item=>[`${item.scope}:${item.pluginId}`,`- ${item.pluginId}: ${item.pluginDescription.slice(0,180)}`])).values());
    return `Plugin capabilities (use search_tools to discover schemas; discovery runs no actions):\n${groups.slice(0,20).join('\n')}\n${groups.length>20?'More plugins are searchable.':''}`;
  };
  let availablePluginsSummary=await pluginSummary();
  let availableSkillsCatalog: SkillCatalogSnapshot = await skillsManager.getSkillCatalogSnapshot(WORKBENCH_OWNER);
  const snapshotPrompt=memorySnapshotPrompt(config.executionContext?.memorySnapshot);
  const baseSystemPrompt = await buildBaseSystemPrompt(agent, workspace)+snapshotPrompt;

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
      const [nextPrompt, nextAvailableSkillsCatalog,nextPluginsSummary] = await Promise.all([
        buildBaseSystemPrompt(agent, workspace),
        skillsManager.getSkillCatalogSnapshot(WORKBENCH_OWNER),pluginSummary()
      ]);
      availableSkillsCatalog = nextAvailableSkillsCatalog;availablePluginsSummary=nextPluginsSummary;
      return nextPrompt+snapshotPrompt;
    },
    () => planning||permissions.getExecutionProfile()==='chat_only' ? {} : ({availableSkillsCatalog,availablePluginsSummary}),
    planning||permissions.getExecutionProfile()==='chat_only' ? undefined : (userInput, runtimeAgentId) => resolveInitialSkillsForRun(userInput, runtimeAgentId),
    agent.workspace
  );
  runtimeRef = runtime;

  try {
    if(planning){
      createPlanningTools(workspace,permissions,entry=>{
        const runId=runtime.getActiveRunId();const planId=runId?getRunById(runId)?.executionContext?.planId:undefined;
        const plan=planId?getTaskPlan(planId):null;
        if(!plan||plan.status!=='planning')throw new Error('Planning evidence is unavailable.');
        const entries=plan.investigations||[];
        if(entries.length>=32)throw new Error('Planning investigation limit reached. Summarize existing evidence.');
        updateTaskPlan(plan.id,plan.revision,{investigations:[...entries,entry]});
      }).forEach(tool=>runtime.registerTool(tool));
      runtime.registerTool(createReadAttachmentTool(()=>runtime.getActiveSessionId()));
    }
    if(!planning)await registerRuntimeTools({
      runtime,
      runtimeRef: () => runtimeRef,
      agentId: WORKBENCH_OWNER,
      workspace,
      permissions
    });
  } catch (error) {
    console.error('Failed to register runtime tools:', error);
  }

  const taskId=config.executionContext?.sessionId;
  if(!planning&&permissions.getExecutionProfile()!=='chat_only'&&taskId&&config.executionContext&&settingsForTask(requireTask(taskId)).delegation!=='off') {
    runtime.registerTool(createDelegationTool(taskId,()=>runtime.getActiveRunId(),config.executionContext));
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

function getAgentRuntime(agentId: string) {
  return runtimeRegistry.get(agentId)?.runtime || null;
}

function removeAgentRuntime(agentId: string) {
  pendingRuntimeInitializations.delete(agentId);
  runtimeRegistry.delete(agentId);
}

export function clearAgentRuntimes() { runtimeRegistry.clear(); pendingRuntimeInitializations.clear(); }

export async function cancelActiveAgentRuntimes() {
  await Promise.all([...runtimeRegistry.values()].map(async ({ runtime }) => {
    const id = runtime.getActiveRunId();
    if (id && getRunById(id)?.status === 'running') await runtime.cancelRun(id);
  }));
}

export {
  ensureAgentRuntime,
  initializeAgent,
  getAgentRuntime,
  removeAgentRuntime
};
