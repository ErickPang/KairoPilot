import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { ToolDefinition } from '../llm/types';
import type { PermissionGuard } from '../security/permissions';
import { getPluginRegistry, savePluginRegistry } from '../../store/config';
import { addAuditLog } from '../../store/audit';
import type { PluginCapabilityDeclaration, PluginManifest, PluginRegistryEntry } from '../../../shared/contracts';

type InstalledPlugin = PluginRegistryEntry;

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
      riskLevel: 'low',
      tools: [
        {
          name: 'get_weather_forecast',
          description: 'Returns a demo weather summary for a city.'
        }
      ],
      capabilities: [
        {
          id: 'local-demo-data',
          label: 'Demo data only',
          description: 'Returns local mock data without external network access.',
          riskLevel: 'low'
        }
      ]
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
      riskLevel: 'low',
      tools: [
        {
          name: 'get_crypto_snapshot',
          description: 'Returns a demo market snapshot for a crypto symbol.'
        }
      ],
      capabilities: [
        {
          id: 'local-demo-data',
          label: 'Demo data only',
          description: 'Returns local mock data without external network access.',
          riskLevel: 'low'
        }
      ]
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
const PLUGIN_MAX_CODE_BYTES = 256 * 1024;
const PLUGIN_MAX_RESULT_BYTES = 256 * 1024;
const PluginArgumentsSchema = z.object({}).passthrough();
const PLUGIN_DISCOVERY_WORKER_CODE = `
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');
const zodModule = require('zod');
const z = zodModule.z || zodModule;

function toJsonSchema(parameters) {
  try {
    if (!parameters || typeof parameters.safeParse !== 'function') {
      return undefined;
    }
    const schema = z.toJSONSchema(parameters);
    if (schema && typeof schema === 'object') {
      delete schema.$schema;
    }
    return schema;
  } catch {
    return undefined;
  }
}

(async () => {
  try {
    const sandbox = Object.freeze({
      module: { exports: { tools: [] } },
      console,
      z
    });
    const context = vm.createContext(sandbox);
    const script = new vm.Script(workerData.code, { filename: workerData.filename });
    script.runInContext(context, { timeout: workerData.loadTimeoutMs });

    const tools = sandbox.module.exports.tools;
    if (!Array.isArray(tools)) {
      throw new Error('Plugin tools export must be an array.');
    }

    parentPort.postMessage({
      ok: true,
      tools: tools.map((tool) => ({
        name: tool && tool.name,
        description: tool && tool.description,
        hasParametersSchema: Boolean(tool && tool.parameters && typeof tool.parameters.safeParse === 'function'),
        hasExecute: Boolean(tool && typeof tool.execute === 'function'),
        parametersJsonSchema: toJsonSchema(tool && tool.parameters)
      }))
    });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown plugin discovery worker error.'
    });
  }
})();
`;
const PLUGIN_WORKER_CODE = `
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');

function createSchemaStub() {
  const schema = new Proxy({}, {
    get(_target, property) {
      if (property === 'safeParse') {
        return (value) => ({ success: true, data: value });
      }
      if (property === 'parse') {
        return (value) => value;
      }
      if (property === 'shape') {
        return {};
      }
      if (property === 'isOptional') {
        return () => false;
      }
      return () => schema;
    }
  });
  return schema;
}

const z = new Proxy({}, {
  get() {
    return () => createSchemaStub();
  }
});

function normalizePluginResult(result, maxBytes) {
  if (result === undefined) {
    return null;
  }

  const serialized = JSON.stringify(result);
  if (typeof serialized !== 'string') {
    throw new Error('Plugin tool returned a non-serializable result.');
  }
  if (Buffer.byteLength(serialized, 'utf-8') > maxBytes) {
    throw new Error('Plugin tool result exceeded ' + maxBytes + ' bytes.');
  }
  return JSON.parse(serialized);
}

(async () => {
  try {
    const sandbox = Object.freeze({
      module: { exports: { tools: [] } },
      console,
      z
    });
    const context = vm.createContext(sandbox);
    const script = new vm.Script(workerData.code, { filename: workerData.filename });
    script.runInContext(context, { timeout: workerData.loadTimeoutMs });

    const tools = sandbox.module.exports.tools;
    if (!Array.isArray(tools)) {
      throw new Error('Plugin tools export must be an array.');
    }

    const tool = tools.find((candidate) => candidate && candidate.name === workerData.toolName);
    if (!tool || typeof tool.execute !== 'function') {
      throw new Error('Plugin tool not found: ' + workerData.toolName);
    }
    const result = await Promise.resolve(tool.execute(workerData.args || {}));
    parentPort.postMessage({
      ok: true,
      result: normalizePluginResult(result, workerData.maxResultBytes)
    });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown plugin worker error.'
    });
  }
})();
`;

const PluginManifestSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  version: z.string().trim().min(1),
  author: z.string().trim().min(1),
  icon: z.string().trim().optional(),
  tools: z.array(z.object({
    name: z.string().trim().min(1),
    description: z.string().trim().min(1)
  })).default([]),
  capabilities: z.array(z.object({
    id: z.string().trim().min(1),
    label: z.string().trim().min(1),
    description: z.string().trim().optional(),
    riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
    requiredPermissions: z.object({
      fileSystem: z.object({
        read: z.boolean().optional(),
        write: z.boolean().optional(),
        paths: z.array(z.string().trim().min(1)).optional()
      }).optional(),
      network: z.object({
        enabled: z.boolean().optional(),
        domains: z.array(z.string().trim().min(1)).optional()
      }).optional(),
      shell: z.object({
        enabled: z.boolean().optional(),
        commands: z.array(z.string().trim().min(1)).optional()
      }).optional()
    }).optional()
  })).default([]),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']).default('low')
});

const InstalledPluginSchema = PluginManifestSchema.extend({
  installedAt: z.number().finite().nonnegative(),
  filePath: z.string().trim().min(1),
  scope: z.string().trim().min(1)
});

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

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

interface PluginManagerOptions {
  executeTimeoutMs?: number;
}

interface DiscoveredPluginTool {
  name?: unknown;
  description?: unknown;
  hasParametersSchema?: boolean;
  hasExecute?: boolean;
  parametersJsonSchema?: Record<string, unknown>;
}

export class PluginManager {
  private pluginsDir: string;
  private executeTimeoutMs: number;

  constructor(options: PluginManagerOptions = {}) {
    const userDataDir = app.getPath('userData');
    this.pluginsDir = path.join(userDataDir, 'plugins');
    this.executeTimeoutMs = options.executeTimeoutMs ?? PLUGIN_EXECUTE_TIMEOUT_MS;
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

  private auditPluginIssue(params: {
    tool: string;
    args: Record<string, unknown>;
    error: string;
    policyTags: string[];
  }) {
    try {
      addAuditLog(params);
    } catch (error) {
      console.warn('[PluginManager] Failed to write plugin audit log:', error);
    }
  }

  private rejectPluginTool(plugin: InstalledPlugin, error: string, toolName?: string) {
    console.warn(`[PluginManager] ${error}`);
    this.auditPluginIssue({
      tool: 'plugin_tool_invalid',
      args: {
        pluginId: plugin.id,
        scope: plugin.scope,
        toolName
      },
      error,
      policyTags: ['plugin:load', 'plugin:tool', 'decision:error']
    });
  }

  private normalizePluginTools(plugin: InstalledPlugin, code: string, codePath: string, tools: DiscoveredPluginTool[]): ToolDefinition[] {
    if (!Array.isArray(tools)) {
      this.auditPluginIssue({
        tool: 'plugin_tools_invalid',
        args: {
          pluginId: plugin.id,
          scope: plugin.scope
        },
        error: 'Plugin tools export must be an array.',
        policyTags: ['plugin:load', 'plugin:tool', 'decision:error']
      });
      return [];
    }

    const normalizedTools: ToolDefinition[] = [];
    const manifestToolNames = new Set(plugin.tools.map((tool) => tool.name));
    for (const tool of tools) {
      if (typeof tool !== 'object' || tool === null) {
        this.rejectPluginTool(plugin, `Ignoring invalid tool export from plugin ${plugin.id}.`);
        continue;
      }

      const candidate = tool;
      if (typeof candidate.name !== 'string' || candidate.name.trim().length === 0) {
        this.rejectPluginTool(plugin, `Ignoring unnamed tool from plugin ${plugin.id}.`);
        continue;
      }
      if (manifestToolNames.size > 0 && !manifestToolNames.has(candidate.name)) {
        this.rejectPluginTool(plugin, `Ignoring undeclared tool ${candidate.name} from plugin ${plugin.id}.`, candidate.name);
        continue;
      }
      if (typeof candidate.description !== 'string' || candidate.description.trim().length === 0) {
        this.rejectPluginTool(plugin, `Ignoring tool ${candidate.name} from plugin ${plugin.id}: missing description.`, candidate.name);
        continue;
      }
      if (!candidate.hasParametersSchema) {
        this.rejectPluginTool(plugin, `Ignoring tool ${candidate.name} from plugin ${plugin.id}: invalid parameters schema.`, candidate.name);
        continue;
      }
      if (!candidate.hasExecute) {
        this.rejectPluginTool(plugin, `Ignoring tool ${candidate.name} from plugin ${plugin.id}: missing execute function.`, candidate.name);
        continue;
      }
      const toolName = candidate.name;

      normalizedTools.push({
        name: toolName,
        description: candidate.description,
        parameters: PluginArgumentsSchema,
        parametersJsonSchema: candidate.parametersJsonSchema,
        metadata: {
          source: 'plugin',
          pluginId: plugin.id,
          pluginName: plugin.name,
          pluginScope: plugin.scope,
          riskLevel: plugin.riskLevel
        },
        execute: async (args: Record<string, unknown>) => {
          const validation = PluginArgumentsSchema.safeParse(args);
          if (!validation.success) {
            const issueText = validation.error.issues
              .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
              .join('; ');
            throw new Error(`Invalid plugin tool arguments for ${toolName}: ${issueText}`);
          }
          return this.executePluginToolInWorker({
            code,
            codePath,
            toolName,
            args: validation.data as Record<string, unknown>
          });
        }
      });
    }

    return normalizedTools;
  }

  private discoverPluginToolsInWorker(params: {
    code: string;
    codePath: string;
  }): Promise<DiscoveredPluginTool[]> {
    const { code, codePath } = params;

    return new Promise((resolve, reject) => {
      let settled = false;
      const worker = new Worker(PLUGIN_DISCOVERY_WORKER_CODE, {
        eval: true,
        workerData: {
          code,
          filename: codePath,
          loadTimeoutMs: PLUGIN_LOAD_TIMEOUT_MS
        }
      });

      const finish = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        callback();
      };

      const timeout = setTimeout(() => {
        finish(() => {
          void worker.terminate();
          reject(new Error(`Plugin discovery timed out after ${PLUGIN_LOAD_TIMEOUT_MS}ms.`));
        });
      }, PLUGIN_LOAD_TIMEOUT_MS);

      worker.once('message', (message: unknown) => {
        finish(() => {
          void worker.terminate();
          const payload = message as { ok?: boolean; tools?: DiscoveredPluginTool[]; error?: string };
          if (payload?.ok && Array.isArray(payload.tools)) {
            resolve(payload.tools);
            return;
          }
          reject(new Error(payload?.error || 'Unknown plugin discovery worker error.'));
        });
      });

      worker.once('error', (error) => {
        finish(() => {
          reject(error);
        });
      });

      worker.once('exit', (codeValue) => {
        if (codeValue === 0 || settled) {
          return;
        }
        finish(() => {
          reject(new Error(`Plugin discovery worker exited with code ${codeValue}.`));
        });
      });
    });
  }

