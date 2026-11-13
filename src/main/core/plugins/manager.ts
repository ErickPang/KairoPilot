import { z } from 'zod';
import type { PermissionGuard } from '../security/permissions';
import type { ToolDefinition } from '../llm/types';
import type { PluginImportReviewArgs, PluginInstallArgs, PluginInstallReviewArgs, PluginRollbackArgs, PluginUpdateReviewArgs } from '../../../shared/contracts';
import { pluginPackages, supportedPluginScope } from './packageManager';
import { pluginConnections, type ConnectionContext } from './connectionManager';
import { toolError, toolOk } from '../tools/result';

/** Application facade: packages are data; all executable capabilities belong to explicit connections. */
export class PluginManager {
  async init() { /* Installation is lazy; browsing never starts a connection. */ }
  getInstalledPlugins() { return pluginPackages.installed(); }
  getStorePlugins() { return pluginPackages.stores(); }
  getRemoteStorePlugins(url: string) { return pluginPackages.stores(url); }
  preparePluginInstallReview(args: PluginInstallReviewArgs) { return pluginPackages.prepareStore(args.id, args.scope || 'public', 'install', args.registryUrl); }
  preparePluginUpdateReview(args: PluginUpdateReviewArgs) { return pluginPackages.prepareStore(args.id, args.scope || 'public', 'update', args.registryUrl); }
  preparePluginImportReview(args: PluginImportReviewArgs) { return pluginPackages.prepareImport(args.sourceFile, args.scope || 'public'); }
  async installReviewedPlugin(args: PluginInstallArgs) {
    const before = await this.getInstalledPlugins(); const result = await pluginPackages.install(args.requestId);
    for (const item of await this.getInstalledPlugins()) if (before.some(old => old.id === item.id && old.scope === item.scope && old.codeHash !== item.codeHash)) await pluginConnections.disconnect(item.id, item.scope);
    return result;
  }
  discardPreparedPluginInstall(args: PluginInstallArgs) { pluginPackages.discard(args.requestId); return true; }
  async installPlugin(_id: string, _scope = 'public'): Promise<boolean> { throw new Error('Plugin installation requires a reviewed declarative package. JavaScript plugin execution is disabled.'); }
  async rollbackPlugin(args: PluginRollbackArgs) { await pluginConnections.disconnect(args.id, args.scope); const result = await pluginPackages.rollback(args.id, args.scope); await pluginConnections.disconnect(args.id, args.scope); return result; }
  async setPluginEnabled(id: string, scope: string, enabled: boolean) { await pluginConnections.disconnect(id, scope); const result = await pluginPackages.enable(id, scope, enabled); await pluginConnections.disconnect(id, scope); return result; }
  async uninstallPlugin(id: string, scope: string) { await pluginConnections.disconnect(id, scope); const result = await pluginPackages.uninstall(id, scope); await pluginConnections.disconnect(id, scope); return result; }
  async cleanupAgentScopedPlugins(agentId: string) { const plugins = (await this.getInstalledPlugins()).filter(item => item.scope === `agent:${agentId}`); for (const item of plugins) await this.uninstallPlugin(item.id, item.scope); return plugins.length; }

  private async current(id: string, scope: string, expectedHash?: string) {
    if (!supportedPluginScope(scope, 'workbench')) throw new Error('Plugin scope is unavailable in this workbench.');
    const plugin = (await this.getInstalledPlugins()).find(item => item.id === id && item.scope === scope);
    if (!plugin || plugin.enabled === false || plugin.packageVersion !== 1 || expectedHash && expectedHash !== plugin.codeHash) throw new Error('Plugin is disabled, replaced, or requires conversion from JavaScript.');
    await pluginPackages.read(plugin); return plugin;
  }
  async connectionStates(id: string, scope: string, context: ConnectionContext) {
    const plugin = await this.current(id, scope); return pluginConnections.states(plugin, context);
  }
  async connect(id: string, scope: string, connectionId: string, expectedHash: string, context: ConnectionContext, token?: string) {
    const plugin = await this.current(id, scope, expectedHash);
    const state = await pluginConnections.connect(plugin, connectionId, context, token);
    try { await this.current(id, scope, expectedHash); } catch (error) { await pluginConnections.disconnect(id, scope, context.sessionId, connectionId); throw error; }
    return state;
  }
  disconnect(id: string, scope: string, sessionId: string, connectionId: string) { return pluginConnections.disconnect(id, scope, sessionId, connectionId); }
  async approveCatalog(id: string, scope: string, connectionId: string, catalogHash: string, context: ConnectionContext) {
    const plugin = await this.current(id, scope); return pluginConnections.approveCatalog(plugin, connectionId, catalogHash, context);
  }
  async listToolCatalog(owner?: string, permissions?: PermissionGuard, sessionId?: string) {
    if (!permissions || !sessionId || ['chat_only', 'read_only_workspace'].includes(permissions.getExecutionProfile())) return [];
    const plugins = await this.getInstalledPlugins();
    return plugins.filter(item => item.packageVersion === 1 && item.enabled !== false && supportedPluginScope(item.scope, owner))
      .flatMap(plugin => pluginConnections.states(plugin, { sessionId, guard: permissions }).filter(state => state.status === 'connected').flatMap(state => state.tools.map(tool => ({ pluginId: plugin.id, pluginName: plugin.name, scope: plugin.scope, name: `${state.id}/${tool.name}`, description: tool.description, pluginDescription: plugin.description }))));
  }
  async loadPluginTools(selection: { pluginId: string; scope: string; names?: string[] }, owner?: string, permissions?: PermissionGuard, sessionId?: string): Promise<ToolDefinition[]> {
    if (!permissions || !sessionId || !supportedPluginScope(selection.scope, owner)) return [];
    const plugin = await this.current(selection.pluginId, selection.scope);
    const context = { sessionId, guard: permissions };
    const states = pluginConnections.states(plugin, context).filter(state => state.status === 'connected');
    const tools: ToolDefinition[] = [];
    for (const state of states) for (const tool of state.tools) {
      const name = `${state.id}/${tool.name}`;
      if (selection.names && !selection.names.includes(name)) continue;
      const schema = z.fromJSONSchema(tool.inputSchema);
      tools.push({ name, description: tool.description, parameters: schema, parametersJsonSchema: tool.inputSchema,
        metadata: { source: 'plugin', pluginId: plugin.id, pluginName: plugin.name, pluginScope: plugin.scope, riskLevel: 'high', pluginConnectionId: state.id, pluginPackageHash: plugin.codeHash, pluginCatalogHash: state.catalogHash },
        execute: async (args, signal) => {
          const current = await this.current(plugin.id, plugin.scope, plugin.codeHash);
          const result = await pluginConnections.call(current, state.id, tool.name, args, context, state.catalogHash!, signal);
          return result.isError ? toolError('MCP tool reported failure.', result) : toolOk(result);
        }
      });
    }
    return tools;
  }
}
export const pluginManager = new PluginManager();
