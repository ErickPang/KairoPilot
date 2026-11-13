import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import path from 'node:path';
import type { PluginConnection, PluginConnectionState, PluginRegistryEntry } from '../../../shared/contracts';
import type { PermissionGuard } from '../security/permissions';
import { packageHash } from './packageManifest';
import { LocalMcpTransport, localMcpEnvironment } from './runtimeSupervisor';

export interface ConnectionContext { sessionId: string; guard: PermissionGuard }
interface LiveConnection {
  plugin: PluginRegistryEntry; definition: PluginConnection; context: ConnectionContext; binding: string;
  client: Client; transport: Transport; state: PluginConnectionState; active: boolean;
}
function connectionMode(connection: PluginConnection) { return connection.transport === 'http' ? 'remote' as const : connection.executionMode; }
function assertContext(definition: PluginConnection, context: ConnectionContext) {
  const guard = context.guard;
  if (!context.sessionId || !guard.getDefaultWorkspacePath() || ['chat_only', 'read_only_workspace'].includes(guard.getExecutionProfile())) throw new Error('External MCP requires an executable task; chat-only and read-only tasks cannot start external programs or services.');
  if (definition.transport === 'http' && !guard.checkNetwork(definition.url)) throw new Error('MCP endpoint is outside the task network policy.');
  if (definition.transport === 'stdio') {
    if (definition.executionMode === 'restricted-local') throw new Error('Restricted local MCP is not available on this platform yet. No unrestricted fallback was started.');
    if (!path.isAbsolute(definition.command) || !guard.isShellEnabled() || !guard.checkShellCommand(definition.command)) throw new Error('Trusted local MCP requires an absolute executable explicitly allowed by task command policy.');
  }
}
function binding(plugin: PluginRegistryEntry, context: ConnectionContext) { return JSON.stringify([context.sessionId, plugin.codeHash, context.guard.getDefaultWorkspacePath(), context.guard.getApprovalContextKey()]); }

