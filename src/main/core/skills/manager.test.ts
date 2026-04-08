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
  getActiveAgentId: vi.fn(() => null),
  getAgent: vi.fn((agentId: string) => (
    agentId === 'agent-1'
      ? {
          id: 'agent-1',
          workspace: mockPaths.workspacePath
        }
      : null
  )),
  getAgents: vi.fn(() => []),
  getKairoPilotConfig: vi.fn(() => ({
    skills: {
      registry: []
    }
  })),
  getModelForAgent: vi.fn(() => null),
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

    const mergedSkills = await manager.listMergedSkills('agent-1')

    expect(mergedSkills.map((skill) => skill.id)).toEqual(['public-skill', 'workspace-skill'])
    expect(mergedSkills.find((skill) => skill.id === 'public-skill')).toEqual(expect.objectContaining({
      description: 'public from project',
      source: 'public'
    }))
    expect(mergedSkills.find((skill) => skill.id === 'workspace-skill')).toEqual(expect.objectContaining({
      description: 'workspace only',
      source: 'agent'
    }))

    await expect(manager.readSkillContent('Public Skill', 'agent-1')).resolves.toBe('# Public Skill')
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

    await expect(manager.getMetadata('shared-skill', 'agent-1')).resolves.toEqual(expect.objectContaining({
      description: 'fresh project copy'
    }))
    await expect(manager.readSkillContent('Shared Skill', 'agent-1')).resolves.toBe('# Fresh Public Skill')
  })
})
