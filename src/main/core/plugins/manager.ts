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

interface BuiltInStorePlugin {
  manifest: PluginManifest;
  code: string;
}

const STORE_PLUGINS: BuiltInStorePlugin[] = [
  {
    manifest: {
      id: 'kairo-weather-plugin',
      name: 'Weather Forecaster',
      description: 'Get weather summaries and simple travel hints for a city.',
      version: '1.0.0',
      author: 'KairoPilot',
      icon: '🌤️'
    },
    code: `
module.exports.tools = [
  {
    name: 'get_weather_forecast',
    description: 'Get a lightweight weather summary for a city.',
    parameters: z.object({
      city: z.string().trim().min(1)
    }),
    execute: async ({ city }) => {
      const normalizedCity = String(city).trim();
      return {
        city: normalizedCity,
        condition: 'Sunny',
        temperatureCelsius: 26,
        humidity: 48,
        summary: normalizedCity + ' is warm and clear today.',
        recommendation: 'Good time for walking or light outdoor plans.'
      };
    }
  }
];
`.trim()
  },
  {
    manifest: {
      id: 'kairo-crypto-plugin',
      name: 'Crypto Tracker',
      description: 'Get mock crypto asset snapshots for demos and local testing.',
      version: '1.0.0',
      author: 'KairoPilot',
      icon: '₿'
    },
    code: `
module.exports.tools = [
  {
    name: 'get_crypto_snapshot',
    description: 'Get a lightweight market snapshot for a crypto symbol.',
    parameters: z.object({
      symbol: z.string().trim().min(1)
    }),
    execute: async ({ symbol }) => {
      const normalizedSymbol = String(symbol).trim().toUpperCase();
      return {
        symbol: normalizedSymbol,
        priceUsd: normalizedSymbol === 'BTC' ? 68250 : 3520,
        change24h: normalizedSymbol === 'BTC' ? 2.4 : 1.1,
        summary: normalizedSymbol + ' is showing moderate upward momentum in this demo feed.'
      };
    }
  }
];
`.trim()
  }
];
const PLUGIN_LOAD_TIMEOUT_MS = 1000;
const PLUGIN_EXECUTE_TIMEOUT_MS = 30000;

const PluginManifestSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  version: z.string().trim().min(1),
  author: z.string().trim().min(1),
  icon: z.string().trim().optional()
});

const InstalledPluginSchema = PluginManifestSchema.extend({
  installedAt: z.number().finite().nonnegative(),
  filePath: z.string().trim().min(1),
  scope: z.string().trim().min(1)
});

function getStorePluginById(id: string): BuiltInStorePlugin | undefined {
  return STORE_PLUGINS.find((plugin) => plugin.manifest.id === id);
}

