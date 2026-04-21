import type { ToolDefinition } from '../llm/types';
import { PermissionGuard } from '../security/permissions';
import { matchesAllowedToolName, resolveAllowedToolToRegisteredNames } from '../skills/skillStoreUtils';

export interface LoadedSkillCapability {
  skillName: string;
  skillId?: string;
  aliases?: string[];
  allowedTools: string[];
  loadedAt: number;
  resourcePaths?: string[];
  scriptPaths?: string[];
}

const ALWAYS_EXPOSED_TOOL_NAMES = new Set([
  'load_skill'
]);

const ACTIVE_SKILL_EXPOSED_TOOL_NAMES = new Set([
  'read_skill_resource'
]);

const SKILL_SESSION_TOOL_NAMES = new Set([
  'read_skill_resource',
  'run_skill_script'
]);

const FILESYSTEM_READ_TOOL_NAMES = new Set([
  'read_file',
  'list_directory'
]);

const FILESYSTEM_WRITE_TOOL_NAMES = new Set([
  'write_file',
  'delete_file'
]);

const NETWORK_TOOL_NAMES = new Set([
  'web_search',
  'fetch_webpage',
  'http_request'
]);

const SHELL_TOOL_NAMES = new Set([
  'execute_command',
  'run_skill_script'
]);

export class CapabilityOrchestrator {
  private permissionGuard: PermissionGuard;
  private tools = new Map<string, ToolDefinition>();
  private loadedSkills = new Map<string, LoadedSkillCapability>();

  constructor(permissionGuard: PermissionGuard) {
    this.permissionGuard = permissionGuard;
  }

  registerTool(tool: ToolDefinition) {
    this.tools.set(tool.name, tool);
  }

  clearLoadedSkills() {
    this.loadedSkills.clear();
  }

  setLoadedSkills(skills: LoadedSkillCapability[]) {
    this.loadedSkills.clear();
    for (const skill of skills) {
      this.activateSkill(skill);
    }
  }

  activateSkill(
    skillOrCapability: LoadedSkillCapability | string,
    allowedTools: string[] = [],
    loadedAt: number = Date.now()
  ) {
    const capability = typeof skillOrCapability === 'string'
      ? {
          skillName: skillOrCapability,
          allowedTools,
          loadedAt
        }
      : skillOrCapability;
    const normalizedSkillName = capability.skillName.trim();
    if (!normalizedSkillName) {
      return;
    }

    const skillId = typeof capability.skillId === 'string' && capability.skillId.trim()
      ? capability.skillId.trim()
      : undefined;
    const aliases = Array.from(new Set([
      normalizedSkillName,
      ...(skillId ? [skillId] : []),
      ...((capability.aliases ?? []).map((alias) => alias.trim()).filter(Boolean))
    ]));
    const resourcePaths = Array.from(new Set((capability.resourcePaths ?? []).map((resourcePath) => resourcePath.trim()).filter(Boolean)));
    const scriptPaths = Array.from(new Set((capability.scriptPaths ?? []).map((scriptPath) => scriptPath.trim()).filter(Boolean)));
    const capabilityKey = skillId ?? normalizedSkillName;

    this.loadedSkills.set(capabilityKey, {
      skillName: normalizedSkillName,
      skillId,
      aliases,
      allowedTools: Array.from(new Set(capability.allowedTools.map((toolName) => toolName.trim()).filter(Boolean))),
      loadedAt: capability.loadedAt ?? loadedAt,
      resourcePaths,
      scriptPaths
    });
  }

  getLoadedSkills(): LoadedSkillCapability[] {
    return Array.from(this.loadedSkills.values()).map((skill) => ({
      skillName: skill.skillName,
      skillId: skill.skillId,
      aliases: skill.aliases ? [...skill.aliases] : undefined,
      allowedTools: [...skill.allowedTools],
      loadedAt: skill.loadedAt,
      resourcePaths: skill.resourcePaths ? [...skill.resourcePaths] : undefined,
      scriptPaths: skill.scriptPaths ? [...skill.scriptPaths] : undefined
    }));
  }

