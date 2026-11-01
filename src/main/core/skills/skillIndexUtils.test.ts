import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkillMetadata, SkillRecord } from '../../../shared/contracts'
import {
  findSkillInIndex,
  findSkillRecord,
  readSkillRecord,
  resolveSkillResourcePath,
  scanSkillsDirectory,
  toSkillSummary
} from './skillIndexUtils'

const tempDirs: string[] = []

async function createTempDir() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kairopilot-skill-index-'))
  tempDirs.push(tempDir)
  return tempDir
}

function createSkillMetadata(name: string, description: string, allowedTools: string[] = ['search']): SkillMetadata {
  return {
    name,
    description,
    version: '1.0.0',
    allowedTools,
    whenToUse: description,
    arguments: [],
    userInvocable: true,
    modelInvocable: true,
    executionMode: 'inline'
  }
}

function createSkillRecord(id: string, overrides: Partial<SkillRecord> = {}): SkillRecord {
  return {
    id,
    scope: 'public',
    agentId: undefined,
    content: `# ${id}`,
    skillDir: `/skills/${id}`,
    skillFilePath: `/skills/${id}/SKILL.md`,
    contentHash: `${id}-hash`,
    metadata: createSkillMetadata(id, `${id} description`),
    ...overrides
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('skillIndexUtils', () => {
  it('读取技能记录并解析 frontmatter 与内容哈希', async () => {
    const rootDir = await createTempDir()
    const skillDir = path.join(rootDir, 'release-helper')
    await fs.mkdir(skillDir, { recursive: true })
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: Release Helper
description: helper
metadata:
  version: 1.2.3
  allowed-tools:
    - search
---

# Release Helper`, 'utf-8')

    const skillRecord = await readSkillRecord(skillDir, 'public', 'release-helper')

    expect(skillRecord).toEqual(expect.objectContaining({
      id: 'release-helper',
      scope: 'public',
      content: '# Release Helper',
      metadata: expect.objectContaining({
        name: 'Release Helper',
        description: 'helper',
        version: '1.2.3',
        allowedTools: ['search']
      })
    }))
    expect(skillRecord?.contentHash).toHaveLength(64)
  })

  it('扫描技能目录时忽略隐藏目录与无效技能', async () => {
    const rootDir = await createTempDir()
    const validSkillDir = path.join(rootDir, 'release-helper')
    const hiddenSkillDir = path.join(rootDir, '.draft')
    const invalidSkillDir = path.join(rootDir, 'broken-skill')
    await fs.mkdir(validSkillDir, { recursive: true })
    await fs.mkdir(hiddenSkillDir, { recursive: true })
    await fs.mkdir(invalidSkillDir, { recursive: true })
    await fs.writeFile(path.join(validSkillDir, 'SKILL.md'), `---
name: Release Helper
description: helper
---

# Release Helper`, 'utf-8')

    const skills = await scanSkillsDirectory(rootDir, 'public')

    expect(skills).toHaveLength(1)
    expect(skills[0]?.id).toBe('release-helper')
  })

  it('优先返回 agent 技能，否则回退到公共技能索引', async () => {
    const publicSkill = createSkillRecord('release-helper', {
      metadata: createSkillMetadata('Release Helper', 'public', ['search'])
    })
    const agentSkill = createSkillRecord('release-helper', {
      scope: 'agent',
      agentId: 'agent-1',
      metadata: {
        ...createSkillMetadata('Release Helper', 'agent', ['search', 'bash']),
        version: '2.0.0'
      }
    })

    const loadAllSkills = vi.fn(async () => undefined)
    const loadAgentSkills = vi.fn(async () => undefined)
    const getAgentIndex = vi.fn(() => new Map([[agentSkill.id, agentSkill]]))

    const resolvedAgentSkill = await findSkillRecord({
      skillName: 'Release Helper',
      agentId: 'agent-1',
      loadAllSkills,
      loadAgentSkills,
      getPublicSkillIndex: () => new Map([[publicSkill.id, publicSkill]]),
      getAgentIndex
    })
    const resolvedPublicSkill = await findSkillRecord({
      skillName: 'Release Helper',
      loadAllSkills,
      loadAgentSkills,
      getPublicSkillIndex: () => new Map([[publicSkill.id, publicSkill]]),
      getAgentIndex: () => new Map()
    })

    expect(resolvedAgentSkill?.metadata.description).toBe('agent')
    expect(resolvedPublicSkill?.metadata.description).toBe('public')
    expect(loadAgentSkills).toHaveBeenCalledWith('agent-1')
    expect(loadAllSkills).toHaveBeenCalled()
  })

  it('解析资源路径时阻止越界访问', async () => {
    const rootDir = await createTempDir()
    const skillDir = path.join(rootDir, 'release-helper')
    const outsideDir = await createTempDir()
    await fs.mkdir(path.join(skillDir, 'assets'), { recursive: true })
    await fs.writeFile(path.join(skillDir, 'assets', 'guide.md'), '# guide', 'utf-8')
    await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'secret', 'utf-8')

    const skill = createSkillRecord('release-helper', {
      skillDir: await fs.realpath(skillDir),
      skillFilePath: path.join(await fs.realpath(skillDir), 'SKILL.md')
    })

    const allowedPath = await resolveSkillResourcePath(skill, 'assets/guide.md')
    const blockedPath = await resolveSkillResourcePath(skill, `../${path.basename(outsideDir)}/secret.txt`)

    expect(allowedPath).toBe(path.join(await fs.realpath(skillDir), 'assets', 'guide.md'))
    expect(blockedPath).toBeNull()
  })

  it('支持通过 metadata 名称查询并导出独立的技能摘要', () => {
    const skill = createSkillRecord('release-helper', {
      metadata: createSkillMetadata('Release Helper', 'helper', ['search'])
    })
    const index = new Map([[skill.id, skill]])

    const matchedSkill = findSkillInIndex(index, 'Release Helper')
    const summary = toSkillSummary(skill)
    summary.allowedTools.push('bash')

    expect(matchedSkill).toBe(skill)
    expect(skill.metadata.allowedTools).toEqual(['search'])
  })
})
