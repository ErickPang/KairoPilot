import {recoverIntelligenceWork} from '../store/intelligence';
import { installQuitDraftProtection } from '../services/quitDraftProtection';
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { skillsManager } from '../core/skills/manager';
import { setupHandlers } from '../bridge/ipc/setupHandlers';
import { ensureAppPaths, seedBuiltinSkills } from '../services/appRuntime';
import { registerKairopilotProtocol } from '../services/protocolService';
import { recoverInterruptedRuns } from '../store/chat';
import { getAppearanceConfig, initializeKairoPilotConfig } from '../store/config';
import { createMainWindow } from '../services/windowService';
import { initSentry } from '../services/sentryInit';
import { createTrayService, disposeTrayService, type TrayServiceState } from '../services/trayService';
import { startClipboardMonitor } from '../services/clipboardMonitor';
import { handleStartupFailure } from '../services/startupFailure';

export interface BootstrapContext {
  dirname: string;
  rendererDistPath: string;
  publicPath: string;
  devServerUrl?: string;
}

let mainWindow: BrowserWindow | null = null;
let trayState: TrayServiceState | null = null;
let isQuitting = false;
let stopClipboardMonitor: (() => void) | null = null;

function getMainWindow(): BrowserWindow | null {
  return mainWindow;
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
  const quitDrafts = installQuitDraftProtection(getMainWindow);
  // When all windows are closed, don't quit — keep running in tray
  app.on('window-all-closed', () => {
    // On macOS it's standard to keep the app open without windows
    if (process.platform !== 'darwin') {
      // On Windows/Linux, if tray exists, keep running; otherwise quit
      if (!trayState?.tray) {
        app.quit();
      }
    }
  });

  app.on('before-quit', () => {
    if (!quitDrafts.isApproved()) return;
    isQuitting = true;
    skillsManager.dispose();
    if (stopClipboardMonitor) {
      stopClipboardMonitor();
      stopClipboardMonitor = null;
    }
    if (trayState) {
      disposeTrayService(trayState);
      trayState = null;
    }
  });

  // On window close, hide to tray instead of quitting
  app.on('browser-window-created', (_event, window) => {
    window.on('close', (event) => {
      if (trayState?.tray && !isQuitting) {
        event.preventDefault();
        window.hide();
      } else if (!isQuitting && process.platform !== 'darwin') {
        event.preventDefault();
        app.quit();
      }
    });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindowFromContext(context);
    } else if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

export function bootstrapMainProcess(context: BootstrapContext) {
  const appPaths = ensureAppPaths();
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  app.whenReady().then(async () => {
    if (!process.env.KAIROPILOT_TEST_ROOT) initSentry();
    initializeKairoPilotConfig();
    recoverInterruptedRuns();
    recoverIntelligenceWork();

    registerKairopilotProtocol(() => appPaths.allowedProtocolRoots);

    if (process.platform === 'darwin') {
      app.dock?.setIcon(path.join(context.publicPath, 'icon.png'));
    }

    await seedBuiltinSkills(appPaths);
    await skillsManager.initialize();
    setupHandlers();
    mainWindow = createWindowFromContext(context);

    // Initialize system tray + global shortcuts
    if (!process.env.KAIROPILOT_TEST_ROOT) trayState = createTrayService(context.publicPath, getMainWindow);

    // Start clipboard monitor for code/error detection
    if (!process.env.KAIROPILOT_TEST_ROOT) stopClipboardMonitor = startClipboardMonitor(getMainWindow, () => getAppearanceConfig().clipboardSuggestions === true);
  }).catch(handleStartupFailure);
}