  isSkillLoaded(skillReference: string) {
    return this.getLoadedSkill(skillReference) !== null;
  }

  canAccessLoadedSkillResource(skillReference: string, resourcePath: string) {
    const skill = this.getLoadedSkill(skillReference);
    if (!skill) {
      return false;
    }
    const normalizedPath = this.normalizeRelativeSkillPath(resourcePath);
    if (!normalizedPath) {
      return false;
    }
    return (skill.resourcePaths ?? []).includes(normalizedPath);
  }

  canRunLoadedSkillScript(skillReference: string, scriptPath: string) {
    const skill = this.getLoadedSkill(skillReference);
    if (!skill) {
      return false;
    }
    const normalizedPath = this.normalizeRelativeSkillPath(scriptPath);
    if (!normalizedPath) {
      return false;
    }
    return (skill.scriptPaths ?? []).includes(normalizedPath);
  }

  getRegisteredTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getExposedTools(): ToolDefinition[] {
    const permissionEligibleTools = this.getRegisteredTools().filter((tool) => this.isToolEnabledByPermissions(tool.name));
    if (permissionEligibleTools.length === 0) {
      return [];
    }

    const activeSkills = this.getLoadedSkills();
    if (activeSkills.length === 0) {
      return permissionEligibleTools.filter((tool) => !SKILL_SESSION_TOOL_NAMES.has(tool.name));
    }

    if (activeSkills.some((skill) => skill.allowedTools.some((toolName) => matchesAllowedToolName(toolName, '*')))) {
      return permissionEligibleTools;
    }

    const registeredToolNames = permissionEligibleTools.map((tool) => tool.name);
    const allowedToolNames = new Set<string>();

    for (const skill of activeSkills) {
      for (const allowedToolName of skill.allowedTools) {
        for (const resolvedToolName of resolveAllowedToolToRegisteredNames(allowedToolName, registeredToolNames)) {
          allowedToolNames.add(resolvedToolName);
        }
      }
    }

    return permissionEligibleTools.filter((tool) => (
      ALWAYS_EXPOSED_TOOL_NAMES.has(tool.name)
      || ACTIVE_SKILL_EXPOSED_TOOL_NAMES.has(tool.name)
      || allowedToolNames.has(tool.name)
    ));
  }

  private isToolEnabledByPermissions(toolName: string) {
    if (FILESYSTEM_READ_TOOL_NAMES.has(toolName)) {
      return this.permissionGuard.canReadFileSystem();
    }

    if (FILESYSTEM_WRITE_TOOL_NAMES.has(toolName)) {
      return this.permissionGuard.canWriteFileSystem();
    }

    if (NETWORK_TOOL_NAMES.has(toolName)) {
      return this.permissionGuard.isNetworkEnabled();
    }

    if (SHELL_TOOL_NAMES.has(toolName)) {
      return this.permissionGuard.isShellEnabled();
    }

    if (ACTIVE_SKILL_EXPOSED_TOOL_NAMES.has(toolName)) {
      return this.permissionGuard.getExecutionProfile() !== 'chat_only';
    }

    if (ALWAYS_EXPOSED_TOOL_NAMES.has(toolName)) {
      return this.permissionGuard.getExecutionProfile() !== 'chat_only';
    }

    return this.permissionGuard.getExecutionProfile() !== 'chat_only';
  }

  private getLoadedSkill(skillReference: string) {
    const normalizedReference = this.normalizeSkillReference(skillReference);
    if (!normalizedReference) {
      return null;
    }
    for (const skill of this.loadedSkills.values()) {
      const aliases = skill.aliases ?? [skill.skillName];
      if (aliases.some((alias) => this.normalizeSkillReference(alias) === normalizedReference)) {
        return skill;
      }
    }
    return null;
  }

  private normalizeSkillReference(skillReference: string) {
    return skillReference.trim().toLowerCase();
  }

  private normalizeRelativeSkillPath(resourcePath: string) {
    const normalizedPath = resourcePath.trim().split('\\').join('/');
    if (!normalizedPath || normalizedPath.startsWith('/') || normalizedPath.includes('..')) {
      return '';
    }
    return normalizedPath;
  }
}
