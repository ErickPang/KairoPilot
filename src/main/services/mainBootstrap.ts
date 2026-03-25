import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { setupHandlers } from '../ipc/handlers';
import { ensureAppPaths } from './appRuntime';
import { registerKairopilotProtocol } from './protocolService';
import { createMainWindow } from './windowService';

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

  app.whenReady().then(() => {
    registerKairopilotProtocol(appPaths.allowedProtocolRoots);

    if (process.platform === 'darwin') {
      app.dock.setIcon(path.join(context.publicPath, 'icon.png'));
    }

    setupHandlers();
    createWindowFromContext(context);
  });
}
