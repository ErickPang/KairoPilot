import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { ToolDefinition } from '../llm/types';
import type { PermissionGuard } from '../security/permissions';
import { getPluginRegistry, savePluginRegistry } from '../../store/config';
import { addAuditLog } from '../../store/audit';
import {
  PluginCapabilityDeclaration,
  PluginImportReviewArgs,
  PluginInstallArgs,
  PluginInstallReview,
  PluginInstallReviewArgs,
  PluginManifest,
  PluginRegistryEntry,
  PluginRollbackArgs,
  PluginStoreEntry,
  PluginUpdateReviewArgs,
  PluginVersionDiff,
  SkillReviewFinding
} from '../../../shared/contracts';
import { extractImportedSkillArchive, findImportedSkillFiles } from '../skills/skillImportUtils';

type InstalledPlugin = PluginRegistryEntry;

interface BuiltInStorePlugin {
  manifest: PluginManifest;
  code: string;
}

interface MaterializedPlugin {
  manifest: PluginManifest;
  code: string;
  marketplace?: string;
  registryUrl?: string;
  source: InstalledPlugin['source'];
}

interface PreparedPluginInstall {
  requestId: string;
  operation: PluginInstallReview['operation'];
  scope: string;
  plugin: MaterializedPlugin;
  codeHash: string;
  targetFilePath: string;
  existingPlugin?: InstalledPlugin;
  review: PluginInstallReview;
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
const zodModule = require('zod');
const z = zodModule.z || zodModule;

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

function formatValidationIssues(error) {
  const issues = Array.isArray(error && error.issues) ? error.issues : [];
  if (issues.length === 0) {
    return error && error.message ? String(error.message) : 'Invalid arguments.';
  }
  return issues
    .map((issue) => {
      const path = Array.isArray(issue.path) && issue.path.length > 0 ? issue.path.join('.') : 'root';
      return path + ': ' + issue.message;
    })
    .join('; ');
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
    if (!tool.parameters || typeof tool.parameters.safeParse !== 'function') {
      throw new Error('Plugin tool has no executable parameters schema: ' + workerData.toolName);
    }
    const validation = tool.parameters.safeParse(workerData.args || {});
    if (!validation.success) {
      throw new Error('Invalid plugin tool arguments for ' + workerData.toolName + ': ' + formatValidationIssues(validation.error));
    }
    const result = await Promise.resolve(tool.execute(validation.data));
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
  engineVersion: z.string().trim().optional(),
  homepage: z.string().trim().optional(),
  license: z.string().trim().optional(),
  checksum: z.string().trim().optional(),
  signature: z.string().trim().optional(),
  entry: z.string().trim().optional(),
  tools: z.array(z.object({
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
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
  scope: z.string().trim().min(1),
  codeHash: z.string().trim().optional(),
  source: z.object({
    type: z.enum(['builtin-store', 'local', 'registry']),
    id: z.string().trim().optional(),
    url: z.string().trim().optional()
  }).optional(),
  enabled: z.boolean().optional(),
  previousVersion: z.object({
    version: z.string().trim().min(1),
    filePath: z.string().trim().min(1),
    codeHash: z.string().trim().optional(),
    backedUpAt: z.number().finite().nonnegative(),
    manifest: PluginManifestSchema.optional()
  }).optional()
});

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function hashPluginCode(code: string) {
  return createHash('sha256').update(code).digest('hex');
}

function withCodeChecksum(plugin: BuiltInStorePlugin): PluginManifest {
  const checksum = hashPluginCode(plugin.code);
  return {
    ...plugin.manifest,
    checksum: plugin.manifest.checksum ?? checksum
  };
}

function assertHttpsUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid plugin registry URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`Only HTTPS plugin sources are supported: ${url}`);
  }
  return parsed.toString();
}

