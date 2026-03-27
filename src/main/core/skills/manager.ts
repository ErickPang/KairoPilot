import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { createHash } from 'crypto'
import { getAgent } from '../../store/config'
import { SkillMetadata, SkillRecord, SkillSummary } from '../../../shared/contracts'

interface FrontmatterParseResult {
  metadata: SkillMetadata
  body: string
}

function countIndent(line: string) {
  const match = line.match(/^(\s*)/)
  return match ? match[1].length : 0
}

function stripQuotes(value: string) {
  const normalized = value.trim()
  if (
    (normalized.startsWith('"') && normalized.endsWith('"'))
    || (normalized.startsWith('\'') && normalized.endsWith('\''))
  ) {
    return normalized.slice(1, -1)
  }
  return normalized
}

function parseInlineArray(value: string) {
  const normalized = value.trim()
  if (!normalized.startsWith('[') || !normalized.endsWith(']')) {
    return []
  }
  return normalized
    .slice(1, -1)
    .split(',')
    .map((item) => stripQuotes(item))
    .map((item) => item.trim())
    .filter(Boolean)
}

function collectBlockValue(lines: string[], startIndex: number, parentIndent: number, mode: '|' | '>') {
  const blockLines: string[] = []
  let index = startIndex
  let blockIndent = -1

  while (index < lines.length) {
    const currentLine = lines[index]
    const trimmed = currentLine.trim()
    const currentIndent = countIndent(currentLine)

    if (trimmed.length === 0) {
      blockLines.push('')
      index += 1
      continue
    }

    if (currentIndent <= parentIndent) {
      break
    }

    if (blockIndent < 0) {
      blockIndent = currentIndent
    }

    blockLines.push(currentLine.slice(blockIndent))
    index += 1
  }

  const normalized = mode === '>'
    ? blockLines.map((line) => line.trim()).filter(Boolean).join(' ')
    : blockLines.join('\n').trim()

  return {
    value: normalized,
    nextIndex: index
  }
}

function parseSkillFrontmatter(content: string, folderName: string): FrontmatterParseResult {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  const rawFrontmatter = frontmatterMatch?.[1] ?? ''
  const body = frontmatterMatch ? content.slice(frontmatterMatch[0].length).trim() : content.trim()
  const metadata: SkillMetadata = {
    name: folderName,
    description: `Skill: ${folderName}`,
    metadata: {
      allowedTools: []
    }
  }

  if (!rawFrontmatter) {
    return {
      metadata,
      body
    }
  }

  const lines = rawFrontmatter.split(/\r?\n/)
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()
    const indent = countIndent(line)

    if (!trimmed || trimmed.startsWith('#') || indent !== 0) {
      index += 1
      continue
    }

    if (trimmed.startsWith('name:')) {
      metadata.name = stripQuotes(trimmed.slice('name:'.length)) || folderName
      index += 1
      continue
    }

    if (trimmed.startsWith('description:')) {
      const rawValue = trimmed.slice('description:'.length).trim()
      if (rawValue === '|' || rawValue === '>') {
        const block = collectBlockValue(lines, index + 1, indent, rawValue)
        metadata.description = block.value || metadata.description
        index = block.nextIndex
        continue
      }
      metadata.description = stripQuotes(rawValue) || metadata.description
      index += 1
      continue
    }

    if (trimmed === 'metadata:') {
      index += 1
      while (index < lines.length) {
        const childLine = lines[index]
        const childTrimmed = childLine.trim()
        const childIndent = countIndent(childLine)

        if (!childTrimmed) {
          index += 1
          continue
        }

        if (childIndent <= indent) {
          break
        }

        if (childTrimmed.startsWith('version:')) {
          const version = stripQuotes(childTrimmed.slice('version:'.length))
          metadata.metadata.version = version || undefined
          index += 1
          continue
        }

        if (childTrimmed.startsWith('allowed-tools:')) {
          const inlineValue = childTrimmed.slice('allowed-tools:'.length).trim()
          if (inlineValue) {
            metadata.metadata.allowedTools = parseInlineArray(inlineValue)
            index += 1
            continue
          }

          const tools: string[] = []
          index += 1
          while (index < lines.length) {
            const listLine = lines[index]
            const listTrimmed = listLine.trim()
            const listIndent = countIndent(listLine)

            if (!listTrimmed) {
              index += 1
              continue
            }

            if (listIndent <= childIndent) {
              break
            }

            if (listTrimmed.startsWith('- ')) {
              const toolName = stripQuotes(listTrimmed.slice(2))
              if (toolName) {
                tools.push(toolName)
              }
            }

            index += 1
          }

          metadata.metadata.allowedTools = tools
          continue
        }

        index += 1
      }
      continue
    }

    index += 1
  }

  return {
    metadata,
    body
  }
}

export class SkillsManager {
  private publicSkillsDir: string
  private publicSkillIndex = new Map<string, SkillRecord>()
  private agentSkillIndex = new Map<string, Map<string, SkillRecord>>()

  constructor() {
    this.publicSkillsDir = path.join(app.getPath('home'), '.kairopilot', 'skills')
  }

  async initialize() {
    await this.ensureSkillsDirectories()
    await this.loadAllSkills()
  }

  async loadAllSkills() {
    await this.ensureSkillsDirectories()
    const publicSkills = await this.scanSkillsDirectory(this.publicSkillsDir, 'public')
    this.publicSkillIndex = new Map(publicSkills.map((skill) => [skill.id, skill]))
  }

