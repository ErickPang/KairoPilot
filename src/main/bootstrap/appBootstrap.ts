import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { skillsManager } from '../core/skills/manager';
import { setupHandlers } from '../bridge/ipc/setupHandlers';
import { ensureAppPaths, seedBuiltinSkills } from '../services/appRuntime';
import { registerKairopilotProtocol } from '../services/protocolService';
import { createMainWindow } from '../services/windowService';

export interface BootstrapContext {
  dirname: string;
  rendererDistPath: string;
  publicPath: string;
  devServerUrl?: string;
}

function createWindowFromContext(context: BootstrapContext) {
  return createMainWindow({
    preloadPath: path.join(context.dirname, 'index.mjs'),
    publicPath: context.publicPath,
    rendererDistPath: context.rendererDistPath,
    devServerUrl: context.devServerUrl
  });
}

export function bindAppLifecycle(context: BootstrapContext) {
  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindowFromContext(context);
    }
  });
}

export function bootstrapMainProcess(context: BootstrapContext) {
  const appPaths = ensureAppPaths();

  app.whenReady().then(async () => {
    registerKairopilotProtocol(appPaths.allowedProtocolRoots);

    if (process.platform === 'darwin') {
      app.dock.setIcon(path.join(context.publicPath, 'icon.png'));
    }

    await seedBuiltinSkills(appPaths);
    await skillsManager.initialize();
    setupHandlers();
    createWindowFromContext(context);
  });
}
