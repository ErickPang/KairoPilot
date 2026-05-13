import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import vm from 'vm';
import { z } from 'zod';
import { ToolDefinition } from '../llm/types';
import { getPluginRegistry, savePluginRegistry } from '../../store/config';

/**
 * Declared permissions for a plugin.
 * Plugins should declare what capabilities they need. During installation,
 * these are shown to the user for review. At runtime, the PermissionGuard
 * uses these to enforce access boundaries.
 */
export interface PluginPermissions {
  /** Whether the plugin needs to read files */
  fileSystemRead?: boolean;
  /** Whether the plugin needs to write files */
  fileSystemWrite?: boolean;
  /** Whether the plugin needs network access */
  network?: {
    enabled?: boolean;
    domains?: string[];
  };
  /** Whether the plugin needs shell execution */
  shell?: {
    enabled?: boolean;
    commands?: string[];
  };
  /** Self-declared risk level by the plugin author */
  riskLevel?: 'low' | 'medium' | 'high';
}

export interface PluginManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  icon?: string;
  /** Declared permissions — shown during install review */
  permissions?: PluginPermissions;
  /** Minimum KairoPilot version required */
  engines?: {
    kairopilot?: string;
  };
}

export interface InstalledPlugin extends PluginManifest {
  installedAt: number;
  filePath: string;
  scope: string; // 'public' or 'agent:{agentId}'
  /** Whether the user has explicitly approved this plugin's permissions */
  permissionsApproved?: boolean;
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
      icon: '🌤️',
      permissions: {
        riskLevel: 'low'
      }
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
      icon: '₿',
      permissions: {
        riskLevel: 'low'
      }
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

const PluginPermissionsSchema = z.object({
  fileSystemRead: z.boolean().optional(),
  fileSystemWrite: z.boolean().optional(),
  network: z.object({
    enabled: z.boolean().optional(),
    domains: z.array(z.string()).optional()
  }).optional(),
  shell: z.object({
    enabled: z.boolean().optional(),
    commands: z.array(z.string()).optional()
  }).optional(),
  riskLevel: z.enum(['low', 'medium', 'high']).optional()
}).optional();

const PluginManifestSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  version: z.string().trim().min(1),
  author: z.string().trim().min(1),
  icon: z.string().trim().optional(),
  permissions: PluginPermissionsSchema,
  engines: z.object({
    kairopilot: z.string().optional()
  }).optional()
});

const InstalledPluginSchema = PluginManifestSchema.extend({
  installedAt: z.number().finite().nonnegative(),
  filePath: z.string().trim().min(1),
  scope: z.string().trim().min(1),
  permissionsApproved: z.boolean().optional()
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

export class PluginManager {
  private pluginsDir: string;

  constructor() {
    const userDataDir = app.getPath('userData');
    this.pluginsDir = path.join(userDataDir, 'plugins');
  }

  async init() {
    const baseDir = app.getPath('userData');
    
    try {
      await fs.mkdir(baseDir, { recursive: true });
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
        pluginId: plugin.id,
        pluginVersion: plugin.version,
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
      scope,
      permissionsApproved: true  // Marked as approved since user initiated install
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
            console.log(`[PluginManager] Plugin ${plugin.id} is a directory without index.js, skipping JS load.`);
            continue;
          }
        }

        const code = await fs.readFile(codePath, 'utf-8');

        // Hardened sandbox: use null prototype to prevent prototype-chain escape.
        // Block access to process, require, global, globalThis, Function constructor
        // which are common vm escape vectors.
        const sandboxExports = { tools: [] as unknown[] };
        const sandboxModule = { exports: sandboxExports };
        const sandbox = Object.create(null) as Record<string, unknown>;
        sandbox.module = sandboxModule;
        sandbox.exports = sandboxExports;
        sandbox.console = Object.freeze({
          log: console.log.bind(console),
          warn: console.warn.bind(console),
          error: console.error.bind(console),
          info: console.info.bind(console),
          debug: () => {}
        });
        sandbox.z = z;
        sandbox.setTimeout = setTimeout;
        sandbox.clearTimeout = clearTimeout;
        sandbox.Promise = Promise;

        // Explicitly block escape vectors
        sandbox.process = undefined;
        sandbox.require = undefined;
        sandbox.global = undefined;
        sandbox.globalThis = undefined;
        sandbox.Function = undefined;
        sandbox.eval = undefined;
        sandbox.WebAssembly = undefined;

        // Freeze the sandbox to prevent modifications
        Object.freeze(sandbox);

        const context = vm.createContext(sandbox, {
          codeGeneration: {
            strings: false,  // Block eval() and new Function() from strings
            wasm: false      // Block WebAssembly compilation
          }
        });
        const script = new vm.Script(code, { filename: codePath });
        script.runInContext(context, { timeout: PLUGIN_LOAD_TIMEOUT_MS });

        const loadedTools = this.normalizePluginTools(plugin, sandboxModule.exports.tools);
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

  /**
   * Returns a human-readable permission summary for a plugin.
   * Used in the install confirmation UI to show users what the plugin requires.
   */
  getPermissionSummary(manifest: PluginManifest): string[] {
    const summary: string[] = [];
    const perms = manifest.permissions;

    if (!perms) {
      summary.push('No permissions declared (will run with default restrictions).');
      return summary;
    }

    if (perms.fileSystemRead) {
      summary.push('📂 Read files from the workspace');
    }
    if (perms.fileSystemWrite) {
      summary.push('✏️ Write/modify files in the workspace');
    }
    if (perms.network?.enabled) {
      const domains = perms.network.domains;
      if (domains && domains.length > 0) {
        summary.push(`🌐 Network access to: ${domains.join(', ')}`);
      } else {
        summary.push('🌐 Network access (unrestricted domains)');
      }
    }
    if (perms.shell?.enabled) {
      const commands = perms.shell.commands;
      if (commands && commands.length > 0) {
        summary.push(`⚡ Execute commands: ${commands.join(', ')}`);
      } else {
        summary.push('⚡ Execute shell commands');
      }
    }
    if (perms.riskLevel) {
      summary.push(`⚠️ Risk level: ${perms.riskLevel}`);
    }

    if (summary.length === 0) {
      summary.push('✅ No special permissions required.');
    }

    return summary;
  }

  /**
   * Returns the declared risk level for a plugin, defaulting to 'medium'
   * if not specified (conservative default for unknown plugins).
   */
  getPluginRiskLevel(pluginId: string): 'low' | 'medium' | 'high' {
    const storePlugin = getStorePluginById(pluginId);
    if (storePlugin?.manifest.permissions?.riskLevel) {
      return storePlugin.manifest.permissions.riskLevel;
    }
    // Default to medium for plugins that don't declare their risk
    return 'medium';
  }
}

export const pluginManager = new PluginManager();
