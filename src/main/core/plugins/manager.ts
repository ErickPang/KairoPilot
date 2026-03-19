import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import vm from 'vm';
import { z } from 'zod';
import { ToolDefinition } from '../llm/types';

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
    
    const homeDir = app.getPath('home');
    if (scope.startsWith('agent:')) {
      const agentId = scope.split(':')[1];
      const workspaceName = agentId === 'mainAgent' ? 'workspace' : `workspace-${agentId}`;
      return path.join(homeDir, '.kairopilot', workspaceName, 'skills');
    }
    
    // Fallback for any legacy 'workspace' scope
    return path.join(homeDir, '.kairopilot', 'workspace', 'skills');
  }

  async getStorePlugins(): Promise<PluginManifest[]> {
    // Simulate network delay
    await new Promise(r => setTimeout(r, 500));
    return MOCK_STORE;
  }

  async getInstalledPlugins(): Promise<InstalledPlugin[]> {
    await this.init();
    try {
      const data = await fs.readFile(this.registryPath, 'utf-8');
      return JSON.parse(data) as InstalledPlugin[];
    } catch (e) {
      console.error('Failed to read plugin registry', e);
      return [];
    }
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

    // Update registry
    const newPlugin: InstalledPlugin = {
      ...storePlugin,
      installedAt: Date.now(),
      filePath,
      scope
    };
    installed.push(newPlugin);
    await fs.writeFile(this.registryPath, JSON.stringify(installed, null, 2), 'utf-8');

    return true;
  }

  async uninstallPlugin(id: string, scope: string): Promise<boolean> {
    await this.init();
    let installed = await this.getInstalledPlugins();
    const plugin = installed.find(p => p.id === id && p.scope === scope);
    if (!plugin) return true;

    // Remove file
    try {
      await fs.unlink(plugin.filePath);
    } catch (e) {
      console.warn('Failed to delete plugin file:', e);
    }

    // Update registry
    installed = installed.filter(p => !(p.id === id && p.scope === scope));
    await fs.writeFile(this.registryPath, JSON.stringify(installed, null, 2), 'utf-8');

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
        const code = await fs.readFile(plugin.filePath, 'utf-8');
        
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
