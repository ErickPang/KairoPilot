import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tempDirs: string[] = []
const originalCwd = process.cwd()

const mockPaths = {
  homePath: '',
  userDataPath: '',
  appPath: '',
  workspacePath: ''
}

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'home') {
        return mockPaths.homePath
      }
      if (name === 'userData') {
        return mockPaths.userDataPath
      }
      if (name === 'temp') {
        return os.tmpdir()
      }
      return ''
    },
    getAppPath: () => mockPaths.appPath,
    isPackaged: false
  }
}))

vi.mock('../llm/provider', () => ({
  createLLMProvider: vi.fn()
}))

vi.mock('../../store/config', () => ({
  readKairoPilotConfig: vi.fn(() => ({
    workbench: { managementRoot: mockPaths.workspacePath, defaultModel: '' },
    skills: { registry: [] }
  })),
  getModelForBinding: vi.fn(() => null),
  saveKairoPilotConfig: vi.fn()
}))

async function createTempDir() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kairopilot-skills-manager-'))
  tempDirs.push(tempDir)
  return tempDir
}

async function writeSkill(skillDir: string, options: { name: string; description: string; body: string }) {
  await fs.mkdir(skillDir, { recursive: true })
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: ${options.name}
description: ${options.description}
metadata:
  version: "1.0.0"
  allowed-tools:
    - Read
---

${options.body}`, 'utf-8')
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(async () => {
  process.chdir(originalCwd)
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('SkillsManager', () => {
  it('rejects historical skill scopes without recreating their directories', async () => {
    const { SkillsManager } = await import('./manager')
    const manager = new SkillsManager()
    expect(() => manager.getAgentSkillsDirectoryPath('retired-agent')).toThrow('Historical Agent skill scopes are read-only')
    await expect(manager.importSkill({sourceFile:'/missing/SKILL.md',scope:'agent:retired-agent'})).rejects.toThrow('Unsupported install scope')
  })

  it('在开发环境下同时读取项目公共技能与工作区技能', async () => {
    const rootDir = await createTempDir()
    const projectDir = path.join(rootDir, 'project')
    const homeDir = path.join(rootDir, 'home')
    const workspaceDir = path.join(rootDir, 'workspace')

    mockPaths.homePath = homeDir
    mockPaths.userDataPath = path.join(rootDir, 'user-data')
    mockPaths.appPath = projectDir
    mockPaths.workspacePath = workspaceDir

    await writeSkill(path.join(projectDir, 'skills', 'public-skill'), {
      name: 'Public Skill',
      description: 'public from project',
      body: '# Public Skill'
    })
    await writeSkill(path.join(workspaceDir, 'skills', 'workspace-skill'), {
      name: 'Workspace Skill',
      description: 'workspace only',
      body: '# Workspace Skill'
    })

    process.chdir(projectDir)

    const { SkillsManager } = await import('./manager')
    const manager = new SkillsManager()

    const mergedSkills = await manager.listMergedSkills('workbench')

    expect(mergedSkills.map((skill) => skill.id)).toEqual(['public-skill', 'workspace-skill'])
    expect(mergedSkills.find((skill) => skill.id === 'public-skill')).toEqual(expect.objectContaining({
      description: 'public from project',
      source: 'public',
      removable: false
    }))
    expect(mergedSkills.find((skill) => skill.id === 'workspace-skill')).toEqual(expect.objectContaining({
      description: 'workspace only',
      source: 'agent',
      removable: true
    }))

    await expect(manager.readSkillContent('Public Skill', 'workbench')).resolves.toBe('# Public Skill')
  })

  it('项目公共技能与已同步到用户目录的同名技能冲突时优先使用项目版本', async () => {
    const rootDir = await createTempDir()
    const projectDir = path.join(rootDir, 'project')
    const homeDir = path.join(rootDir, 'home')

    mockPaths.homePath = homeDir
    mockPaths.userDataPath = path.join(rootDir, 'user-data')
    mockPaths.appPath = projectDir
    mockPaths.workspacePath = path.join(rootDir, 'workspace')

    await writeSkill(path.join(homeDir, '.kairopilot', 'skills', 'shared-skill'), {
      name: 'Shared Skill',
      description: 'stale public copy',
      body: '# Stale Public Skill'
    })
    await writeSkill(path.join(projectDir, 'skills', 'shared-skill'), {
      name: 'Shared Skill',
      description: 'fresh project copy',
      body: '# Fresh Public Skill'
    })

    process.chdir(projectDir)

    const { SkillsManager } = await import('./manager')
    const manager = new SkillsManager()

    await expect(manager.getMetadata('shared-skill', 'workbench')).resolves.toEqual(expect.objectContaining({
      description: 'fresh project copy'
    }))
    await expect(manager.readSkillContent('Shared Skill', 'workbench')).resolves.toBe('# Fresh Public Skill')
  })

  it('为运行时生成稳定的技能目录快照', async () => {
    const rootDir = await createTempDir()
    const projectDir = path.join(rootDir, 'project')
    const homeDir = path.join(rootDir, 'home')
    const workspaceDir = path.join(rootDir, 'workspace')

    mockPaths.homePath = homeDir
    mockPaths.userDataPath = path.join(rootDir, 'user-data')
    mockPaths.appPath = projectDir
    mockPaths.workspacePath = workspaceDir

    await writeSkill(path.join(projectDir, 'skills', 'public-skill'), {
      name: 'Public Skill',
      description: 'public from project',
      body: '# Public Skill'
    })
    await writeSkill(path.join(workspaceDir, 'skills', 'workspace-skill'), {
      name: 'Workspace Skill',
      description: 'workspace only',
      body: '# Workspace Skill'
    })

    process.chdir(projectDir)

    const { SkillsManager } = await import('./manager')
    const manager = new SkillsManager()

    const snapshot = await manager.getSkillCatalogSnapshot('workbench')

    expect(snapshot.fullSummary).toContain('workspace-skill')
    expect(snapshot.fullSummary).toContain('public-skill')
    expect(snapshot.fullSummary).toContain('scope: agent')
    expect(snapshot.fullSummary).toContain('scope: public')
  })

  it('支持卸载用户安装的技能并刷新索引', async () => {
    const rootDir = await createTempDir()
    const projectDir = path.join(rootDir, 'project')
    const homeDir = path.join(rootDir, 'home')
    const workspaceDir = path.join(rootDir, 'workspace')

    mockPaths.homePath = homeDir
    mockPaths.userDataPath = path.join(rootDir, 'user-data')
    mockPaths.appPath = projectDir
    mockPaths.workspacePath = workspaceDir

    await writeSkill(path.join(homeDir, '.kairopilot', 'skills', 'custom-public-skill'), {
      name: 'Custom Public Skill',
      description: 'user installed public',
      body: '# Custom Public Skill'
    })
    await writeSkill(path.join(workspaceDir, 'skills', 'workspace-skill'), {
      name: 'Workspace Skill',
      description: 'workspace only',
      body: '# Workspace Skill'
    })
    await writeSkill(path.join(projectDir, 'skills', 'builtin-skill'), {
      name: 'Builtin Skill',
      description: 'bundled with app',
      body: '# Builtin Skill'
    })

    process.chdir(projectDir)

    const { SkillsManager } = await import('./manager')
    const manager = new SkillsManager()

    await expect(manager.uninstallSkill({ id: 'custom-public-skill', scope: 'public' })).resolves.toBeUndefined()
    await expect(manager.listPublicSkills()).resolves.not.toContainEqual(expect.objectContaining({ id: 'custom-public-skill' }))
    await expect(manager.uninstallSkill({ id: 'workspace-skill', scope: 'agent:workbench' })).resolves.toBeUndefined()
    await expect(manager.listAgentSkills('workbench')).resolves.not.toContainEqual(expect.objectContaining({ id: 'workspace-skill' }))
    await expect(manager.uninstallSkill({ id: 'builtin-skill', scope: 'public' })).rejects.toThrow('Built-in skills cannot be removed.')
  })
})