  private executePluginToolInWorker(params: {
    code: string;
    codePath: string;
    toolName: string;
    args: Record<string, unknown>;
  }): Promise<unknown> {
    const { code, codePath, toolName, args } = params;

    return new Promise((resolve, reject) => {
      let settled = false;
      const worker = new Worker(PLUGIN_WORKER_CODE, {
        eval: true,
        workerData: {
          code,
          filename: codePath,
          toolName,
          args,
          loadTimeoutMs: PLUGIN_LOAD_TIMEOUT_MS,
          maxResultBytes: PLUGIN_MAX_RESULT_BYTES
        }
      });

      const finish = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        callback();
      };

      const timeout = setTimeout(() => {
        finish(() => {
          void worker.terminate();
          reject(new Error(`Plugin tool timed out after ${this.executeTimeoutMs}ms.`));
        });
      }, this.executeTimeoutMs);

      worker.once('message', (message: unknown) => {
        finish(() => {
          void worker.terminate();
          const payload = message as { ok?: boolean; result?: unknown; error?: string };
          if (payload?.ok) {
            resolve(payload.result);
            return;
          }
          reject(new Error(payload?.error || 'Unknown plugin worker error.'));
        });
      });

      worker.once('error', (error) => {
        finish(() => {
          reject(error);
        });
      });

      worker.once('exit', (codeValue) => {
        if (codeValue === 0 || settled) {
          return;
        }
        finish(() => {
          reject(new Error(`Plugin worker exited with code ${codeValue}.`));
        });
      });
    });
  }

  private toNetworkProbeUrl(domain: string): string {
    try {
      return new URL(domain).href;
    } catch {
      return `https://${domain}`;
    }
  }

  private getCapabilityPermissionDenials(capability: PluginCapabilityDeclaration, permissions: PermissionGuard): string[] {
    const required = capability.requiredPermissions;
    if (!required) {
      return [];
    }

    const denials: string[] = [];
    if (required.fileSystem?.read && !permissions.canReadFileSystem()) {
      denials.push(`capability:${capability.id}:fileSystem.read`);
    }
    if (required.fileSystem?.write && !permissions.canWriteFileSystem()) {
      denials.push(`capability:${capability.id}:fileSystem.write`);
    }
    for (const filePath of required.fileSystem?.paths ?? []) {
      const mode = required.fileSystem?.write ? 'write' : 'read';
      if (!permissions.checkFileSystem(filePath, mode)) {
        denials.push(`capability:${capability.id}:fileSystem.path:${filePath}`);
      }
    }

    if (required.network?.enabled && !permissions.isNetworkEnabled()) {
      denials.push(`capability:${capability.id}:network.enabled`);
    }
    for (const domain of required.network?.domains ?? []) {
      if (!permissions.checkNetwork(this.toNetworkProbeUrl(domain))) {
        denials.push(`capability:${capability.id}:network.domain:${domain}`);
      }
    }

    if (required.shell?.enabled && !permissions.isShellEnabled()) {
      denials.push(`capability:${capability.id}:shell.enabled`);
    }
    for (const command of required.shell?.commands ?? []) {
      if (!permissions.checkShellCommand(command)) {
        denials.push(`capability:${capability.id}:shell.command:${command}`);
      }
    }

    return denials;
  }

  private getPluginPermissionDenials(plugin: InstalledPlugin, permissions?: PermissionGuard): string[] {
    if (!permissions) {
      return [];
    }

    return plugin.capabilities.flatMap((capability) =>
      this.getCapabilityPermissionDenials(capability, permissions)
    );
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
          this.auditPluginIssue({
            tool: 'plugin_registry_invalid',
            args: {
              issueCount: validation.error.issues.length
            },
            error: 'Invalid plugin registry entry.',
            policyTags: ['plugin:registry', 'decision:error']
          });
          registryModified = true;
          continue;
        }

        const normalizedPlugin = validation.data;
        try {
          await fs.access(normalizedPlugin.filePath);
          validPlugins.push(normalizedPlugin);
        } catch {
          console.warn(`[PluginManager] Plugin ${normalizedPlugin.id} file not found at ${normalizedPlugin.filePath}, removing from registry.`);
          this.auditPluginIssue({
            tool: 'plugin_registry_missing_file',
            args: {
              pluginId: normalizedPlugin.id,
              scope: normalizedPlugin.scope,
              filePath: normalizedPlugin.filePath
            },
            error: 'Plugin file not found.',
            policyTags: ['plugin:registry', 'plugin:load', 'decision:error']
          });
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

    const registryPlugins = getPluginRegistry() as PluginRegistryEntry[];
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

  async loadAllTools(agentId?: string, permissions?: PermissionGuard): Promise<ToolDefinition[]> {
    await this.init();
    const installed = await this.getInstalledPlugins();
    const pluginsToLoad = installed.filter((plugin) => this.isSupportedScope(plugin.scope, agentId));
    const allTools: ToolDefinition[] = [];
    const seenToolNames = new Set<string>();

    for (const plugin of pluginsToLoad) {
      const permissionDenials = this.getPluginPermissionDenials(plugin, permissions);
      if (permissionDenials.length > 0) {
        this.auditPluginIssue({
          tool: 'plugin_permission_denied',
          args: {
            pluginId: plugin.id,
            scope: plugin.scope,
            deniedRequirements: permissionDenials
          },
          error: 'Plugin requested permissions outside the active agent policy.',
          policyTags: ['plugin:permission', `plugin:${plugin.id}`, `plugin_scope:${plugin.scope}`, 'decision:deny']
        });
        continue;
      }

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
        if (Buffer.byteLength(code, 'utf-8') > PLUGIN_MAX_CODE_BYTES) {
          this.auditPluginIssue({
            tool: 'plugin_code_too_large',
            args: {
              pluginId: plugin.id,
              scope: plugin.scope,
              filePath: plugin.filePath,
              maxBytes: PLUGIN_MAX_CODE_BYTES
            },
            error: 'Plugin code exceeded the maximum load size.',
            policyTags: ['plugin:load', 'plugin:sandbox', 'decision:deny']
          });
          continue;
        }
        const discoveredTools = await this.discoverPluginToolsInWorker({ code, codePath });
        const loadedTools = this.normalizePluginTools(plugin, code, codePath, discoveredTools);
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
        this.auditPluginIssue({
          tool: 'plugin_load_failed',
          args: {
            pluginId: plugin.id,
            scope: plugin.scope,
            filePath: plugin.filePath
          },
          error: getErrorMessage(error),
          policyTags: ['plugin:load', 'decision:error']
        });
      }
    }

    return allTools;
  }
}

export const pluginManager = new PluginManager();
