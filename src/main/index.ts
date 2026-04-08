import { app, protocol } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fixPath from 'fix-path'
import { bindAppLifecycle, bootstrapMainProcess } from './bootstrap/appBootstrap'

app.name = 'KairoPilot'
app.setName('KairoPilot')

// Register custom protocol as privileged
protocol.registerSchemesAsPrivileged([
  { scheme: 'kairopilot', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

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

const bootstrapContext = {
  dirname: __dirname,
  rendererDistPath: RENDERER_DIST,
  publicPath: process.env.VITE_PUBLIC,
  devServerUrl: VITE_DEV_SERVER_URL
}

bindAppLifecycle(bootstrapContext)
bootstrapMainProcess(bootstrapContext)
