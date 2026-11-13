import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KAIRO_INVOKE as C } from '../../../shared/ipc';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (_event: unknown, value: unknown) => Promise<unknown>>(),
  task: { id: 'task', archivedAt: undefined as number | undefined },
  mutable: vi.fn(), audit: vi.fn(),
  connect: vi.fn(), approveCatalog: vi.fn(), disconnect: vi.fn(), connectionStates: vi.fn()
}));
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: (_event: unknown, value: unknown) => Promise<unknown>) => mocks.handlers.set(channel, handler) } }));
vi.mock('../../services/pluginService', () => ({}));
vi.mock('../../core/plugins/manager', () => ({ pluginManager: mocks }));
vi.mock('../../store/taskPages', () => ({ getActiveSessionSummary: () => mocks.task }));
vi.mock('../../services/projectService', () => ({ permissionGuardForSession: () => 'task-guard' }));
vi.mock('../../services/workbenchExecution', () => ({ assertTaskMutable: mocks.mutable }));
vi.mock('../../store/audit', () => ({ addAuditLog: mocks.audit }));
import { registerPluginHandlers } from './pluginHandlers';

const input = { id: 'fixture', scope: 'public', sessionId: 'task', connectionId: 'remote', expectedHash: 'package-hash' };
const invoke = (channel: string, value: unknown) => mocks.handlers.get(channel)!(null, value);
beforeEach(() => {
  vi.resetAllMocks(); mocks.task = { id: 'task', archivedAt: undefined }; mocks.handlers.clear(); registerPluginHandlers();
  mocks.connect.mockResolvedValue({ status: 'catalog_changed' });
});

describe('MCP connection IPC', () => {
  it('rejects another task, archived tasks, running tasks and unreviewed packages before connecting', async () => {
    expect(await invoke(C.pluginsConnectionConnect, { ...input, sessionId: 'another' })).toMatchObject({ success: false });
    mocks.task.archivedAt = 1; expect(await invoke(C.pluginsConnectionConnect, input)).toMatchObject({ success: false });
    mocks.task.archivedAt = undefined; mocks.mutable.mockImplementation(() => { throw new Error('Task is running'); });
    expect(await invoke(C.pluginsConnectionConnect, input)).toMatchObject({ success: false });
    mocks.mutable.mockReset(); expect(await invoke(C.pluginsConnectionConnect, { ...input, expectedHash: undefined })).toMatchObject({ success: false });
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it('forwards session credentials only to the runtime, never into audit or error text', async () => {
    expect(await invoke(C.pluginsConnectionConnect, { ...input, token: 'synthetic-secret' })).toMatchObject({ success: true });
    expect(mocks.connect).toHaveBeenCalledWith('fixture', 'public', 'remote', 'package-hash', { sessionId: 'task', guard: 'task-guard' }, 'synthetic-secret');
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain('synthetic-secret');
    mocks.connect.mockRejectedValue(new Error('Server echoed synthetic-secret'));
    const result = await invoke(C.pluginsConnectionConnect, { ...input, token: 'synthetic-secret' });
    expect(result).toMatchObject({ success: false }); expect(JSON.stringify(result)).not.toContain('synthetic-secret');
  });
  it('allows disconnect during a run but requires a reviewed hash to approve the catalog', async () => {
    mocks.mutable.mockImplementation(() => { throw new Error('Task is running'); });
    expect(await invoke(C.pluginsConnectionDisconnect, input)).toMatchObject({ success: true });
    expect(mocks.disconnect).toHaveBeenCalledWith('fixture', 'public', 'task', 'remote');
    mocks.mutable.mockReset(); expect(await invoke(C.pluginsConnectionApprove, input)).toMatchObject({ success: false });
    expect(mocks.approveCatalog).not.toHaveBeenCalled();
    expect(await invoke(C.pluginsConnectionApprove, { ...input, catalogHash: 'reviewed-catalog' })).toMatchObject({ success: true });
    expect(mocks.approveCatalog).toHaveBeenCalledWith('fixture', 'public', 'remote', 'reviewed-catalog', { sessionId: 'task', guard: 'task-guard' });
  });
});
