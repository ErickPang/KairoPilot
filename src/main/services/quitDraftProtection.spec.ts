import { beforeEach, describe, expect, it, vi } from 'vitest';
const electron = vi.hoisted(() => ({ app: { on: vi.fn(), quit: vi.fn(), getLocale: () => 'en' }, ipcMain: { handle: vi.fn() }, dialog: { showErrorBox: vi.fn() } }));
vi.mock('electron', () => electron);
import { installQuitDraftProtection, QuitDraftCoordinator } from './quitDraftProtection';
beforeEach(() => vi.clearAllMocks());

describe('quit draft protection', () => {
  it('waits for persistence and coalesces repeated quit requests', async () => {
    let saved!: () => void;
    const quit = vi.fn(); const failed = vi.fn();
    const save = vi.fn(() => new Promise<void>((resolve) => { saved = resolve; }));
    const coordinator = new QuitDraftCoordinator(save, quit, failed);
    const first = coordinator.request(); const second = coordinator.request();
    expect(first).toBe(second); await Promise.resolve(); expect(quit).not.toHaveBeenCalled();
    saved(); await first;
    expect(coordinator.isApproved()).toBe(true); expect(quit).toHaveBeenCalledOnce(); expect(failed).not.toHaveBeenCalled();
  });
  it('does not authorize quit after a failed save and can retry later', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('full')).mockResolvedValueOnce(undefined);
    const quit = vi.fn(); const failed = vi.fn(); const coordinator = new QuitDraftCoordinator(save, quit, failed);
    await coordinator.request(); expect(coordinator.isApproved()).toBe(false); expect(quit).not.toHaveBeenCalled(); expect(failed).toHaveBeenCalledOnce();
    await coordinator.request(); expect(quit).toHaveBeenCalledOnce();
  });
  it('requires the exact request id and owning window before accepting a save acknowledgement', async () => {
    const send = vi.fn();
    const window = { isDestroyed: () => false, webContents: { id: 17, send } };
    const coordinator = installQuitDraftProtection(() => window as never);
    const request = coordinator.request(); await Promise.resolve();
    const response = electron.ipcMain.handle.mock.calls[0][1];
    const id = send.mock.calls[0][1].id;
    expect(response({ sender: { id: 99 } }, { id, saved: true })).toBe(false);
    expect(response({ sender: { id: 17 } }, { id: 'old', saved: true })).toBe(false);
    expect(electron.app.quit).not.toHaveBeenCalled();
    expect(response({ sender: { id: 17 } }, { id, saved: true })).toBe(true);
    await request; expect(electron.app.quit).toHaveBeenCalledOnce();
    expect(response({ sender: { id: 17 } }, { id, saved: true })).toBe(false);
  });
});
