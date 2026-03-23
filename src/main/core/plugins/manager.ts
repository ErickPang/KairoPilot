import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import vm from 'vm';
import { z } from 'zod';
import { ToolDefinition } from '../llm/types';
import { getAgent, getPluginRegistry, savePluginRegistry } from '../../store/config';

export interface PluginManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  icon?: string;
}

export interface InstalledPlugin extends PluginManifest {
  installedAt: number;
  filePath: string;
  scope: string; // 'public' or 'agent:{agentId}'
}

const MOCK_STORE: PluginManifest[] = [];

// Real Plugin Code Fetcher placeholder
const getPluginCode = async () => {
  throw new Error('Plugin store API not implemented yet.');
};

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  content: string;
  source: 'public' | 'agent';
}

export class PluginManager {
  private publicSkillsDir: string;
  private pluginsDir: string;

  constructor() {
    const userDataDir = app.getPath('userData');
    this.publicSkillsDir = path.join(userDataDir, 'skills');
    this.pluginsDir = path.join(userDataDir, 'plugins');
  }

  async init() {
    const baseDir = app.getPath('userData');
    
    try {
      await fs.mkdir(baseDir, { recursive: true });
    } catch (e) { /* ignore */ }

    try {
      await fs.mkdir(this.publicSkillsDir, { recursive: true });
    } catch (e) { /* ignore */ }
    
    try {
      await fs.mkdir(this.pluginsDir, { recursive: true });
    } catch (e) { /* ignore */ }
  }

  private getWorkspaceDir(scope: string): string {
    if (scope === 'public') return this.publicSkillsDir;
    
    if (scope.startsWith('agent:')) {
      const agentId = scope.split(':')[1];
      const agent = getAgent(agentId);
      if (agent && agent.workspace) {
        return path.join(agent.workspace, 'skills');
      }

      // Fallback
      const workspaceName = agentId === 'mainAgent' ? 'workspace' : `workspace-${agentId}`;
      return path.join(app.getPath('userData'), workspaceName, 'skills');
    }
    
    return path.join(app.getPath('userData'), 'workspace', 'skills');
  }

  private async parseSkillFile(dirPath: string, folderName: string): Promise<AgentSkill | null> {
    try {
      const skillPath = path.join(dirPath, 'SKILL.md');
      const content = await fs.readFile(skillPath, 'utf-8');
      
      const fmMatch = content.match(/^---\r?\n([\s\S]+?)\r?\n---/);
      let name = folderName;
      let description = `Skill: ${name}`;
      let body = content;

      if (fmMatch) {
        const frontMatter = fmMatch[1];
        body = content.slice(fmMatch[0].length).trim();
        
        const nameMatch = frontMatter.match(/^name:\s*(.+)/m);
        if (nameMatch) name = nameMatch[1].trim();
        
        const descMatch = frontMatter.match(/^description:\s*(.+)/m);
        if (descMatch) description = descMatch[1].trim();
        
        if (frontMatter.match(/^description:\s*\|/m)) {
           const descLines = [];
           const lines = frontMatter.split(/\r?\n/);
           let inDesc = false;
           for (const line of lines) {
             if (line.match(/^description:\s*\|/)) {
               inDesc = true;
               continue;
             }
             if (inDesc) {
               if (line.match(/^[a-z]+:/)) break;
               descLines.push(line.trim());
             }
           }
           if (descLines.length > 0) {
             description = descLines.filter(Boolean).join(" ");
           }
        }
      } else {
        const nameMatch = content.match(/^name:\s*(.+)/m);
        if (nameMatch) name = nameMatch[1].trim();
        const descMatch = content.match(/^description:\s*(.+)/m);
        if (descMatch) description = descMatch[1].trim();
      }

      return {
        id: folderName,
        name,
        description,
        content: body,
        source: 'public'
      };
    } catch (e) {
      return null;
    }
  }

