import { app, dialog } from 'electron';
import { redactSensitiveText } from '../core/security/permissions';

export function handleStartupFailure(error: unknown) {
  const reason = redactSensitiveText(error instanceof Error ? error.message : 'Unknown initialization error.');
  console.error('[Startup] Initialization stopped:', reason);
  try {
    dialog.showErrorBox('KairoPilot 启动未完成 / Startup stopped', `本地初始化未完成，应用将退出。请保留原数据库和 backups 中已有的备份，检查应用版本与文件权限后重试。\n\n${reason}`);
  } catch {
    console.error('[Startup] Unable to display the initialization error dialog.');
  } finally {
    // Release the single-instance lock even if initialization failed before a window existed.
    app.quit();
  }
}
