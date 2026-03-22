import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { setupHandlers } from './ipc/handlers'
import fixPath from 'fix-path'

app.name = 'KairoPilot'
app.setName('KairoPilot')

// Set userData path to ~/.kairopilot
const userDataPath = path.join(os.homedir(), '.kairopilot')
if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true })
}
app.setPath('userData', userDataPath)

// Ensure default workspace directory exists
const defaultWorkspacePath = path.join(userDataPath, 'workspace')
if (!fs.existsSync(defaultWorkspacePath)) {
  fs.mkdirSync(defaultWorkspacePath, { recursive: true })
}

// Ensure default plugins directory exists
const defaultPluginsPath = path.join(userDataPath, 'plugins')
if (!fs.existsSync(defaultPluginsPath)) {
  fs.mkdirSync(defaultPluginsPath, { recursive: true })
}

fixPath()
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Polyfill __filename and __dirname for CommonJS dependencies like better-sqlite3
globalThis.__filename = __filename;
globalThis.__dirname = __dirname;

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 900,
    icon: path.join(process.env.VITE_PUBLIC, 'icon.png'),
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 10, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, 'index.mjs'),
    },
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  app.quit()
  win = null
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.dock.setIcon(path.join(process.env.VITE_PUBLIC, 'icon.png'))
  }
  setupHandlers()
  createWindow()
})
