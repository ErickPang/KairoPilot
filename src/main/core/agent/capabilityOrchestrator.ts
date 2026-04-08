import type { ToolDefinition } from '../llm/types';
import { PermissionGuard } from '../security/permissions';
import { matchesAllowedToolName, resolveAllowedToolToRegisteredNames } from '../skills/skillStoreUtils';

export interface LoadedSkillCapability {
  skillName: string;
  allowedTools: string[];
  loadedAt: number;
}

const ALWAYS_EXPOSED_TOOL_NAMES = new Set([
  'load_skill',
  'read_skill_resource'
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
  'fetch_webpage'
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
      this.activateSkill(skill.skillName, skill.allowedTools, skill.loadedAt);
    }
  }

  activateSkill(skillName: string, allowedTools: string[], loadedAt: number = Date.now()) {
    const normalizedSkillName = skillName.trim();
    if (!normalizedSkillName) {
      return;
    }

    this.loadedSkills.set(normalizedSkillName, {
      skillName: normalizedSkillName,
      allowedTools: Array.from(new Set(allowedTools.map((toolName) => toolName.trim()).filter(Boolean))),
      loadedAt
    });
  }

  getLoadedSkills(): LoadedSkillCapability[] {
    return Array.from(this.loadedSkills.values()).map((skill) => ({
      skillName: skill.skillName,
      allowedTools: [...skill.allowedTools],
      loadedAt: skill.loadedAt
    }));
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
      return permissionEligibleTools;
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

    if (ALWAYS_EXPOSED_TOOL_NAMES.has(toolName)) {
      return this.permissionGuard.getExecutionProfile() !== 'chat_only';
    }

    return this.permissionGuard.getExecutionProfile() !== 'chat_only';
  }
}
