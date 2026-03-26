import { BrowserWindow, shell } from 'electron';
import path from 'node:path';

function isSafeExternalUrl(url: string) {
  return /^https?:\/\//i.test(url);
}

function isAllowedAppNavigation(url: string, devServerUrl?: string) {
  if (!devServerUrl) {
    return false;
  }
  try {
    const target = new URL(url);
    const allowed = new URL(devServerUrl);
    return target.origin === allowed.origin;
  } catch {
    return false;
  }
}

export function createMainWindow(options: {
  preloadPath: string;
  publicPath: string;
  rendererDistPath: string;
  devServerUrl?: string;
}) {
  const window = new BrowserWindow({
    width: 1100,
    height: 700,
    icon: path.join(options.publicPath, 'icon.png'),
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 10, y: 12 },
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (isAllowedAppNavigation(url, options.devServerUrl)) {
      return;
    }
    event.preventDefault();
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    }
  });

  window.webContents.on('did-finish-load', () => {
    window.webContents.send('main-process-message', (new Date()).toLocaleString());
  });

  if (options.devServerUrl) {
    window.loadURL(options.devServerUrl);
  } else {
    window.loadFile(path.join(options.rendererDistPath, 'index.html'));
  }

  return window;
}