  async loadAgentSkills(agentId: string) {
    await this.ensureSkillsDirectories()
    const agentSkillsDir = this.getAgentSkillsDirectoryPath(agentId)
    const agentSkills = await this.scanSkillsDirectory(agentSkillsDir, 'agent', agentId)
    this.agentSkillIndex.set(agentId, new Map(agentSkills.map((skill) => [skill.id, skill])))
  }

  async listPublicSkills() {
    await this.loadAllSkills()
    return Array.from(this.publicSkillIndex.values()).map((skill) => this.toSkillSummary(skill))
  }

  async listAgentSkills(agentId: string) {
    await this.loadAgentSkills(agentId)
    return Array.from(this.getAgentIndex(agentId).values()).map((skill) => this.toSkillSummary(skill))
  }

  async listMergedSkills(agentId: string) {
    await this.loadAllSkills()
    await this.loadAgentSkills(agentId)

    const merged = new Map<string, SkillRecord>()
    for (const skill of this.publicSkillIndex.values()) {
      merged.set(skill.id, skill)
    }
    for (const skill of this.getAgentIndex(agentId).values()) {
      merged.set(skill.id, skill)
    }

    return Array.from(merged.values()).map((skill) => this.toSkillSummary(skill))
  }

  async getMetadata(skillName: string, agentId?: string) {
    const skill = await this.findSkillRecord(skillName, agentId)
    return skill?.metadata ?? null
  }

  async readSkillContent(skillName: string, agentId?: string) {
    const skill = await this.findSkillRecord(skillName, agentId)
    return skill?.content ?? null
  }

  async resolveSkillPath(skillName: string, agentId?: string) {
    const skill = await this.findSkillRecord(skillName, agentId)
    return skill?.skillDir ?? null
  }

  async resolveResourcePath(skillName: string, resourcePath: string, agentId?: string) {
    const skill = await this.findSkillRecord(skillName, agentId)
    if (!skill) {
      return null
    }

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

  async resolveReferencePath(skillName: string, resourceName: string, agentId?: string) {
    return this.resolveResourcePath(skillName, path.posix.join('references', resourceName), agentId)
  }

  async resolveScriptPath(skillName: string, resourceName: string, agentId?: string) {
    return this.resolveResourcePath(skillName, path.posix.join('scripts', resourceName), agentId)
  }

  async resolveAssetPath(skillName: string, resourceName: string, agentId?: string) {
    return this.resolveResourcePath(skillName, path.posix.join('assets', resourceName), agentId)
  }

  async readSkillResource(skillName: string, resourcePath: string, agentId?: string) {
    const resolvedPath = await this.resolveResourcePath(skillName, resourcePath, agentId)
    if (!resolvedPath) {
      return null
    }

    const content = await fs.readFile(resolvedPath, 'utf-8')
    return {
      path: resolvedPath,
      content
    }
  }

  async canUseAllowedTool(skillName: string, toolName: string, agentId?: string) {
    const metadata = await this.getMetadata(skillName, agentId)
    if (!metadata) {
      return false
    }

    return metadata.metadata.allowedTools.includes(toolName) || metadata.metadata.allowedTools.includes('*')
  }

  getPublicSkillsDirectoryPath() {
    return this.publicSkillsDir
  }

  getAgentSkillsDirectoryPath(agentId: string) {
    const agent = getAgent(agentId)
    if (agent?.workspace) {
      return path.join(agent.workspace, 'skills')
    }

    const fallbackName = agentId === 'mainAgent' ? 'workspace' : `workspace-${agentId}`
    return path.join(app.getPath('userData'), fallbackName, 'skills')
  }

  private async ensureSkillsDirectories() {
    await fs.mkdir(this.publicSkillsDir, { recursive: true })
  }

  private getAgentIndex(agentId: string) {
    return this.agentSkillIndex.get(agentId) ?? new Map<string, SkillRecord>()
  }

  private async findSkillRecord(skillName: string, agentId?: string) {
    const normalizedSkillName = skillName.trim()
    if (!normalizedSkillName) {
      return null
    }

    if (agentId) {
      await this.loadAgentSkills(agentId)
      const agentSkill = this.findSkillInIndex(this.getAgentIndex(agentId), normalizedSkillName)
      if (agentSkill) {
        return agentSkill
      }
    }

    await this.loadAllSkills()
    return this.findSkillInIndex(this.publicSkillIndex, normalizedSkillName)
  }

  private async scanSkillsDirectory(baseDir: string, scope: 'public' | 'agent', agentId?: string) {
    const skills: SkillRecord[] = []

    try {
      const entries = await fs.readdir(baseDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) {
          continue
        }

        const skillRecord = await this.readSkillRecord(path.join(baseDir, entry.name), scope, entry.name, agentId)
        if (skillRecord) {
          skills.push(skillRecord)
        }
      }
    } catch {
      return skills
    }

    return skills
  }

  private async readSkillRecord(skillDir: string, scope: 'public' | 'agent', folderName: string, agentId?: string) {
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

  private toSkillSummary(skill: SkillRecord): SkillSummary {
    return {
      id: skill.id,
      name: skill.metadata.name,
      description: skill.metadata.description,
      version: skill.metadata.metadata.version,
      allowedTools: [...skill.metadata.metadata.allowedTools],
      content: skill.content,
      source: skill.scope,
      skillDir: skill.skillDir,
      skillFilePath: skill.skillFilePath
    }
  }

  private findSkillInIndex(index: Map<string, SkillRecord>, skillName: string) {
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
}

export const skillsManager = new SkillsManager()
