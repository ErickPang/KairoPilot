import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SKILL_IMPORT_ERROR, SkillRecord } from '../../../shared/contracts'
import {
  copyImportedSkillDirectory,
  importPreparedSkillDirectory,
  resolveImportedSkillDirectory
} from './skillImportUtils'

const tempDirs: string[] = []

async function createTempDir() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kairopilot-skill-import-'))
  tempDirs.push(tempDir)
  return tempDir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('skillImportUtils', () => {
  it('从解压目录中定位唯一的技能目录', async () => {
    const extractionDir = await createTempDir()
    const nestedSkillDir = path.join(extractionDir, 'bundle', 'release-helper')
    await fs.mkdir(nestedSkillDir, { recursive: true })
    await fs.writeFile(path.join(nestedSkillDir, 'SKILL.md'), '# demo', 'utf-8')

    const resolvedDir = await resolveImportedSkillDirectory(extractionDir)

    expect(resolvedDir).toBe(await fs.realpath(nestedSkillDir))
  })

  it('当解压结果中存在多个技能目录时抛出错误', async () => {
    const extractionDir = await createTempDir()
    const firstDir = path.join(extractionDir, 'a')
    const secondDir = path.join(extractionDir, 'b')
    await fs.mkdir(firstDir, { recursive: true })
    await fs.mkdir(secondDir, { recursive: true })
    await fs.writeFile(path.join(firstDir, 'SKILL.md'), '# first', 'utf-8')
    await fs.writeFile(path.join(secondDir, 'SKILL.md'), '# second', 'utf-8')

    await expect(resolveImportedSkillDirectory(extractionDir)).rejects.toThrow(SKILL_IMPORT_ERROR.multipleSkillFiles)
  })

  it('导入技能目录时复制文件并调用读取校验逻辑', async () => {
    const sourceRoot = await createTempDir()
    const targetRoot = await createTempDir()
    const sourceDir = path.join(sourceRoot, 'release-helper')
    await fs.mkdir(path.join(sourceDir, 'assets'), { recursive: true })
    await fs.writeFile(path.join(sourceDir, 'SKILL.md'), `---
name: release-helper
description: helper
---

# Release Helper`, 'utf-8')
    await fs.writeFile(path.join(sourceDir, 'assets', 'guide.txt'), 'hello', 'utf-8')

    const readSkillRecord = vi.fn(async (skillDir: string, scope: 'public' | 'agent', folderName: string, agentId?: string) => ({
      id: folderName,
      scope,
      agentId,
      content: '# Release Helper',
      skillDir,
      skillFilePath: path.join(skillDir, 'SKILL.md'),
      contentHash: 'hash',
      metadata: {
        name: 'release-helper',
        description: 'helper',
        metadata: {
          version: undefined,
          allowedTools: []
        }
      }
    } satisfies SkillRecord))

    const result = await importPreparedSkillDirectory({
      sourceDir,
      targetBaseDir: targetRoot,
      pathExists: async () => false,
      readSkillRecord
    })

    expect(result.skillId).toBe('release-helper')
    expect(await fs.readFile(path.join(targetRoot, 'release-helper', 'SKILL.md'), 'utf-8')).toContain('release-helper')
    expect(await fs.readFile(path.join(targetRoot, 'release-helper', 'assets', 'guide.txt'), 'utf-8')).toBe('hello')
    expect(readSkillRecord).toHaveBeenCalledWith(
      path.join(targetRoot, 'release-helper'),
      'public',
      'release-helper',
      undefined
    )
  })

  it('复制目录时拒绝符号链接', async () => {
    const sourceDir = await createTempDir()
    const targetDir = await createTempDir()
    await fs.writeFile(path.join(sourceDir, 'SKILL.md'), '# demo', 'utf-8')
    await fs.symlink(path.join(sourceDir, 'SKILL.md'), path.join(sourceDir, 'linked.md'))

    await expect(copyImportedSkillDirectory(sourceDir, path.join(targetDir, 'copied'))).rejects.toThrow(SKILL_IMPORT_ERROR.symbolicLinksNotSupported)
  })
})
