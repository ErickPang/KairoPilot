import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tempDirs: string[] = []
const originalAppRoot = process.env.APP_ROOT
const originalResourcesPath = process.resourcesPath
const originalCwd = process.cwd()

const mockElectronState = {
  appPath: '',
  isPackaged: false
}

vi.mock('electron', () => ({
  app: {
    getAppPath: () => mockElectronState.appPath,
    getPath: () => os.tmpdir(),
    get isPackaged() {
      return mockElectronState.isPackaged
    }
  }
}))

async function createTempDir() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kairopilot-app-runtime-'))
  tempDirs.push(tempDir)
  return tempDir
}

function setResourcesPath(value: string) {
  Object.defineProperty(process, 'resourcesPath', {
    value,
    configurable: true
  })
}

beforeEach(() => {
  vi.resetModules()
  mockElectronState.appPath = ''
  mockElectronState.isPackaged = false
  process.env.APP_ROOT = ''
  setResourcesPath(originalResourcesPath)
  process.chdir(originalCwd)
})

afterEach(async () => {
  process.env.APP_ROOT = originalAppRoot
  setResourcesPath(originalResourcesPath)
  process.chdir(originalCwd)
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('appRuntime', () => {
  it('开发环境下会从 APP_ROOT/skills 发现内置技能目录', async () => {
    const rootDir = await createTempDir()
    const appRoot = path.join(rootDir, 'project')
    const unrelatedCwd = path.join(rootDir, 'workspace')

    await fs.mkdir(path.join(appRoot, 'skills'), { recursive: true })
    await fs.mkdir(unrelatedCwd, { recursive: true })

    process.env.APP_ROOT = appRoot
    process.chdir(unrelatedCwd)
    mockElectronState.appPath = path.join(rootDir, 'dist-electron')

    const { getBuiltinSkillsSourcePath } = await import('./appRuntime')

    expect(getBuiltinSkillsSourcePath()).toBe(path.join(appRoot, 'skills'))
  })

  it('打包环境下会回退到 appPath 同级的 builtin-skills 目录', async () => {
    const rootDir = await createTempDir()
    const resourcesDir = path.join(rootDir, 'Resources')
    const appAsarDir = path.join(resourcesDir, 'app.asar')
    const builtinSkillsDir = path.join(resourcesDir, 'builtin-skills')

    await fs.mkdir(appAsarDir, { recursive: true })
    await fs.mkdir(builtinSkillsDir, { recursive: true })

    mockElectronState.isPackaged = true
    mockElectronState.appPath = appAsarDir
    setResourcesPath(path.join(rootDir, 'MissingResources'))

    const { getBuiltinSkillsSourcePath } = await import('./appRuntime')

    expect(getBuiltinSkillsSourcePath()).toBe(builtinSkillsDir)
  })
})