  private async scanSkillsDirectory(dir: string, source: 'public' | 'agent'): Promise<AgentSkill[]> {
    const skills: AgentSkill[] = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const skill = await this.parseSkillFile(path.join(dir, entry.name), entry.name);
          if (skill) {
            skill.source = source;
            skills.push(skill);
          }
        }
      }
    } catch (e) {
      // Directory might not exist, ignore
    }
    return skills;
  }

  async getMergedSkillsForAgent(agentId: string): Promise<AgentSkill[]> {
    await this.init();
    const publicSkills = await this.scanSkillsDirectory(this.publicSkillsDir, 'public');
    
    const agentSkillsDir = this.getWorkspaceDir(`agent:${agentId}`);
    const agentSkills = await this.scanSkillsDirectory(agentSkillsDir, 'agent');

    const skillMap = new Map<string, AgentSkill>();
    
    // Load public skills first
    for (const skill of publicSkills) {
      skillMap.set(skill.id, skill);
    }

    // Override with agent skills (if same id, agent workspace wins)
    for (const skill of agentSkills) {
      skillMap.set(skill.id, skill);
    }

    return Array.from(skillMap.values());
  }

  async getStorePlugins(): Promise<PluginManifest[]> {
    // Return empty store for now since API is not implemented
    return MOCK_STORE;
  }

  async getInstalledPlugins(): Promise<InstalledPlugin[]> {
    await this.init();
    const registryPlugins = getPluginRegistry() as InstalledPlugin[];
    const validPlugins: InstalledPlugin[] = [];
    let registryModified = false;
    try {
      for (const plugin of registryPlugins) {
        try {
          await fs.access(plugin.filePath);
          validPlugins.push(plugin);
        } catch {
          console.warn(`[PluginManager] Plugin ${plugin.id} file not found at ${plugin.filePath}, removing from registry.`);
          registryModified = true;
        }
      }
    } catch (e) {
      console.error('Failed to read plugin registry', e);
      return [];
    }
    if (registryModified) {
      savePluginRegistry(validPlugins);
    }
    return validPlugins;
  }

  async installPlugin(id: string, scope: string = 'public'): Promise<boolean> {
    await this.init();
    const storePlugin = MOCK_STORE.find(p => p.id === id);
    if (!storePlugin) throw new Error('Plugin not found in store');

    const installed = await this.getInstalledPlugins();
    // Allow installing the same plugin in different scopes
    if (installed.find(p => p.id === id && p.scope === scope)) return true;

    // "Download" code
    const code = await getPluginCode();
    const targetDir = this.pluginsDir;
    
    // Ensure target directory exists
    try {
      await fs.mkdir(targetDir, { recursive: true });
    } catch (e) { /* ignore */ }

    // Differentiate filename if scope is agent specific, or just use ID since pluginsDir is flat
    const safeScope = scope.replace(':', '_');
    const filePath = path.join(targetDir, `${id}_${safeScope}.js`);
    await fs.writeFile(filePath, code, 'utf-8');

    const newPlugin: InstalledPlugin = {
      ...storePlugin,
      installedAt: Date.now(),
      filePath,
      scope
    };

    const registryPlugins = getPluginRegistry() as InstalledPlugin[];
    registryPlugins.push(newPlugin);
    savePluginRegistry(registryPlugins);

    return true;
  }

  async uninstallPlugin(id: string, scope: string): Promise<boolean> {
    await this.init();
    const installed = await this.getInstalledPlugins();
    const plugin = installed.find(p => p.id === id && p.scope === scope);
    if (!plugin) return true;

    // Remove file or directory
    try {
      const stat = await fs.stat(plugin.filePath);
      if (stat.isDirectory()) {
        await fs.rm(plugin.filePath, { recursive: true, force: true });
      } else {
        await fs.unlink(plugin.filePath);
      }
    } catch (e) {
      console.warn('Failed to delete plugin file/directory:', e);
    }

    const registryPlugins = (getPluginRegistry() as InstalledPlugin[])
      .filter(p => !(p.id === id && p.scope === scope));
    savePluginRegistry(registryPlugins);

    return true;
  }

  async loadAllTools(agentId?: string): Promise<ToolDefinition[]> {
    await this.init();
    const installed = await this.getInstalledPlugins();
    
    // Filter plugins based on scope
    const pluginsToLoad = installed.filter(p => {
      if (p.scope === 'public') return true;
      if (agentId && p.scope === `agent:${agentId}`) return true;
      // Fallback for legacy 'workspace' scope if we still want to support it
      if (!agentId && p.scope === 'workspace') return true;
      return false;
    });

    let allTools: ToolDefinition[] = [];

    for (const plugin of pluginsToLoad) {
      try {
        const stat = await fs.stat(plugin.filePath);
        let codePath = plugin.filePath;
        
        if (stat.isDirectory()) {
          // Check if index.js exists
          const indexJsPath = path.join(plugin.filePath, 'index.js');
          try {
            await fs.access(indexJsPath);
            codePath = indexJsPath;
          } catch (e) {
            // It's a directory but no index.js (maybe a prompt-only skill with SKILL.md)
            console.log(`[PluginManager] Skill ${plugin.id} is a directory without index.js, skipping JS load.`);
            continue;
          }
        }

        const code = await fs.readFile(codePath, 'utf-8');
        
        // Setup secure context with injected kairo API
        const sandbox = {
          module: { exports: { tools: [] } },
          console: console,
          z: z // Inject zod so parameters can be defined
        };
        
        vm.createContext(sandbox);
        vm.runInContext(code, sandbox);
        
        const modTools = sandbox.module.exports.tools;
        if (Array.isArray(modTools)) {
          allTools = allTools.concat(modTools as ToolDefinition[]);
        }
      } catch (error) {
        console.error(`Failed to load plugin ${plugin.id}:`, error);
      }
    }

    return allTools;
  }
}

export const pluginManager = new PluginManager();
