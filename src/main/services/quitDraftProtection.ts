import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { KAIRO_EVENT, KAIRO_INVOKE } from '../../shared/ipc';
import type { QuitDraftFailureReason } from '../../shared/contracts';
import { redactSensitiveText } from '../core/security/permissions';

export class QuitFailure extends Error {
  constructor(readonly phase: 'draft' | 'communication' | 'cleanup', readonly reason: string, readonly detail?: unknown) { super(reason); }
}
const DRAFT_FAILURE_REASONS = new Set<QuitDraftFailureReason>(['conflict', 'save_failed', 'preparation_pending', 'not_ready', 'unsaved_input']);

function logQuitFailure(failure: QuitFailure) {
  console.error('[Shutdown] Quit failed:', { phase: failure.phase, reason: failure.reason, detail: redactSensitiveText(failure.detail instanceof Error ? failure.detail.message : '') });
}

function failureMessage(failure: QuitFailure, chinese: boolean): [string, string] {
  if (failure.phase === 'cleanup') return chinese
    ? ['退出清理未完成，应用未退出', '停止任务或回收资源失败。请查看日志并重试退出。']
    : ['Cleanup failed; quit cancelled', 'Stopping tasks or releasing resources failed. Check the logs and retry quitting.'];
  if (failure.phase === 'communication') return chinese
    ? ['未能确认草稿保存，应用未退出', '界面尚未就绪、已断开或响应超时，无法确认保存状态。请等待工作台就绪后重试退出。']
    : ['Draft save unconfirmed; quit cancelled', 'The workbench is not ready, disconnected, or timed out. Wait for it to be ready and retry quitting.'];
  const help: Record<string, [string, string]> = {
    conflict: ['草稿版本冲突。请在工作台审查并选择保留的版本，再重试退出。', 'Review the conflicting draft versions in the workbench, then retry quitting.'],
    preparation_pending: ['附件或引用仍在准备中。请等待完成后重试退出。', 'Attachments or references are still being prepared. Wait for completion and retry quitting.'],
    unsaved_input: ['当前输入尚未归属已保存的任务。请先创建任务并保存，再重试退出。', 'The input is not saved to a task yet. Create a task and save it before quitting.']
  };
  const message = help[failure.reason] || ['草稿写入失败。请在工作台重试保存，再重新退出。当前输入仍保留在界面中。', 'Saving the draft failed. Retry saving in the workbench, then quit again. Your input remains in the interface.'];
  return [chinese ? '草稿尚未保存，应用未退出' : 'Draft not saved; quit cancelled', message[chinese ? 0 : 1]];
}

/** Coalesces repeated quit requests; only a completed save authorizes cleanup and quit. */
export class QuitDraftCoordinator {
  private approved = false;
  private pending: Promise<void> | null = null;
  constructor(private save: () => Promise<void>, private quit: () => void, private failed: (error: unknown) => void) {}
  isApproved(): boolean { return this.approved; }
  request(): Promise<void> {
    if (this.approved) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = Promise.resolve().then(this.save).then(() => {
      this.approved = true;
      this.quit();
    }).catch(error => { this.approved = false; this.failed(error); }).finally(() => { this.pending = null; });
    return this.pending;
  }
}

export function installQuitDraftProtection(getWindow: () => BrowserWindow | null, options: { onSaveFailure?: (failure: QuitFailure) => void; beforeQuit?: () => Promise<void>; isStartup?: () => boolean } = {}) {
  let response: { id: string; senderId: number; finish: (saved: boolean, reason?: QuitDraftFailureReason) => void } | null = null;
  ipcMain.handle(KAIRO_INVOKE.appQuitDraftResponse, (event, value: unknown) => {
    if (!value || typeof value !== 'object') return false;
    const payload = value as { id?: unknown; saved?: unknown; reason?: unknown };
    if (!response || event.sender.id !== response.senderId || payload.id !== response.id || typeof payload.saved !== 'boolean') return false;
    if (!payload.saved && !DRAFT_FAILURE_REASONS.has(payload.reason as QuitDraftFailureReason)) return false;
    response.finish(payload.saved, payload.reason as QuitDraftFailureReason | undefined);
    return true;
  });
  const coordinator = new QuitDraftCoordinator(async () => {
    const startup = options.isStartup?.() === true;
    const window = getWindow();
    if (!startup && window && !window.isDestroyed()) await new Promise<void>((resolve, reject) => {
      const id = randomUUID();
      let settled = false;
      const finish = (saved: boolean, reason?: QuitDraftFailureReason, failure?: QuitFailure) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer); clearInterval(retry);
        response = null;
        saved ? resolve() : reject(failure || new QuitFailure(reason === 'not_ready' ? 'communication' : 'draft', reason || 'save_failed'));
      };
      const send = () => {
        if (settled) return;
        try {
          if (window.isDestroyed()) throw new Error('Window closed before draft acknowledgement.');
          window.webContents.send(KAIRO_EVENT.appBeforeQuit, { id });
        } catch (error) { finish(false, undefined, new QuitFailure('communication', 'send_failed', error)); }
      };
      const timer = setTimeout(() => finish(false, undefined, new QuitFailure('communication', 'timeout')), 15000);
      // A request sent before React mounts must be delivered after its listener becomes ready.
      const retry = setInterval(send, 250);
      response = { id, senderId: window.webContents.id, finish };
      send();
    });
    try { await options.beforeQuit?.(); }
    catch (error) {
      const failure = new QuitFailure('cleanup', 'cleanup_failed', error);
      if (!startup) throw failure;
      // No editor has been exposed during startup. A failed cleanup cannot trap this instance.
      logQuitFailure(failure);
    }
  }, () => app.quit(), error => {
    const failure = error instanceof QuitFailure ? error : new QuitFailure('communication', 'quit_failed', error);
    logQuitFailure(failure);
    const window = getWindow();
    if (window && !window.isDestroyed()) {
      try { window.show(); window.focus(); window.webContents.send(KAIRO_EVENT.appQuitCancelled); }
      catch { /* The failure dialog remains available even if the renderer disconnected. */ }
    }
    if (options.onSaveFailure) { options.onSaveFailure(failure); return; }
    const isChinese = app.getLocale().startsWith('zh');
    try { dialog.showErrorBox(...failureMessage(failure, isChinese)); }
    catch { console.error('[Shutdown] Unable to display the quit failure dialog.'); }
  });
  app.on('before-quit', (event) => {
    if (coordinator.isApproved()) return;
    event.preventDefault();
    void coordinator.request();
  });
  return coordinator;
}
