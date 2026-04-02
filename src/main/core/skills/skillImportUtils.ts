import { execFile } from 'child_process'
import fs from 'fs/promises'
import path from 'path'
import {
  SKILL_IMPORT_ERROR,
  SkillRecord
} from '../../../shared/contracts'
import {
  createSkillStoreId,
  normalizeSkillFolderId,
  parseSkillFrontmatter
} from './skillStoreUtils'

export function escapePowerShellLiteral(value: string) {
  return value.replace(/'/g, "''")
}

export async function execFileCommand(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error) => {
      if (error) {
        reject(new Error(SKILL_IMPORT_ERROR.extractFailed))
        return
      }

      resolve()
    })
  })
}

export async function extractImportedSkillArchive(sourceFile: string, targetDir: string) {
  await fs.rm(targetDir, { recursive: true, force: true })
  await fs.mkdir(targetDir, { recursive: true })

  if (process.platform === 'win32') {
    await execFileCommand('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${escapePowerShellLiteral(sourceFile)}' -DestinationPath '${escapePowerShellLiteral(targetDir)}' -Force`
    ])
    return
  }

  if (process.platform === 'darwin') {
    await execFileCommand('ditto', ['-x', '-k', sourceFile, targetDir])
    return
  }

  await execFileCommand('unzip', ['-q', sourceFile, '-d', targetDir])
}

export async function findImportedSkillFiles(baseDir: string, fileName: string): Promise<string[]> {
  const matches: string[] = []
  const entries = await fs.readdir(baseDir, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.name === '__MACOSX') {
      continue
    }

    const entryPath = path.join(baseDir, entry.name)
    if (entry.isSymbolicLink()) {
      throw new Error(SKILL_IMPORT_ERROR.symbolicLinksNotSupported)
    }

    if (entry.isDirectory()) {
      matches.push(...await findImportedSkillFiles(entryPath, fileName))
      continue
    }

    if (entry.isFile() && entry.name === fileName) {
      matches.push(entryPath)
    }
  }

  return matches
}

export async function resolveImportedSkillDirectory(extractionDir: string) {
  const resolvedExtractionDir = await fs.realpath(extractionDir)
  const skillFiles = await findImportedSkillFiles(resolvedExtractionDir, 'SKILL.md')

  if (skillFiles.length === 0) {
    throw new Error(SKILL_IMPORT_ERROR.missingSkillFile)
  }

  if (skillFiles.length > 1) {
    throw new Error(SKILL_IMPORT_ERROR.multipleSkillFiles)
  }

  const skillDir = await fs.realpath(path.dirname(skillFiles[0]))
  if (
    skillDir !== resolvedExtractionDir
    && !skillDir.startsWith(`${resolvedExtractionDir}${path.sep}`)
  ) {
    throw new Error(SKILL_IMPORT_ERROR.invalidFilePath)
  }

  return skillDir
}

export async function copyImportedSkillDirectory(sourceDir: string, targetDir: string) {
  await fs.mkdir(targetDir, { recursive: true })
  const entries = await fs.readdir(sourceDir, { withFileTypes: true })

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name)
    const targetPath = path.join(targetDir, entry.name)

    if (entry.isSymbolicLink()) {
      throw new Error(SKILL_IMPORT_ERROR.symbolicLinksNotSupported)
    }

    if (entry.isDirectory()) {
      await copyImportedSkillDirectory(sourcePath, targetPath)
      continue
    }

    if (entry.isFile()) {
      await fs.copyFile(sourcePath, targetPath)
      continue
    }

    throw new Error(SKILL_IMPORT_ERROR.unsupportedFileType)
  }
}

export async function importPreparedSkillDirectory(params: {
  sourceDir: string
  targetBaseDir: string
  agentId?: string
  pathExists: (targetPath: string) => Promise<boolean>
  readSkillRecord: (
    skillDir: string,
    scope: 'public' | 'agent',
    folderName: string,
    agentId?: string
  ) => Promise<SkillRecord | null>
}) {
  const resolvedSourceDir = await fs.realpath(params.sourceDir)
  const sourceSkillFilePath = path.join(resolvedSourceDir, 'SKILL.md')
  let rawSkillContent = ''
  let resolvedSourceSkillFilePath = ''

  try {
    [rawSkillContent, resolvedSourceSkillFilePath] = await Promise.all([
      fs.readFile(sourceSkillFilePath, 'utf-8'),
      fs.realpath(sourceSkillFilePath)
    ])
  } catch {
    throw new Error(SKILL_IMPORT_ERROR.missingSkillFile)
  }

  if (resolvedSourceSkillFilePath !== path.join(resolvedSourceDir, 'SKILL.md')) {
    throw new Error(SKILL_IMPORT_ERROR.missingSkillFile)
  }

  const sourceFolderName = path.basename(resolvedSourceDir)
  const parsedSkill = parseSkillFrontmatter(rawSkillContent, sourceFolderName)
  const skillId = normalizeSkillFolderId(sourceFolderName) ?? createSkillStoreId(parsedSkill.metadata.name)
  if (!skillId) {
    throw new Error(SKILL_IMPORT_ERROR.invalidSkillId)
  }

  const targetSkillDir = path.join(params.targetBaseDir, skillId)
  if (await params.pathExists(targetSkillDir)) {
    throw new Error(SKILL_IMPORT_ERROR.duplicateSkill)
  }

  try {
    await copyImportedSkillDirectory(resolvedSourceDir, targetSkillDir)
    const importedSkill = await params.readSkillRecord(
      targetSkillDir,
      params.agentId ? 'agent' : 'public',
      skillId,
      params.agentId
    )

    if (!importedSkill) {
      throw new Error(SKILL_IMPORT_ERROR.invalidSkillPackage)
    }
  } catch (error) {
    await fs.rm(targetSkillDir, { recursive: true, force: true })
    throw error
  }

  return {
    skillId,
    targetSkillDir
  }
}