export class ConnectionManager {
  private live = new Map<string, LiveConnection>();
  private key(plugin: PluginRegistryEntry, id: string, context: ConnectionContext) { return JSON.stringify([plugin.id, plugin.scope, id, context.sessionId]); }
  states(plugin: PluginRegistryEntry, context: ConnectionContext): PluginConnectionState[] {
    return (plugin.connections || []).map(definition => {
      const item = this.live.get(this.key(plugin, definition.id, context));
      if (item?.binding === binding(plugin, context) && item.active) return { ...item.state, tools: [...item.state.tools] };
      return { id: definition.id, name: definition.name, transport: definition.transport, executionMode: connectionMode(definition), status: definition.transport === 'stdio' && definition.executionMode === 'restricted-local' ? 'unavailable' : 'disconnected', tools: [] };
    });
  }
  async connect(plugin: PluginRegistryEntry, id: string, context: ConnectionContext, token?: string) {
    const definition = plugin.connections?.find(item => item.id === id); if (!definition) throw new Error('Unknown MCP connection.');
    assertContext(definition, context);
    if (token && definition.transport !== 'http') throw new Error('This connection does not accept a bearer token.');
    const key = this.key(plugin, id, context); await this.disconnect(plugin.id, plugin.scope, context.sessionId, id);
    if (this.live.size >= 8) throw new Error('At most eight MCP connections may be active. Disconnect another connection first.');
    const client = new Client({ name: 'KairoPilot', version: '0.2.0' }, { capabilities: {} });
    const transport = definition.transport === 'http' ? new StreamableHTTPClientTransport(new URL(definition.url), {
      requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
      reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
      fetch: async (url, init) => {
        if (new URL(url).href !== new URL(definition.url).href || !context.guard.checkNetwork(String(url))) throw new Error('MCP request target changed.');
        const response = await fetch(url, { ...init, redirect: 'error', signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
        const length = Number(response.headers.get('content-length') || 0); if (length > 1024 * 1024) { await response.body?.cancel(); throw new Error('MCP response exceeds 1 MiB.'); }
        if (!response.body) return response;
        let bytes = 0;
        return new Response(response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) { bytes += chunk.length; if (bytes > 1024 * 1024) throw new Error('MCP response exceeds 1 MiB.'); controller.enqueue(chunk); } })), { status: response.status, statusText: response.statusText, headers: response.headers });
      }
    }) : new LocalMcpTransport(definition.command, definition.args.map(arg => arg.split('${PLUGIN_ROOT}').join(path.join(path.dirname(plugin.filePath), 'resources'))), context.guard.getDefaultWorkspacePath()!, localMcpEnvironment());
    const item: LiveConnection = { plugin, definition, context, binding: binding(plugin, context), client, transport, active: true, state: { id, name: definition.name, transport: definition.transport, executionMode: connectionMode(definition), status: 'disconnected', tools: [] } };
    this.live.set(key, item);
    client.onclose = () => { item.active = false; item.state.status = 'disconnected'; if (this.live.get(key) === item) this.live.delete(key); };
    client.onerror = () => { item.active = false; item.state.status = 'disconnected'; void transport.close().catch(() => {}); };
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => { item.state.status = 'catalog_changed'; });
    try {
      await client.connect(transport, { timeout: 10000 });
      const tools = await this.catalog(client);
      if (!item.active || this.live.get(key) !== item) throw new Error('MCP connection was cancelled or replaced.');
      item.state.tools = tools; item.state.catalogHash = packageHash(JSON.stringify(tools)); item.state.status = 'catalog_changed';
      return item.state;
    } catch (error) { if (this.live.get(key) === item) this.live.delete(key); item.active = false; await transport.close().catch(() => {}); throw error; }
  }
  private async catalog(client: Client, signal?: AbortSignal) {
    const deadline = signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
    const tools: PluginConnectionState['tools'] = []; let cursor: string | undefined; const seen = new Set<string>();
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: 10000, signal: deadline });
      for (const tool of page.tools) { if (tools.some(item => item.name === tool.name)) throw new Error('Duplicate MCP tool name.'); tools.push({ name: tool.name, description: tool.description || tool.name, inputSchema: tool.inputSchema }); }
      if (tools.length > 200 || Buffer.byteLength(JSON.stringify(tools)) > 512 * 1024 || seen.size >= 10) throw new Error('MCP catalog exceeds the limit.');
      cursor = page.nextCursor; if (cursor && seen.has(cursor)) throw new Error('MCP catalog pagination did not advance.'); if (cursor) seen.add(cursor);
    } while (cursor);
    return tools.sort((a, b) => a.name.localeCompare(b.name));
  }
  approveCatalog(plugin: PluginRegistryEntry, id: string, expectedHash: string, context: ConnectionContext) {
    const item = this.live.get(this.key(plugin, id, context));
    if (!item?.active || item.binding !== binding(plugin, context) || item.state.catalogHash !== expectedHash) throw new Error('MCP catalog changed before review. Reconnect first.');
    item.state.status = 'connected'; return item.state;
  }
  async call(plugin: PluginRegistryEntry, connectionId: string, name: string, args: Record<string, unknown>, context: ConnectionContext, catalogHash: string, signal?: AbortSignal) {
    const item = this.live.get(this.key(plugin, connectionId, context));
    if (!item?.active || item.binding !== binding(plugin, context) || item.state.status !== 'connected' || item.state.catalogHash !== catalogHash) throw new Error('MCP connection, task authorization or tool catalog changed. Reconnect and review its tools.');
    assertContext(item.definition, context);
    let catalog;
    try { catalog = await this.catalog(item.client, signal); }
    catch (error) { await this.disconnect(plugin.id, plugin.scope, context.sessionId, connectionId); throw error; }
    if (packageHash(JSON.stringify(catalog)) !== catalogHash || item.state.status !== 'connected') {
      item.state.tools = catalog; item.state.catalogHash = packageHash(JSON.stringify(catalog)); item.state.status = 'catalog_changed';
      throw new Error('MCP tool definitions changed. Review the new catalog before calling a tool.');
    }
    if (!item.active || signal?.aborted) throw new Error('MCP call cancelled before dispatch.');
    const tool = item.state.tools.find(tool => tool.name === name); if (!tool) throw new Error('MCP tool is no longer available.');
    z.fromJSONSchema(tool.inputSchema).parse(args);
    let result;
    try { result = await item.client.callTool({ name, arguments: args }, undefined, { timeout: 30000, signal }); }
    catch (error) {
      // Cancellation is a protocol hint; stopping our owned local process enforces local termination.
      await this.disconnect(plugin.id, plugin.scope, context.sessionId, connectionId);
      if (signal?.aborted) throw new Error('MCP call cancelled; side effects may already exist. Reconnect before retrying.');
      throw error;
    }
    if (signal?.aborted || !item.active) {
      await this.disconnect(plugin.id, plugin.scope, context.sessionId, connectionId);
      throw new Error('MCP call cancelled; side effects may already exist.');
    }
    if (Buffer.byteLength(JSON.stringify(result)) > 256 * 1024) throw new Error('MCP result exceeds 256 KiB.');
    return result;
  }
  async disconnect(pluginId?: string, scope?: string, sessionId?: string, id?: string) {
    const pending: Promise<unknown>[] = [];
    for (const [key, item] of this.live) if ((!pluginId || item.plugin.id === pluginId) && (!scope || item.plugin.scope === scope) && (!sessionId || item.context.sessionId === sessionId) && (!id || item.definition.id === id)) {
      this.live.delete(key); item.active = false; pending.push(item.transport.close());
    }
    await Promise.all(pending);
  }
}
export const pluginConnections = new ConnectionManager();
export function revokePluginConnections(sessionId?: string) {
  void pluginConnections.disconnect(undefined, undefined, sessionId).catch(() => console.error('Unable to stop a revoked MCP connection.'));
}