async function fetchText(url: string) {
  const normalizedUrl = assertHttpsUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(normalizedUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${normalizedUrl}: ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url: string) {
  return JSON.parse(await fetchText(url)) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizePluginManifest(value: unknown): PluginManifest | null {
  const validation = PluginManifestSchema.safeParse(value);
  return validation.success ? validation.data : null;
}

function normalizePluginStoreEntry(value: unknown, marketplace?: string, registryUrl?: string): PluginStoreEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const manifest = normalizePluginManifest(value.manifest ?? value);
  const source = isRecord(value.source) ? value.source : null;
  if (!manifest || !source || typeof source.type !== 'string') {
    return null;
  }
  if (source.type === 'http' && typeof source.codeUrl === 'string' && source.codeUrl.trim()) {
    return {
      ...manifest,
      marketplace: typeof value.marketplace === 'string' && value.marketplace.trim() ? value.marketplace.trim() : marketplace,
      registryUrl,
      installedScopes: [],
      source: {
        type: 'http',
        codeUrl: source.codeUrl.trim()
      }
    };
  }
  if (source.type === 'inline' && typeof source.code === 'string') {
    return {
      ...manifest,
      marketplace: typeof value.marketplace === 'string' && value.marketplace.trim() ? value.marketplace.trim() : marketplace,
      registryUrl,
      installedScopes: [],
      source: {
        type: 'inline',
        code: source.code
      }
    };
  }
  return null;
}

function normalizePluginRegistryResponse(payload: unknown, registryUrl: string): PluginStoreEntry[] {
  const marketplace = isRecord(payload) && typeof payload.name === 'string' ? payload.name : undefined;
  const plugins = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.plugins)
      ? payload.plugins
      : [];
  return plugins
    .map((plugin) => normalizePluginStoreEntry(plugin, marketplace, registryUrl))
    .filter((plugin): plugin is PluginStoreEntry => plugin !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function buildPluginReviewFindings(manifest: PluginManifest, code: string): SkillReviewFinding[] {
  const findings: SkillReviewFinding[] = [];
  const riskyCapabilities = manifest.capabilities.filter((capability) => (
    capability.riskLevel === 'high'
    || capability.riskLevel === 'critical'
    || Boolean(capability.requiredPermissions?.fileSystem?.write)
    || Boolean(capability.requiredPermissions?.shell?.enabled)
    || (capability.requiredPermissions?.shell?.commands?.length ?? 0) > 0
  ));
  if (riskyCapabilities.length > 0) {
    findings.push({
      id: 'plugin-privileged-capabilities',
      severity: 'medium',
      title: '包含高权限能力声明',
      detail: `检测到 ${riskyCapabilities.length} 个高权限能力，安装前应确认用途与来源可信。`
    });
  }
  if (/\b(process|require\s*\(|child_process|fs\.|eval\s*\(|Function\s*\()/i.test(code)) {
    findings.push({
      id: 'plugin-sensitive-runtime-pattern',
      severity: 'medium',
      title: '代码中出现敏感运行时模式',
      detail: '检测到 process、require、fs、eval 或 Function 等字样，插件会在受限 worker 中运行，但仍建议复核。'
    });
  }
  if (manifest.riskLevel === 'critical' || manifest.riskLevel === 'high') {
    findings.push({
      id: 'plugin-risk-level',
      severity: manifest.riskLevel === 'critical' ? 'high' : 'medium',
      title: '插件声明为高风险',
      detail: `该插件 manifest 声明风险等级为 ${manifest.riskLevel}。`
    });
  }
  return findings;
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
  private pendingInstallsDir: string;
  private pluginBackupsDir: string;
  private pendingInstalls = new Map<string, PreparedPluginInstall>();
  private executeTimeoutMs: number;

  constructor(options: PluginManagerOptions = {}) {
    const userDataDir = app.getPath('userData');
    this.pluginsDir = path.join(userDataDir, 'plugins');
    this.pendingInstallsDir = path.join(userDataDir, 'pending-plugin-installs');
    this.pluginBackupsDir = path.join(userDataDir, 'plugin-backups');
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

    try {
      await fs.mkdir(this.pendingInstallsDir, { recursive: true });
    } catch (e) { /* ignore */ }

    try {
      await fs.mkdir(this.pluginBackupsDir, { recursive: true });
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

  private normalizePluginTools(plugin: InstalledPlugin, code: string, codePath: string, tools: DiscoveredPluginTool[], permissions?: PermissionGuard): ToolDefinition[] {
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
      const toolPermissionDenials = this.getToolPermissionDenials(plugin, toolName, permissions);
      if (toolPermissionDenials.length > 0) {
        this.auditPluginIssue({
          tool: 'plugin_tool_permission_denied',
          args: {
            pluginId: plugin.id,
            scope: plugin.scope,
            toolName,
            deniedRequirements: toolPermissionDenials
          },
          error: 'Plugin tool requested permissions outside the active agent policy.',
          policyTags: ['plugin:permission', 'plugin:tool', `plugin:${plugin.id}`, `plugin_scope:${plugin.scope}`, 'decision:deny']
        });
        continue;
      }

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

  private getPermissionRequirementDenials(
    required: PluginCapabilityDeclaration['requiredPermissions'] | undefined,
    permissions: PermissionGuard,
    prefix: string
  ): string[] {
    if (!required) {
      return [];
    }

    const denials: string[] = [];
    if (required.fileSystem?.read && !permissions.canReadFileSystem()) {
      denials.push(`${prefix}:fileSystem.read`);
    }
    if (required.fileSystem?.write && !permissions.canWriteFileSystem()) {
      denials.push(`${prefix}:fileSystem.write`);
    }
    for (const filePath of required.fileSystem?.paths ?? []) {
      const mode = required.fileSystem?.write ? 'write' : 'read';
      if (!permissions.checkFileSystem(filePath, mode)) {
        denials.push(`${prefix}:fileSystem.path:${filePath}`);
      }
    }

    if (required.network?.enabled && !permissions.isNetworkEnabled()) {
      denials.push(`${prefix}:network.enabled`);
    }
    for (const domain of required.network?.domains ?? []) {
      if (!permissions.checkNetwork(this.toNetworkProbeUrl(domain))) {
        denials.push(`${prefix}:network.domain:${domain}`);
      }
    }

    if (required.shell?.enabled && !permissions.isShellEnabled()) {
      denials.push(`${prefix}:shell.enabled`);
    }
    for (const command of required.shell?.commands ?? []) {
      if (!permissions.checkShellCommand(command)) {
        denials.push(`${prefix}:shell.command:${command}`);
      }
    }

    return denials;
  }

  private getCapabilityPermissionDenials(capability: PluginCapabilityDeclaration, permissions: PermissionGuard): string[] {
    return this.getPermissionRequirementDenials(capability.requiredPermissions, permissions, `capability:${capability.id}`);
  }

  private getToolPermissionDenials(plugin: InstalledPlugin, toolName: string, permissions?: PermissionGuard): string[] {
    if (!permissions) {
      return [];
    }
    const manifestTool = plugin.tools.find((tool) => tool.name === toolName);
    return this.getPermissionRequirementDenials(manifestTool?.requiredPermissions, permissions, `tool:${toolName}`);
  }

  private getPluginPermissionDenials(plugin: InstalledPlugin, permissions?: PermissionGuard): string[] {
    if (!permissions) {
      return [];
    }

    return plugin.capabilities.flatMap((capability) =>
      this.getCapabilityPermissionDenials(capability, permissions)
    );
  }

  private getBuiltinStoreEntries(installedScopeMap: Map<string, string[]> = new Map()): PluginStoreEntry[] {
    return STORE_PLUGINS.map((plugin) => {
      const manifest = withCodeChecksum(plugin);
      return {
        ...manifest,
        marketplace: 'KairoPilot Curated',
        installedScopes: [...(installedScopeMap.get(manifest.id) ?? [])],
        source: {
          type: 'inline',
          code: plugin.code
        }
      };
    });
  }

  private collectInstalledPluginScopes() {
    const scopeMap = new Map<string, string[]>();
    for (const plugin of getPluginRegistry()) {
      const scopes = scopeMap.get(plugin.id) ?? [];
      scopes.push(plugin.scope);
      scopeMap.set(plugin.id, scopes);
    }
    return scopeMap;
  }

  async getStorePlugins(): Promise<PluginStoreEntry[]> {
    return this.getBuiltinStoreEntries(this.collectInstalledPluginScopes());
  }

  async getRemoteStorePlugins(registryUrl: string): Promise<PluginStoreEntry[]> {
    const normalizedUrl = assertHttpsUrl(registryUrl);
    const payload = await fetchJson(normalizedUrl);
    const installedScopeMap = this.collectInstalledPluginScopes();
    return normalizePluginRegistryResponse(payload, normalizedUrl).map((plugin) => ({
      ...plugin,
      installedScopes: [...(installedScopeMap.get(plugin.id) ?? [])]
    }));
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

  private getPluginTargetFilePath(id: string, scope: string) {
    const safeScope = scope.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.pluginsDir, `${id}_${safeScope}.js`);
  }

  private findInstalledPlugin(id: string, scope: string) {
    return getPluginRegistry().find((plugin) => plugin.id === id && plugin.scope === scope) as InstalledPlugin | undefined;
  }

  private buildVersionDiff(existingPlugin: InstalledPlugin | undefined, manifest: PluginManifest, codeHash: string): PluginVersionDiff | undefined {
    if (!existingPlugin) {
      return undefined;
    }
    const existingTools = new Set((existingPlugin.tools ?? []).map((tool) => tool.name));
    const nextTools = new Set((manifest.tools ?? []).map((tool) => tool.name));
    const existingCapabilities = new Set((existingPlugin.capabilities ?? []).map((capability) => capability.id));
    const nextCapabilities = new Set((manifest.capabilities ?? []).map((capability) => capability.id));
    const diffSet = (left: Set<string>, right: Set<string>) => Array.from(left).filter((item) => !right.has(item)).sort();
    const sameSet = (left: Set<string>, right: Set<string>) => Array.from(left).filter((item) => right.has(item)).sort();

    return {
      fromVersion: existingPlugin.version,
      toVersion: manifest.version,
      fromHash: existingPlugin.codeHash,
      toHash: codeHash,
      toolChanges: {
        added: diffSet(nextTools, existingTools),
        removed: diffSet(existingTools, nextTools),
        unchanged: sameSet(nextTools, existingTools)
      },
      capabilityChanges: {
        added: diffSet(nextCapabilities, existingCapabilities),
        removed: diffSet(existingCapabilities, nextCapabilities),
        unchanged: sameSet(nextCapabilities, existingCapabilities)
      }
    };
  }

  private buildInstallReview(params: {
    requestId: string;
    operation: PluginInstallReview['operation'];
    scope: string;
    plugin: MaterializedPlugin;
    codeHash: string;
    existingPlugin?: InstalledPlugin;
  }): PluginInstallReview {
    const findings = buildPluginReviewFindings(params.plugin.manifest, params.plugin.code);
    const highCount = findings.filter((finding) => finding.severity === 'high').length;
    const mediumCount = findings.filter((finding) => finding.severity === 'medium').length;
    const recommendation = highCount > 0 ? 'block' : mediumCount > 0 ? 'caution' : 'allow';
    const versionDiff = this.buildVersionDiff(params.existingPlugin, params.plugin.manifest, params.codeHash);
    const operationLabel = params.operation === 'update' ? '更新' : params.operation === 'import' ? '导入' : '安装';
    return {
      requestId: params.requestId,
      pluginId: params.plugin.manifest.id,
      pluginName: params.plugin.manifest.name,
      scope: params.scope,
      version: params.plugin.manifest.version,
      author: params.plugin.manifest.author,
      marketplace: params.plugin.marketplace,
      recommendation,
      summary: `${operationLabel}插件 ${params.plugin.manifest.name}，版本 ${params.plugin.manifest.version}，检测到 ${findings.length} 项风险提示。`,
      findings,
      downloadedBytes: Buffer.byteLength(params.plugin.code, 'utf-8'),
      codeHash: params.codeHash,
      versionDiff,
      operation: params.operation
    };
  }

  private materializeBuiltinPlugin(id: string): MaterializedPlugin {
    const builtinPlugin = getStorePluginById(id);
    if (!builtinPlugin) {
      throw new Error('Plugin not found in store');
    }
    return {
      manifest: withCodeChecksum(builtinPlugin),
      code: builtinPlugin.code,
      marketplace: 'KairoPilot Curated',
      source: {
        type: 'builtin-store',
        id
      }
    };
  }

  private async materializeStorePlugin(id: string, registryUrl?: string): Promise<MaterializedPlugin> {
    if (!registryUrl) {
      return this.materializeBuiltinPlugin(id);
    }
    const storePlugins = await this.getRemoteStorePlugins(registryUrl);
    const storePlugin = storePlugins.find((plugin) => plugin.id === id);
    if (!storePlugin) {
      throw new Error(`Plugin ${id} not found in registry.`);
    }
    const code = storePlugin.source.type === 'inline'
      ? storePlugin.source.code
      : await fetchText(storePlugin.source.codeUrl);
    const codeHash = hashPluginCode(code);
    if (storePlugin.checksum && storePlugin.checksum !== codeHash) {
      throw new Error('Plugin checksum mismatch.');
    }
    return {
      manifest: {
        id: storePlugin.id,
        name: storePlugin.name,
        description: storePlugin.description,
        version: storePlugin.version,
        author: storePlugin.author,
        icon: storePlugin.icon,
        engineVersion: storePlugin.engineVersion,
        homepage: storePlugin.homepage,
        license: storePlugin.license,
        checksum: storePlugin.checksum ?? codeHash,
        signature: storePlugin.signature,
        entry: storePlugin.entry,
        tools: storePlugin.tools,
        capabilities: storePlugin.capabilities,
        riskLevel: storePlugin.riskLevel
      },
      code,
      marketplace: storePlugin.marketplace,
      registryUrl,
      source: {
        type: 'registry',
        id,
        url: registryUrl
      }
    };
  }

  private async prepareMaterializedPluginInstall(params: {
    operation: PluginInstallReview['operation'];
    scope: string;
    plugin: MaterializedPlugin;
    allowExisting: boolean;
  }): Promise<PluginInstallReview> {
    const manifestValidation = PluginManifestSchema.safeParse(params.plugin.manifest);
    if (!manifestValidation.success) {
      throw new Error('Invalid plugin manifest.');
    }
    const normalizedPlugin = {
      ...params.plugin,
      manifest: manifestValidation.data
    };
    const existingPlugin = this.findInstalledPlugin(normalizedPlugin.manifest.id, params.scope);
    if (existingPlugin && !params.allowExisting) {
      throw new Error(`Plugin ${normalizedPlugin.manifest.id} is already installed in scope ${params.scope}.`);
    }
    const codeHash = hashPluginCode(normalizedPlugin.code);
    if (normalizedPlugin.manifest.checksum && normalizedPlugin.manifest.checksum !== codeHash) {
      throw new Error('Plugin checksum mismatch.');
    }
    const requestId = randomUUID();
    const targetFilePath = this.getPluginTargetFilePath(normalizedPlugin.manifest.id, params.scope);
    const review = this.buildInstallReview({
      requestId,
      operation: params.operation,
      scope: params.scope,
      plugin: normalizedPlugin,
      codeHash,
      existingPlugin
    });
    this.pendingInstalls.set(requestId, {
      requestId,
      operation: params.operation,
      scope: params.scope,
      plugin: normalizedPlugin,
      codeHash,
      targetFilePath,
      existingPlugin,
      review
    });
    return review;
  }

  async preparePluginInstallReview(args: PluginInstallReviewArgs): Promise<PluginInstallReview> {
    const scope = args.scope?.trim() || 'public';
    const plugin = await this.materializeStorePlugin(args.id, args.registryUrl);
    return this.prepareMaterializedPluginInstall({
      operation: 'install',
      scope,
      plugin,
      allowExisting: false
    });
  }

  async preparePluginUpdateReview(args: PluginUpdateReviewArgs): Promise<PluginInstallReview> {
    const scope = args.scope?.trim() || 'public';
    const plugin = await this.materializeStorePlugin(args.id, args.registryUrl);
    return this.prepareMaterializedPluginInstall({
      operation: 'update',
      scope,
      plugin,
      allowExisting: true
    });
  }

  async preparePluginImportReview(args: PluginImportReviewArgs): Promise<PluginInstallReview> {
    const sourceFile = args.sourceFile?.trim();
    if (!sourceFile) {
      throw new Error('Invalid plugin archive path.');
    }
    const resolvedSourceFile = await fs.realpath(sourceFile);
    const sourceStats = await fs.stat(resolvedSourceFile);
    if (!sourceStats.isFile()) {
      throw new Error('Invalid plugin archive path.');
    }
    if (path.extname(resolvedSourceFile).toLowerCase() !== '.zip') {
      throw new Error('Plugin imports require a .zip archive.');
    }

    const extractionDir = path.join(this.pendingInstallsDir, 'imports', randomUUID());
    try {
      await extractImportedSkillArchive(resolvedSourceFile, extractionDir);
      const pluginFiles = await findImportedSkillFiles(extractionDir, 'plugin.json');
      if (pluginFiles.length === 0) {
        throw new Error('Plugin archive must include plugin.json.');
      }
      if (pluginFiles.length > 1) {
        throw new Error('Plugin archive must include exactly one plugin.json.');
      }
      const pluginDir = path.dirname(pluginFiles[0]);
      const rawManifest = await fs.readFile(pluginFiles[0], 'utf-8');
      const manifest = normalizePluginManifest(JSON.parse(rawManifest));
      if (!manifest) {
        throw new Error('Invalid plugin manifest.');
      }
      const entry = manifest.entry?.trim() || 'index.js';
      if (path.isAbsolute(entry) || entry.includes('..')) {
        throw new Error('Invalid plugin entry path.');
      }
      const code = await fs.readFile(path.join(pluginDir, entry), 'utf-8');
      return await this.prepareMaterializedPluginInstall({
        operation: 'import',
        scope: args.scope?.trim() || 'public',
        plugin: {
          manifest,
          code,
          marketplace: 'Local Import',
          source: {
            type: 'local',
            id: manifest.id
          }
        },
        allowExisting: false
      });
    } finally {
      await fs.rm(extractionDir, { recursive: true, force: true });
    }
  }

  async installReviewedPlugin(args: PluginInstallArgs): Promise<boolean> {
    const requestId = args.requestId?.trim();
    if (!requestId) {
      throw new Error('Invalid plugin install request id.');
    }
    const preparedInstall = this.pendingInstalls.get(requestId);
    if (!preparedInstall) {
      throw new Error('Plugin install request not found or already handled.');
    }

    await fs.mkdir(this.pluginsDir, { recursive: true });
    let previousVersion: InstalledPlugin['previousVersion'] | undefined;
    if (preparedInstall.existingPlugin) {
      const backupFilePath = path.join(
        this.pluginBackupsDir,
        `${preparedInstall.existingPlugin.id}_${preparedInstall.existingPlugin.scope.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.js`
      );
      try {
        await fs.mkdir(this.pluginBackupsDir, { recursive: true });
        await fs.copyFile(preparedInstall.existingPlugin.filePath, backupFilePath);
        previousVersion = {
          version: preparedInstall.existingPlugin.version,
          filePath: backupFilePath,
          codeHash: preparedInstall.existingPlugin.codeHash,
          backedUpAt: Date.now(),
          manifest: {
            id: preparedInstall.existingPlugin.id,
            name: preparedInstall.existingPlugin.name,
            description: preparedInstall.existingPlugin.description,
            version: preparedInstall.existingPlugin.version,
            author: preparedInstall.existingPlugin.author,
            icon: preparedInstall.existingPlugin.icon,
            engineVersion: preparedInstall.existingPlugin.engineVersion,
            homepage: preparedInstall.existingPlugin.homepage,
            license: preparedInstall.existingPlugin.license,
            checksum: preparedInstall.existingPlugin.checksum,
            signature: preparedInstall.existingPlugin.signature,
            entry: preparedInstall.existingPlugin.entry,
            tools: preparedInstall.existingPlugin.tools,
            capabilities: preparedInstall.existingPlugin.capabilities,
            riskLevel: preparedInstall.existingPlugin.riskLevel
          }
        };
      } catch {
        previousVersion = undefined;
      }
    }

    await fs.writeFile(preparedInstall.targetFilePath, preparedInstall.plugin.code, 'utf-8');
    const nextPlugin: InstalledPlugin = {
      ...preparedInstall.plugin.manifest,
      installedAt: preparedInstall.existingPlugin?.installedAt ?? Date.now(),
      filePath: preparedInstall.targetFilePath,
      scope: preparedInstall.scope,
      codeHash: preparedInstall.codeHash,
      source: preparedInstall.plugin.source,
      enabled: preparedInstall.existingPlugin?.enabled ?? true,
      previousVersion
    };
    const registryPlugins = (getPluginRegistry() as InstalledPlugin[])
      .filter((plugin) => !(plugin.id === nextPlugin.id && plugin.scope === nextPlugin.scope));
    registryPlugins.push(nextPlugin);
    savePluginRegistry(registryPlugins);
    this.pendingInstalls.delete(requestId);
    return true;
  }

  discardPreparedPluginInstall(args: PluginInstallArgs): boolean {
    const requestId = args.requestId?.trim();
    if (!requestId) {
      throw new Error('Invalid plugin install request id.');
    }
    this.pendingInstalls.delete(requestId);
    return true;
  }

  async rollbackPlugin(args: PluginRollbackArgs): Promise<boolean> {
    const plugin = this.findInstalledPlugin(args.id, args.scope);
    if (!plugin?.previousVersion) {
      throw new Error(`Plugin ${args.id} in scope ${args.scope} has no rollback snapshot.`);
    }
    await fs.copyFile(plugin.previousVersion.filePath, plugin.filePath);
    const restoredManifest = plugin.previousVersion.manifest ?? plugin;
    const restoredPlugin: InstalledPlugin = {
      ...plugin,
      ...restoredManifest,
      codeHash: plugin.previousVersion.codeHash,
      previousVersion: undefined
    };
    const registryPlugins = (getPluginRegistry() as InstalledPlugin[])
      .filter((entry) => !(entry.id === args.id && entry.scope === args.scope));
    registryPlugins.push(restoredPlugin);
    savePluginRegistry(registryPlugins);
    return true;
  }

  async installPlugin(id: string, scope: string = 'public'): Promise<boolean> {
    await this.init();
    const storePlugin = getStorePluginById(id);
    if (!storePlugin) throw new Error('Plugin not found in store');
    const manifest = withCodeChecksum(storePlugin);
    const manifestValidation = PluginManifestSchema.safeParse(manifest);
    if (!manifestValidation.success) {
      throw new Error('Invalid plugin manifest.');
    }

    const installed = await this.getInstalledPlugins();
    // Allow installing the same plugin in different scopes
    if (installed.find(p => p.id === id && p.scope === scope)) return true;

    // "Download" code
    const code = await getPluginCode(id);
    const codeHash = hashPluginCode(code);
    if (manifestValidation.data.checksum && manifestValidation.data.checksum !== codeHash) {
      throw new Error('Plugin checksum mismatch.');
    }
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
      codeHash,
      source: {
        type: 'builtin-store',
        id
      },
      enabled: true
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

  async setPluginEnabled(id: string, scope: string, enabled: boolean): Promise<boolean> {
    await this.init();
    const installed = await this.getInstalledPlugins();
    const plugin = installed.find(p => p.id === id && p.scope === scope);
    if (!plugin) {
      throw new Error(`Plugin ${id} is not installed in scope ${scope}.`);
    }

    const registryPlugins = (getPluginRegistry() as InstalledPlugin[]).map((entry) => {
      if (entry.id === id && entry.scope === scope) {
        return {
          ...entry,
          enabled
        };
      }
      return entry;
    });
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
      if (plugin.enabled === false) {
        continue;
      }

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
        const codeHash = hashPluginCode(code);
        if (plugin.codeHash && plugin.codeHash !== codeHash) {
          this.auditPluginIssue({
            tool: 'plugin_integrity_failed',
            args: {
              pluginId: plugin.id,
              scope: plugin.scope,
              filePath: plugin.filePath,
              expectedHash: plugin.codeHash,
              actualHash: codeHash
            },
            error: 'Plugin code hash does not match the installed registry record.',
            policyTags: ['plugin:load', 'plugin:integrity', 'decision:deny']
          });
          continue;
        }
        const discoveredTools = await this.discoverPluginToolsInWorker({ code, codePath });
        const loadedTools = this.normalizePluginTools(plugin, code, codePath, discoveredTools, permissions);
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
