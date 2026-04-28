import { createHash } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import {
  SkillRecord,
  SkillSummary
} from '../../../shared/contracts'
import { parseSkillFrontmatter } from './skillStoreUtils'

export function findSkillInIndex(index: Map<string, SkillRecord>, skillName: string) {
  const directMatch = index.get(skillName)
  if (directMatch) {
    return directMatch
  }

  for (const skill of index.values()) {
    if (skill.metadata.name === skillName) {
      return skill
    }
  }

  return null
}

export function toSkillSummary(skill: SkillRecord): SkillSummary {
  return {
    id: skill.id,
    name: skill.metadata.name,
    description: skill.metadata.description,
    version: skill.metadata.version,
    allowedTools: [...skill.metadata.allowedTools],
    whenToUse: skill.metadata.whenToUse,
    arguments: skill.metadata.arguments.map((argument) => ({ ...argument })),
    userInvocable: skill.metadata.userInvocable,
    modelInvocable: skill.metadata.modelInvocable,
    executionMode: skill.metadata.executionMode,
    content: skill.content,
    source: skill.scope,
    skillDir: skill.skillDir,
    skillFilePath: skill.skillFilePath
  }
}

export async function readSkillRecord(
  skillDir: string,
  scope: 'public' | 'agent',
  folderName: string,
  agentId?: string
) {
  const skillFilePath = path.join(skillDir, 'SKILL.md')

  try {
    const [rawContent, resolvedSkillDir, resolvedSkillFilePath] = await Promise.all([
      fs.readFile(skillFilePath, 'utf-8'),
      fs.realpath(skillDir),
      fs.realpath(skillFilePath)
    ])

    if (resolvedSkillFilePath !== path.join(resolvedSkillDir, 'SKILL.md')) {
      return null
    }

    const parsed = parseSkillFrontmatter(rawContent, folderName)

    return {
      id: folderName,
      scope,
      agentId,
      content: parsed.body,
      skillDir: resolvedSkillDir,
      skillFilePath: resolvedSkillFilePath,
      contentHash: createHash('sha256').update(rawContent).digest('hex'),
      metadata: parsed.metadata
    } satisfies SkillRecord
  } catch {
    return null
  }
}

export async function scanSkillsDirectory(
  baseDir: string,
  scope: 'public' | 'agent',
  options?: {
    agentId?: string
    readSkillRecord?: typeof readSkillRecord
  }
) {
  const skills: SkillRecord[] = []

  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) {
        continue
      }

      const skillRecord = await (options?.readSkillRecord ?? readSkillRecord)(
        path.join(baseDir, entry.name),
        scope,
        entry.name,
        options?.agentId
      )
      if (skillRecord) {
        skills.push(skillRecord)
      }
    }
  } catch {
    return skills
  }

  return skills
}

export async function findSkillRecord(params: {
  skillName: string
  agentId?: string
  loadAllSkills: () => Promise<void>
  loadAgentSkills: (agentId: string) => Promise<void>
  getPublicSkillIndex: () => Map<string, SkillRecord>
  getAgentIndex: (agentId: string) => Map<string, SkillRecord>
}) {
  const normalizedSkillName = params.skillName.trim()
  if (!normalizedSkillName) {
    return null
  }

  if (params.agentId) {
    await params.loadAgentSkills(params.agentId)
    const agentSkill = findSkillInIndex(params.getAgentIndex(params.agentId), normalizedSkillName)
    if (agentSkill) {
      return agentSkill
    }
  }

  await params.loadAllSkills()
  return findSkillInIndex(params.getPublicSkillIndex(), normalizedSkillName)
}

export async function resolveSkillResourcePath(skill: SkillRecord, resourcePath: string) {
  const normalizedResourcePath = resourcePath.trim()
  if (!normalizedResourcePath || path.isAbsolute(normalizedResourcePath)) {
    return null
  }

  const candidatePath = path.resolve(skill.skillDir, normalizedResourcePath)
  try {
    const [skillRootPath, resolvedResourcePath] = await Promise.all([
      fs.realpath(skill.skillDir),
      fs.realpath(candidatePath)
    ])

    if (
      resolvedResourcePath === skillRootPath
      || resolvedResourcePath.startsWith(`${skillRootPath}${path.sep}`)
    ) {
      return resolvedResourcePath
    }
  } catch {
    return null
  }

  return null
}
