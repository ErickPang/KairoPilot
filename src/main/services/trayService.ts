import { app, BrowserWindow, globalShortcut, Menu, nativeImage, Tray } from 'electron';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type TrayServiceState = {
  tray: Tray | null;
  quickInputWindow: BrowserWindow | null;
};

// ---------------------------------------------------------------------------
// Tray icon
// ---------------------------------------------------------------------------
function createTrayIcon(publicPath: string) {
  const iconPath = path.join(publicPath, 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  // macOS menu bar icons are ~22px template-style; resize appropriately
  if (process.platform === 'darwin') {
    return icon.resize({ width: 22, height: 22 });
  }
  // Windows/Linux tray icons typically 16x16
  return icon.resize({ width: 16, height: 16 });
}

// ---------------------------------------------------------------------------
// Build tray context menu
// ---------------------------------------------------------------------------
function buildTrayMenu(getMainWindow: () => BrowserWindow | null) {
  const isMac = process.platform === 'darwin';

  return Menu.buildFromTemplate([
    {
      label: '显示/隐藏 KairoPilot',
      click: () => {
        const win = getMainWindow();
        if (!win) return;
        if (win.isVisible()) {
          win.hide();
        } else {
          win.show();
          win.focus();
        }
      },
    },
    {
      label: '新对话',
      click: () => {
        const win = getMainWindow();
        if (!win) return;
        win.show();
        win.focus();
        win.webContents.send('kairo:tray-new-chat');
      },
    },
    { type: 'separator' },
    {
      label: isMac ? '退出 KairoPilot' : '退出',
      click: () => {
        app.quit();
      },
    },
  ]);
}

// ---------------------------------------------------------------------------
// Global shortcuts
// ---------------------------------------------------------------------------
function registerAppShortcuts(getMainWindow: () => BrowserWindow | null) {
  const isMac = process.platform === 'darwin';
  // Cmd+J on macOS, Alt+Space on Windows/Linux
  const accelerator = isMac ? 'Command+J' : 'Alt+Space';

  const registered = globalShortcut.register(accelerator, () => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isVisible()) {
      win.hide();
    } else {
      win.show();
      win.focus();
    }
  });

  if (!registered) {
    console.warn(`[TrayService] Failed to register global shortcut: ${accelerator}`);
  } else {
    console.log(`[TrayService] Global shortcut registered: ${accelerator}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function createTrayService(
  publicPath: string,
  getMainWindow: () => BrowserWindow | null
): TrayServiceState {
  const state: TrayServiceState = {
    tray: null,
    quickInputWindow: null,
  };

  try {
    const icon = createTrayIcon(publicPath);
    const tray = new Tray(icon);
    tray.setToolTip('KairoPilot');
    tray.setContextMenu(buildTrayMenu(getMainWindow));

    // Toggle window on tray icon click
    tray.on('click', () => {
      const win = getMainWindow();
      if (!win) return;
      if (win.isVisible()) {
        win.hide();
      } else {
        win.show();
        win.focus();
      }
    });

    state.tray = tray;
    console.log('[TrayService] System tray created');
  } catch (err) {
    console.warn('[TrayService] Failed to create system tray:', err);
  }

  registerAppShortcuts(getMainWindow);

  return state;
}

export function disposeTrayService(state: TrayServiceState) {
  globalShortcut.unregisterAll();
  if (state.tray) {
    state.tray.destroy();
    state.tray = null;
  }
  if (state.quickInputWindow) {
    state.quickInputWindow.close();
    state.quickInputWindow = null;
  }
}
