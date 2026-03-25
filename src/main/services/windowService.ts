import { BrowserWindow } from 'electron';
import path from 'node:path';

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
      preload: options.preloadPath
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
