import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PluginPackage, PluginRegistryEntry, PluginInstallReview, PluginStoreEntry } from '../../../shared/contracts';
import { getPluginRegistry, savePluginRegistry } from '../../store/config';
import { PluginIdSchema, parsePluginPackage, packageContent, packageHash } from './packageManifest';
import { readPluginArchive } from './packageArchive';

interface PreparedPackage { value: PluginPackage; scope: string; previous?: PluginRegistryEntry; operation: PluginInstallReview['operation']; source: PluginRegistryEntry['source'] }
export function supportedPluginScope(scope: string, owner?: string) { return scope === 'public' || scope === 'workspace' && (!owner || owner === 'workbench') || scope === 'agent:workbench' && owner === 'workbench'; }
export async function fetchPluginResource(url: string) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.username || target.password) throw new Error('Plugin sources require HTTPS without embedded credentials.');
  const response = await fetch(target, { signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!response.ok || !response.body) throw new Error(`Plugin download failed: HTTP ${response.status}.`);
  const reader = response.body.getReader(); const parts: Buffer[] = []; let size = 0;
  try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 2 * 1024 * 1024) throw new Error('Plugin download exceeds 2 MiB.'); parts.push(Buffer.from(chunk.value)); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(parts).toString('utf8');
}

export class PluginPackageManager {
  private pending = new Map<string, PreparedPackage>();
  private mutation: Promise<unknown> = Promise.resolve();
  private root() { return path.join(app.getPath('userData'), 'plugin-packages'); }
  private mutate<T>(action: () => Promise<T>): Promise<T> { const result = this.mutation.then(action); this.mutation = result.catch(() => {}); return result; }
  async installed(): Promise<PluginRegistryEntry[]> {
    return getPluginRegistry().map(item => ({ ...item, tools: item.tools || [], capabilities: item.capabilities || [], runtimeStatus: item.packageVersion === 1 ? 'ready' : 'legacy_blocked' }));
  }
  async read(item: PluginRegistryEntry): Promise<PluginPackage> {
    if (item.packageVersion !== 1) throw new Error('Legacy JavaScript plugins are disabled. Convert this plugin to a declarative MCP package.');
    const content = await fs.readFile(item.filePath, 'utf8');
    if (!item.codeHash || packageHash(content) !== item.codeHash) throw new Error('Plugin package integrity changed. Review the package again.');
    const value = parsePluginPackage(JSON.parse(content));
    if (value.manifest.id !== item.id || packageContent(value) !== content) throw new Error('Plugin package identity changed.');
    for (const [key, expected] of Object.entries(value.manifest)) if (JSON.stringify((item as unknown as Record<string, unknown>)[key]) !== JSON.stringify(expected)) throw new Error('Installed plugin metadata differs from the reviewed package.');
    const root = await fs.realpath(path.dirname(item.filePath));
    if (root !== path.dirname(item.filePath)) throw new Error('Plugin package directory was redirected.');
    for (const [name, expected] of Object.entries(value.files)) {
      const file = path.join(root, 'resources', name);
      if (await fs.realpath(file) !== file || await fs.readFile(file, 'utf8') !== expected) throw new Error('Plugin resource integrity changed.');
    }
    return value;
  }
  async stores(url?: string): Promise<PluginStoreEntry[]> {
    if (!url) return [];
    const payload = JSON.parse(await fetchPluginResource(url));
    const entries: unknown[] = Array.isArray(payload) ? payload : payload.plugins;
    if (!Array.isArray(entries) || entries.length > 100) throw new Error('Invalid plugin registry.');
    return entries.map(entry => { const value = parsePluginPackage(entry); return { ...value.manifest, registryUrl: url, installedScopes: getPluginRegistry().filter(item => item.id === value.manifest.id).map(item => item.scope), source: { type: 'package' as const, package: value } }; });
  }
  prepare(value: unknown, scope: string, operation: PluginInstallReview['operation'], source: PluginRegistryEntry['source']): PluginInstallReview {
    const pack = parsePluginPackage(value);
    if (!['public', 'workspace', 'agent:workbench'].includes(scope)) throw new Error('Invalid plugin scope.');
    const previous = getPluginRegistry().find(item => item.id === pack.manifest.id && item.scope === scope);
    if (operation !== 'update' && previous) throw new Error('Plugin is already installed.');
    if (operation === 'update' && !previous) throw new Error('Plugin is not installed.');
    const requestId = randomUUID();
    if (this.pending.size >= 30) throw new Error('Close pending plugin reviews first.');
    this.pending.set(requestId, { value: pack, scope, previous, operation, source });
    const content = packageContent(pack);
    const names = pack.manifest.tools.map(item => `${item.connectionId}/${item.name}`), old = previous?.tools.map(item => `${item.connectionId}/${item.name}`) || [];
    return { requestId, pluginId: pack.manifest.id, pluginName: pack.manifest.name, version: pack.manifest.version, author: pack.manifest.author, scope, operation, recommendation: 'caution',
      summary: `安装包包含 ${pack.manifest.skills?.length || 0} 项技能、${pack.manifest.connections?.length || 0} 个 MCP 连接。安装不会启动连接或执行脚本；连接须另行授权。`,
      findings: (pack.manifest.connections || []).map(item => ({ id: item.id, severity: 'medium' as const, title: item.name, detail: item.transport === 'http' ? `远程 MCP：${item.url}；服务端权限不受本机目录规则约束。` : `${item.executionMode === 'trusted-local' ? '非隔离本地程序，需要独立信任' : '受限本地模式（本版本尚不可用）'}：${item.command} ${item.args.join(' ')}` })),
      downloadedBytes: Buffer.byteLength(content), codeHash: packageHash(content),
      versionDiff: previous ? { fromVersion: previous.version, toVersion: pack.manifest.version, fromHash: previous.codeHash, toHash: packageHash(content), toolChanges: { added: names.filter(name => !old.includes(name)), removed: old.filter(name => !names.includes(name)), unchanged: names.filter(name => old.includes(name)) }, capabilityChanges: { added: [], removed: [], unchanged: [] } } : undefined };
  }
  async prepareStore(id: string, scope: string, operation: 'install' | 'update', registryUrl?: string) {
    PluginIdSchema.parse(id);
    const entry = (await this.stores(registryUrl)).find(item => item.id === id);
    if (!entry || entry.source.type !== 'package') throw new Error('Plugin not found in registry.');
    return this.prepare(entry.source.package, scope, operation, { type: 'registry', id, url: registryUrl });
  }
  async prepareImport(sourceFile: string, scope: string) {
    const stat = await fs.stat(sourceFile);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error('Invalid or oversized plugin archive.');
    const bytes = await fs.readFile(sourceFile);
    let pack: PluginPackage;
    try { pack = path.extname(sourceFile).toLowerCase() === '.zip' ? readPluginArchive(bytes) : parsePluginPackage(JSON.parse(bytes.toString('utf8'))); }
    catch { throw new Error('Invalid declarative plugin package. Import a valid JSON package or ZIP with plugin.json.'); }
    const operation = getPluginRegistry().some(item => item.id === pack.manifest.id && item.scope === scope) ? 'update' : 'import';
    return this.prepare(pack, scope, operation, { type: 'local', id: pack.manifest.id });
  }
  discard(id: string) { this.pending.delete(id); }
  async install(id: string) {
    return this.mutate(async () => {
      const prepared = this.pending.get(id); if (!prepared) throw new Error('Plugin review expired or was already handled.');
      const current = getPluginRegistry().find(item => item.id === prepared.value.manifest.id && item.scope === prepared.scope);
      if (JSON.stringify(current) !== JSON.stringify(prepared.previous)) throw new Error('Plugin changed after review. Review it again.');
      const dir = path.join(this.root(), randomUUID()); await fs.mkdir(dir, { recursive: true });
      const content = packageContent(prepared.value), filePath = path.join(dir, 'package.json');
      for (const [name, value] of Object.entries(prepared.value.files)) { const file = path.join(dir, 'resources', name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, value, { encoding: 'utf8', mode: 0o600 }); }
      await fs.writeFile(filePath, content, { encoding: 'utf8', mode: 0o600 });
      const { runtimeStatus: _status, ...previous } = current || {};
      const next: PluginRegistryEntry = { ...prepared.value.manifest, filePath, scope: prepared.scope, codeHash: packageHash(content), installedAt: current?.installedAt || Date.now(), enabled: current?.enabled ?? true, source: prepared.source,
        previousVersion: current ? { version: current.version, filePath: current.filePath, codeHash: current.codeHash, backedUpAt: Date.now(), manifest: previous as PluginRegistryEntry } : undefined };
      // Resource revisions are immutable; configuration persistence is the commit point.
      savePluginRegistry([...getPluginRegistry().filter(item => item.id !== next.id || item.scope !== next.scope), next]); this.pending.delete(id); return true;
    });
  }
  async rollback(id: string, scope: string) {
    return this.mutate(async () => {
      const current = getPluginRegistry().find(item => item.id === id && item.scope === scope); const old = current?.previousVersion;
      if (!current || !old?.manifest || old.manifest.packageVersion !== 1) throw new Error('No executable MCP package rollback snapshot.');
      const value: PluginRegistryEntry = { ...old.manifest, id, scope, installedAt: current.installedAt, filePath: old.filePath, codeHash: old.codeHash, enabled: current.enabled, previousVersion: undefined };
      await this.read(value); savePluginRegistry(getPluginRegistry().map(item => item.id === id && item.scope === scope ? value : item)); return true;
    });
  }
  async enable(id: string, scope: string, enabled: boolean) {
    return this.mutate(async () => { const current = getPluginRegistry().find(item => item.id === id && item.scope === scope); if (!current) throw new Error('Plugin not found.'); if (enabled) await this.read(current); savePluginRegistry(getPluginRegistry().map(item => item.id === id && item.scope === scope ? { ...item, enabled } : item)); return true; });
  }
  async uninstall(id: string, scope: string) {
    return this.mutate(async () => { savePluginRegistry(getPluginRegistry().filter(item => item.id !== id || item.scope !== scope)); return true; });
  }
}
export const pluginPackages = new PluginPackageManager();
