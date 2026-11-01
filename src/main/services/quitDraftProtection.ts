import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { KAIRO_EVENT, KAIRO_INVOKE } from '../../shared/ipc';

/** Coalesces repeated quit requests; only a completed save authorizes cleanup and quit. */
export class QuitDraftCoordinator {
  private approved = false;
  private pending: Promise<void> | null = null;
  constructor(private save: () => Promise<void>, private quit: () => void, private failed: () => void) {}
  isApproved(): boolean { return this.approved; }
  request(): Promise<void> {
    if (this.approved) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = Promise.resolve().then(this.save).then(() => {
      this.approved = true;
      this.quit();
    }).catch(() => this.failed()).finally(() => { this.pending = null; });
    return this.pending;
  }
}

export function installQuitDraftProtection(getWindow: () => BrowserWindow | null, options: { onSaveFailure?: () => void } = {}) {
  let response: { id: string; senderId: number; finish: (saved: boolean) => void } | null = null;
  ipcMain.handle(KAIRO_INVOKE.appQuitDraftResponse, (event, value: unknown) => {
    if (!value || typeof value !== 'object') return false;
    const payload = value as { id?: unknown; saved?: unknown };
    if (!response || event.sender.id !== response.senderId || payload.id !== response.id || typeof payload.saved !== 'boolean') return false;
    response.finish(payload.saved);
    return true;
  });
  const coordinator = new QuitDraftCoordinator(async () => {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    await new Promise<void>((resolve, reject) => {
      const id = randomUUID();
      const finish = (saved: boolean) => {
        clearTimeout(timer);
        response = null;
        saved ? resolve() : reject(new Error('Draft save did not finish.'));
      };
      const timer = setTimeout(() => finish(false), 15000);
      response = { id, senderId: window.webContents.id, finish };
      window.webContents.send(KAIRO_EVENT.appBeforeQuit, { id });
    });
  }, () => app.quit(), () => {
    const window = getWindow();
    window?.show(); window?.focus();
    if (window && !window.isDestroyed()) window.webContents.send(KAIRO_EVENT.appQuitCancelled);
    if (options.onSaveFailure) { options.onSaveFailure(); return; }
    const isChinese = app.getLocale().startsWith('zh');
    dialog.showErrorBox(isChinese ? '草稿尚未保存，应用未退出' : 'Draft not saved; quit cancelled', isChinese ? '请在工作台重试保存或处理草稿冲突，再重新退出。当前输入仍保留在应用中。' : 'Retry saving or resolve the draft conflict in the workbench, then quit again. Your current input remains in the app.');
  });
  app.on('before-quit', (event) => {
    if (coordinator.isApproved()) return;
    event.preventDefault();
    void coordinator.request();
  });
  return coordinator;
}
