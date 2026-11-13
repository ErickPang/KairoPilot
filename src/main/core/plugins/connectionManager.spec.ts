import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionManager } from './connectionManager';
import { localMcpEnvironment } from './runtimeSupervisor';
import { PermissionGuard } from '../security/permissions';
import { createDefaultAgentPermissions, type PluginRegistryEntry } from '../../../shared/contracts';

let manager: ConnectionManager; let calls = 0; let catalogDescription: string; let hold = false;
function guard(profile: 'approved_execution' | 'read_only_workspace' = 'approved_execution', commands: string[] = []) {
  const permissions = createDefaultAgentPermissions(); permissions.executionProfile = profile;
  permissions.fileSystem = { read: true, write: true, allowedPaths: [os.tmpdir()] };
  permissions.network = { enabled: true, allowedDomains: ['mcp.example.invalid'] };
  permissions.shell = { enabled: true, allowedCommands: commands };
  return new PermissionGuard(permissions);
}
function plugin(): PluginRegistryEntry { return { packageVersion: 1, id: 'fixture', name: 'Fixture', description: '', version: '1', author: 'Fixture', filePath: '/synthetic/package.json', codeHash: 'reviewed-package', installedAt: 1, scope: 'public', tools: [], capabilities: [], riskLevel: 'low', connections: [{ id: 'remote', name: 'Remote', transport: 'http', url: 'https://mcp.example.invalid/mcp' }] }; }
function tools() { return [{ name: 'echo', description: catalogDescription, inputSchema: { type: 'object' as const, properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false }, annotations: { readOnlyHint: true } }]; }
beforeEach(() => {
  manager = new ConnectionManager(); calls = 0; catalogDescription = 'Echo'; hold = false;
  vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
    if (init.method === 'GET') return new Response('', { status: 405 });
    if (init.method === 'DELETE') return new Response('', { status: 200 });
    const request = JSON.parse(String(init.body));
    if (!('id' in request)) return new Response(null, { status: 202 });
    let result;
    if (request.method === 'initialize') result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'Fixture', version: '1' } };
    else if (request.method === 'tools/list') result = { tools: tools() };
    else if (request.method === 'tools/call') { calls++; if (hold) return new Promise<Response>(() => {}); result = { content: [{ type: 'text', text: request.params.arguments.value }] }; }
    else throw new Error('Unexpected request: ' + request.method);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), { headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(async () => { await manager.disconnect(); vi.unstubAllGlobals(); });

describe('MCP connection authorization', () => {
  it('requires catalog review after connection, then validates and calls the tool using the SDK', async () => {
    const item = plugin(), context = { sessionId: 'task', guard: guard() };
    const state = await manager.connect(item, 'remote', context, 'synthetic-token'); expect(state.status).toBe('catalog_changed'); expect(calls).toBe(0);
    await expect(manager.call(item, 'remote', 'echo', { value: 'ok' }, context, state.catalogHash!)).rejects.toThrow('review');
    manager.approveCatalog(item, 'remote', state.catalogHash!, context);
    await expect(manager.call(item, 'remote', 'echo', { value: 1 }, context, state.catalogHash!)).rejects.toThrow(); expect(calls).toBe(0);
    expect(await manager.call(item, 'remote', 'echo', { value: 'ok' }, context, state.catalogHash!)).toMatchObject({ content: [{ text: 'ok' }] }); expect(calls).toBe(1);
    const fetchMock = vi.mocked(fetch); expect(fetchMock.mock.calls.some(([, init]) => new Headers(init?.headers).get('Authorization') === 'Bearer synthetic-token')).toBe(true);
    expect(fetchMock.mock.calls.every(([, init]) => init?.redirect === 'error')).toBe(true);
  });
  it('does not reuse a connection across task, package or permission bindings', async () => {
    const item = plugin(), context = { sessionId: 'a', guard: guard() }; const state = await manager.connect(item, 'remote', context); manager.approveCatalog(item, 'remote', state.catalogHash!, context);
    for (const [changed, next] of [[{ ...item, codeHash: 'changed' }, context], [item, { ...context, sessionId: 'b' }], [item, { ...context, guard: guard('read_only_workspace') }]] as const) await expect(manager.call(changed, 'remote', 'echo', { value: 'ok' }, next, state.catalogHash!)).rejects.toThrow();
    expect(calls).toBe(0);
  });
  it('detects tool changes before dispatch even when the server sends no notification', async () => {
    const item = plugin(), context = { sessionId: 'task', guard: guard() }; const state = await manager.connect(item, 'remote', context); const oldHash = state.catalogHash!; manager.approveCatalog(item, 'remote', oldHash, context);
    catalogDescription = 'Changed contract'; await expect(manager.call(item, 'remote', 'echo', { value: 'ok' }, context, oldHash)).rejects.toThrow('definitions changed'); expect(calls).toBe(0); expect(manager.states(item, context)[0].status).toBe('catalog_changed');
    expect(() => manager.approveCatalog(item, 'remote', oldHash, context)).toThrow('changed');
  });
  it('does not connect a read-only task or silently downgrade restricted local mode', async () => {
    const item = plugin(); await expect(manager.connect(item, 'remote', { sessionId: 'task', guard: guard('read_only_workspace') })).rejects.toThrow('read-only');
    item.connections = [{ id: 'local', name: 'Local', transport: 'stdio', command: process.execPath, args: [], executionMode: 'restricted-local' }];
    await expect(manager.connect(item, 'local', { sessionId: 'task', guard: guard('approved_execution', [process.execPath]) })).rejects.toThrow('No unrestricted fallback');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('cancels a pending call without retrying the side effect', async () => {
    const item = plugin(), context = { sessionId: 'task', guard: guard() }; const state = await manager.connect(item, 'remote', context); manager.approveCatalog(item, 'remote', state.catalogHash!, context);
    hold = true; const controller = new AbortController(); const request = manager.call(item, 'remote', 'echo', { value: 'ok' }, context, state.catalogHash!, controller.signal); const assertion = expect(request).rejects.toThrow();
    await vi.waitFor(() => expect(calls).toBe(1)); controller.abort(); await assertion; expect(calls).toBe(1);
  });
  it('starts and stops a real synthetic stdio server with no inherited application secret', async () => {
    const require = createRequire(import.meta.url); const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kairo-mcp-stdio-'));
    const file = path.join(root, 'server.cjs');
    await fs.writeFile(file, `const {Server}=require(${JSON.stringify(require.resolve('@modelcontextprotocol/sdk/server/index.js'))});const {StdioServerTransport}=require(${JSON.stringify(require.resolve('@modelcontextprotocol/sdk/server/stdio.js'))});const {ListToolsRequestSchema,CallToolRequestSchema}=require(${JSON.stringify(require.resolve('@modelcontextprotocol/sdk/types.js'))});const server=new Server({name:'fixture',version:'1'},{capabilities:{tools:{}}});server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'probe',description:'Environment probe',inputSchema:{type:'object'}}]}));server.setRequestHandler(CallToolRequestSchema,async()=>({content:[{type:'text',text:typeof process.env.KAIRO_TEST_SECRET}]}));server.connect(new StdioServerTransport());`);
    vi.stubEnv('KAIRO_TEST_SECRET', 'must-not-cross');
    const item = plugin(); item.connections = [{ id: 'local', name: 'Local', transport: 'stdio', command: process.execPath, args: [file], executionMode: 'trusted-local' }];
    const context = { sessionId: 'task', guard: guard('approved_execution', [process.execPath]) };
    try { const state = await manager.connect(item, 'local', context); manager.approveCatalog(item, 'local', state.catalogHash!, context); expect(await manager.call(item, 'local', 'probe', {}, context, state.catalogHash!)).toMatchObject({ content: [{ text: 'undefined' }] }); await manager.disconnect(); expect(manager.states(item, context)[0].status).toBe('disconnected'); expect(localMcpEnvironment()).not.toHaveProperty('KAIRO_TEST_SECRET'); }
    finally { await manager.disconnect(); vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); }
  });
  it('terminates the owned local process when an in-flight MCP action is cancelled', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kairo-mcp-cancel-')); const file = path.join(root, 'server.cjs'), dispatched = path.join(root, 'dispatched');
    await fs.writeFile(file, `const fs=require('node:fs');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(!('id' in m))return;let result;if(m.method==='initialize')result={protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};else if(m.method==='tools/list')result={tools:[{name:'pending',inputSchema:{type:'object'}}]};else if(m.method==='tools/call'){fs.writeFileSync(${JSON.stringify(dispatched)},String(process.pid));return;}else return;process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`);
    const item = plugin(); item.connections = [{ id: 'local', name: 'Local', transport: 'stdio', command: process.execPath, args: [file], executionMode: 'trusted-local' }];
    const context = { sessionId: 'task', guard: guard('approved_execution', [process.execPath]) }; const controller = new AbortController();
    try {
      const state = await manager.connect(item, 'local', context); manager.approveCatalog(item, 'local', state.catalogHash!, context);
      const request = manager.call(item, 'local', 'pending', {}, context, state.catalogHash!, controller.signal); const assertion = expect(request).rejects.toThrow('side effects');
      await vi.waitFor(async () => expect(await fs.readFile(dispatched, 'utf8')).toMatch(/^\d+$/)); const pid = Number(await fs.readFile(dispatched, 'utf8'));
      controller.abort(); await assertion;
      expect(() => process.kill(pid, 0)).toThrow(); expect(manager.states(item, context)[0].status).toBe('disconnected');
    } finally { controller.abort(); await manager.disconnect(); await fs.rm(root, { recursive: true, force: true }); }
  });
});