const getPluginCode = async (id: string) => {
  const plugin = getStorePluginById(id);
  if (!plugin) {
    throw new Error(`Plugin ${id} not found in store.`);
  }
  return plugin.code;
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

  private isSupportedScope(scope: string, agentId?: string): boolean {
    if (scope === 'public') {
      return true;
    }
    if (agentId && scope === `agent:${agentId}`) {
      return true;
    }
    return !agentId && scope === 'workspace';
  }

  private resolvePluginCodePath(plugin: InstalledPlugin, stat: Awaited<ReturnType<typeof fs.stat>>) {
    if (!stat.isDirectory()) {
      return plugin.filePath;
    }
    return path.join(plugin.filePath, 'index.js');
  }

  private isZodSchema(value: unknown): value is z.ZodSchema {
    return typeof value === 'object'
      && value !== null
      && 'safeParse' in value
      && typeof (value as { safeParse?: unknown }).safeParse === 'function';
  }

  private normalizePluginTools(plugin: InstalledPlugin, tools: unknown): ToolDefinition[] {
    if (!Array.isArray(tools)) {
      return [];
    }

    const normalizedTools: ToolDefinition[] = [];
    for (const tool of tools) {
      if (typeof tool !== 'object' || tool === null) {
        console.warn(`[PluginManager] Ignoring invalid tool export from plugin ${plugin.id}.`);
        continue;
      }

      const candidate = tool as Partial<ToolDefinition>;
      if (typeof candidate.name !== 'string' || candidate.name.trim().length === 0) {
        console.warn(`[PluginManager] Ignoring unnamed tool from plugin ${plugin.id}.`);
        continue;
      }
      if (typeof candidate.description !== 'string' || candidate.description.trim().length === 0) {
        console.warn(`[PluginManager] Ignoring tool ${candidate.name} from plugin ${plugin.id}: missing description.`);
        continue;
      }
      if (!this.isZodSchema(candidate.parameters)) {
        console.warn(`[PluginManager] Ignoring tool ${candidate.name} from plugin ${plugin.id}: invalid parameters schema.`);
        continue;
      }
      if (typeof candidate.execute !== 'function') {
        console.warn(`[PluginManager] Ignoring tool ${candidate.name} from plugin ${plugin.id}: missing execute function.`);
        continue;
      }

      normalizedTools.push({
        name: candidate.name,
        description: candidate.description,
        parameters: candidate.parameters,
        execute: async (args: Record<string, unknown>) => {
          const execution = Promise.resolve(candidate.execute!(args));
          const timeout = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Plugin tool timed out after ${PLUGIN_EXECUTE_TIMEOUT_MS}ms.`)), PLUGIN_EXECUTE_TIMEOUT_MS);
          });
          return Promise.race([execution, timeout]);
        }
      });
    }

    return normalizedTools;
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
    return STORE_PLUGINS.map((plugin) => plugin.manifest);
  }

  async getInstalledPlugins(): Promise<InstalledPlugin[]> {
    await this.init();
    const registryPlugins = getPluginRegistry();
    const validPlugins: InstalledPlugin[] = [];
    let registryModified = false;
    try {
      for (const plugin of registryPlugins) {
        const validation = InstalledPluginSchema.safeParse(plugin);
        if (!validation.success) {
          console.warn('[PluginManager] Removing invalid plugin registry entry.', validation.error.flatten());
          registryModified = true;
          continue;
        }

        const normalizedPlugin = validation.data;
        try {
          await fs.access(normalizedPlugin.filePath);
          validPlugins.push(normalizedPlugin);
        } catch {
          console.warn(`[PluginManager] Plugin ${normalizedPlugin.id} file not found at ${normalizedPlugin.filePath}, removing from registry.`);
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
    const storePlugin = getStorePluginById(id)?.manifest;
    if (!storePlugin) throw new Error('Plugin not found in store');
    const manifestValidation = PluginManifestSchema.safeParse(storePlugin);
    if (!manifestValidation.success) {
      throw new Error('Invalid plugin manifest.');
    }

    const installed = await this.getInstalledPlugins();
    // Allow installing the same plugin in different scopes
    if (installed.find(p => p.id === id && p.scope === scope)) return true;

    // "Download" code
    const code = await getPluginCode(id);
    const targetDir = this.pluginsDir;
    
    // Ensure target directory exists
    try {
      await fs.mkdir(targetDir, { recursive: true });
    } catch (e) { /* ignore */ }

    // Differentiate filename if scope is agent specific, or just use ID since pluginsDir is flat
    const safeScope = scope.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = path.join(targetDir, `${id}_${safeScope}.js`);
    await fs.writeFile(filePath, code, 'utf-8');

    const newPlugin: InstalledPlugin = {
      ...manifestValidation.data,
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

  async cleanupAgentScopedPlugins(agentId: string): Promise<number> {
    await this.init();
    const scope = `agent:${agentId}`;
    const installed = await this.getInstalledPlugins();
    const scopedPlugins = installed.filter((plugin) => plugin.scope === scope);

    for (const plugin of scopedPlugins) {
      await this.uninstallPlugin(plugin.id, plugin.scope);
    }

    return scopedPlugins.length;
  }

  async loadAllTools(agentId?: string): Promise<ToolDefinition[]> {
    await this.init();
    const installed = await this.getInstalledPlugins();
    const pluginsToLoad = installed.filter((plugin) => this.isSupportedScope(plugin.scope, agentId));
    const allTools: ToolDefinition[] = [];
    const seenToolNames = new Set<string>();

    for (const plugin of pluginsToLoad) {
      try {
        const stat = await fs.stat(plugin.filePath);
        const codePath = this.resolvePluginCodePath(plugin, stat);

        if (stat.isDirectory()) {
          try {
            await fs.access(codePath);
          } catch {
            console.log(`[PluginManager] Skill ${plugin.id} is a directory without index.js, skipping JS load.`);
            continue;
          }
        }

        const code = await fs.readFile(codePath, 'utf-8');
        const sandbox = Object.freeze({
          module: { exports: { tools: [] } },
          console: console,
          z: z
        });
        const context = vm.createContext(sandbox);
        const script = new vm.Script(code, { filename: codePath });
        script.runInContext(context, { timeout: PLUGIN_LOAD_TIMEOUT_MS });

        const loadedTools = this.normalizePluginTools(plugin, sandbox.module.exports.tools);
        for (const tool of loadedTools) {
          if (seenToolNames.has(tool.name)) {
            console.warn(`[PluginManager] Skipping duplicate tool name ${tool.name} from plugin ${plugin.id}.`);
            continue;
          }
          seenToolNames.add(tool.name);
          allTools.push(tool);
        }
      } catch (error) {
        console.error(`Failed to load plugin ${plugin.id}:`, error);
      }
    }

    return allTools;
  }
}

export const pluginManager = new PluginManager();
