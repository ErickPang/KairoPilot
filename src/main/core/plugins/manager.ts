import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import vm from 'vm';
import { z } from 'zod';
import { ToolDefinition } from '../llm/types';
import { getAgent } from '../../store/config';

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

const MOCK_STORE: PluginManifest[] = [
  {
    id: 'kairo-weather-plugin',
    name: 'Weather Forecaster',
    description: 'Provides real-time weather information for any city.',
    version: '1.0.0',
    author: 'Kairo Team',
    icon: '🌤️'
  },
  {
    id: 'kairo-crypto-plugin',
    name: 'Crypto Tracker',
    description: 'Get real-time cryptocurrency prices and market data.',
    version: '1.0.0',
    author: 'Community',
    icon: '₿'
  },
  {
    id: 'kairo-websearch-plugin',
    name: 'Web Search',
    description: 'Search the internet for real-time information using DuckDuckGo.',
    version: '1.1.0',
    author: 'Community',
    icon: '🔍'
  }
];

// Mock Plugin Code Generators
// These plugins use the injected `z` from context
const getPluginCode = (id: string) => {
  if (id === 'kairo-weather-plugin') {
    return `
      module.exports = {
        tools: [
          {
            name: 'get_weather',
            description: 'Get the current weather for a specific city.',
            parameters: z.object({
              city: z.string().describe('The name of the city, e.g., London, Tokyo')
            }),
            execute: async ({ city }) => {
              const temps = { 'London': '15°C, Rainy', 'Tokyo': '22°C, Sunny', 'New York': '18°C, Cloudy', 'Beijing': '25°C, Clear' };
              return "The current weather in " + city + " is " + (temps[city] || '20°C, Clear') + ".";
            }
          }
        ]
      };
    `;
  }
  if (id === 'kairo-crypto-plugin') {
     return `
      module.exports = {
        tools: [
          {
            name: 'get_crypto_price',
            description: 'Get the current price of a cryptocurrency.',
            parameters: z.object({
              symbol: z.string().describe('The cryptocurrency symbol, e.g., BTC, ETH')
            }),
            execute: async ({ symbol }) => {
              const prices = { 'BTC': '$65,000', 'ETH': '$3,500', 'SOL': '$150' };
              return "The current price of " + symbol.toUpperCase() + " is " + (prices[symbol.toUpperCase()] || 'unknown') + ".";
            }
          }
        ]
      };
     `;
  }
  if (id === 'kairo-websearch-plugin') {
      return `
      module.exports = {
        tools: [
          {
            name: 'web_search',
            description: 'Search the web for up-to-date information.',
            parameters: z.object({
              query: z.string().describe('The search query')
            }),
            execute: async ({ query }) => {
              return "Search results for " + query + ":\\n1. Found some relevant information...\\n2. Another source says something interesting.";
            }
          }
        ]
      };
     `;
  }
  return `module.exports = { tools: [] };`;
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
  private registryPath: string;

  constructor() {
    const homeDir = app.getPath('home');
    this.publicSkillsDir = path.join(homeDir, '.kairopilot', 'skills');
    this.registryPath = path.join(homeDir, '.kairopilot', 'skills_registry.json');
  }

  async init() {
    const homeDir = app.getPath('home');
    const baseDir = path.join(homeDir, '.kairopilot');
    
    try {
      await fs.mkdir(baseDir, { recursive: true });
    } catch (e) { /* ignore */ }

    try {
      await fs.mkdir(this.publicSkillsDir, { recursive: true });
    } catch (e) { /* ignore */ }
    
    try {
      await fs.access(this.registryPath);
    } catch {
      await fs.writeFile(this.registryPath, JSON.stringify([]), 'utf-8');
    }
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
      const homeDir = app.getPath('home');
      const workspaceName = agentId === 'mainAgent' ? 'workspace' : `workspace-${agentId}`;
      return path.join(homeDir, '.kairopilot', workspaceName, 'skills');
    }
    
    // Fallback for any legacy 'workspace' scope
    const homeDir = app.getPath('home');
    return path.join(homeDir, '.kairopilot', 'workspace', 'skills');
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
    // Simulate network delay
    await new Promise(r => setTimeout(r, 500));
    return MOCK_STORE;
  }

  async getInstalledPlugins(): Promise<InstalledPlugin[]> {
    await this.init();
    let registryPlugins: InstalledPlugin[] = [];
    try {
      const data = await fs.readFile(this.registryPath, 'utf-8');
      registryPlugins = JSON.parse(data) as InstalledPlugin[];
    } catch (e) {
      console.error('Failed to read plugin registry', e);
    }

    // Scan for manually added .js files or directories in the public skills directory
    try {
      const entries = await fs.readdir(this.publicSkillsDir, { withFileTypes: true });
      for (const entry of entries) {
        let id: string | null = null;
        let pluginName = '';
        let description = 'Manually added local skill';
        let version = 'local';
        let isDir = false;

        if (entry.isFile() && entry.name.endsWith('.js')) {
          id = entry.name.replace('.js', '');
          pluginName = id;
        } else if (entry.isDirectory()) {
          // Check if it's a valid skill directory (e.g., contains SKILL.md or index.js)
          const dirPath = path.join(this.publicSkillsDir, entry.name);
          try {
            const files = await fs.readdir(dirPath);
            if (files.includes('SKILL.md') || files.includes('index.js')) {
              id = entry.name;
              pluginName = id;
              isDir = true;
              
              // Optionally parse SKILL.md for metadata
              if (files.includes('SKILL.md')) {
                try {
                  const content = await fs.readFile(path.join(dirPath, 'SKILL.md'), 'utf-8');
                  const nameMatch = content.match(/name:\s*(.+)/);
                  const descMatch = content.match(/description:\s*(.+)/);
                  const versionMatch = content.match(/version:\s*(.+)/);
                  
                  if (nameMatch) pluginName = nameMatch[1].trim();
                  if (descMatch) description = descMatch[1].trim();
                  if (versionMatch) version = versionMatch[1].trim();
                } catch (e) {
                  // ignore parse error
                }
              }
            }
          } catch (e) {
            continue;
          }
        }

        if (id) {
          // If not already in registry for 'public' scope, add a placeholder entry
          if (!registryPlugins.find(p => p.id === id && p.scope === 'public')) {
            registryPlugins.push({
              id: id,
              name: pluginName,
              description: description,
              version: version,
              author: 'Local User',
              icon: isDir ? '📁' : '📄',
              installedAt: Date.now(),
              filePath: isDir ? path.join(this.publicSkillsDir, entry.name) : path.join(this.publicSkillsDir, entry.name),
              scope: 'public'
            });
          }
        }
      }
    } catch (e) {
      console.warn('Failed to scan public skills directory:', e);
    }

    return registryPlugins;
  }

  async installPlugin(id: string, scope: string = 'public'): Promise<boolean> {
    await this.init();
    const storePlugin = MOCK_STORE.find(p => p.id === id);
    if (!storePlugin) throw new Error('Plugin not found in store');

    const installed = await this.getInstalledPlugins();
    // Allow installing the same plugin in different scopes
    if (installed.find(p => p.id === id && p.scope === scope)) return true;

    // "Download" code
    const code = getPluginCode(id);
    const targetDir = this.getWorkspaceDir(scope);
    
    // Ensure target directory exists
    try {
      await fs.mkdir(targetDir, { recursive: true });
    } catch (e) { /* ignore */ }

    const filePath = path.join(targetDir, `${id}.js`);
    await fs.writeFile(filePath, code, 'utf-8');

    const newPlugin: InstalledPlugin = {
      ...storePlugin,
      installedAt: Date.now(),
      filePath,
      scope
    };

    // Update registry by reading it directly to avoid writing local-only plugins back
    try {
      const data = await fs.readFile(this.registryPath, 'utf-8');
      const registryPlugins = JSON.parse(data) as InstalledPlugin[];
      registryPlugins.push(newPlugin);
      await fs.writeFile(this.registryPath, JSON.stringify(registryPlugins, null, 2), 'utf-8');
    } catch (e) {
      // If registry read fails, just write the new plugin as an array
      await fs.writeFile(this.registryPath, JSON.stringify([newPlugin], null, 2), 'utf-8');
    }

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

    // Update registry by reading it directly to avoid writing local-only plugins back
    try {
      const data = await fs.readFile(this.registryPath, 'utf-8');
      let registryPlugins = JSON.parse(data) as InstalledPlugin[];
      registryPlugins = registryPlugins.filter(p => !(p.id === id && p.scope === scope));
      await fs.writeFile(this.registryPath, JSON.stringify(registryPlugins, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to update plugin registry during uninstall', e);
    }

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
