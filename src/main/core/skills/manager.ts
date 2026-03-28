import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { createHash, randomUUID } from 'crypto'
import { OpenAIProvider } from '../llm/provider'
import { getActiveAgentId, getAgent, getAgents, getKairoPilotConfig, getModelForAgent, saveKairoPilotConfig } from '../../store/config'
import {
  DEFAULT_SKILL_MARKETPLACE_PRESETS,
  SkillInstallArgs,
  SkillInstallReview,
  SkillInstallReviewArgs,
  SkillMarketplaceQuery,
  SkillMetadata,
  SkillRecord,
  SkillReviewFinding,
  SkillsRegistryEntry,
  SkillsRegistrySourceType,
  SkillStoreEntry,
  SkillStoreResource,
  SkillStoreSource,
  SkillSummary
} from '../../../shared/contracts'

interface FrontmatterParseResult {
  metadata: SkillMetadata
  body: string
}

interface SkillMarketplaceCatalog {
  name?: string
  skills?: unknown
}

interface ClaudeMarketplaceCatalog {
  name?: string
  homepage?: string
  plugins?: unknown
}

interface MaterializedSkillFile {
  path: string
  content: string
  encoding: 'utf-8' | 'base64'
}

interface MaterializedSkill {
  skillContent: string
  files: MaterializedSkillFile[]
}

interface PreparedSkillInstall {
  requestId: string
  skillId: string
  scope: string
  tempSkillDir: string
  targetSkillDir: string
  review: SkillInstallReview
}

interface NormalizedSkillsRegistrySource {
  type: SkillsRegistrySourceType
  url: string
  name?: string
}

interface ParsedGithubRawSource {
  repo: string
  ref: string
  basePath: string
}

const DEFAULT_SKILL_MARKETPLACE_SOURCES: NormalizedSkillsRegistrySource[] = DEFAULT_SKILL_MARKETPLACE_PRESETS.map((preset) => ({
  type: preset.type,
  url: preset.url,
  name: preset.name
}))

const FALLBACK_STORE_SKILLS: SkillStoreEntry[] = [
  {
    id: 'research-brief',
    name: 'Research Brief',
    description: '将主题调研拆解为检索、归纳与输出三个阶段，适合市场分析与资料整理。',
    version: '1.0.0',
    author: 'KairoPilot',
    icon: '🔎',
    tags: ['research', 'analysis', 'brief'],
    marketplace: 'KairoPilot Curated',
    installedScopes: [],
    source: {
      type: 'inline',
      content: `---
name: research-brief
description: 当用户需要围绕一个主题做市场调研、竞品调研或信息归纳时使用。
metadata:
  version: "1.0.0"
  allowed-tools: ["WebSearch", "WebFetch", "Read", "SearchCodebase"]
---

# Research Brief

在开始执行前，先将用户问题拆分为目标、范围、时间窗口与输出形式。

执行步骤：
1. 使用 WebSearch 找到最新、最相关的来源。
2. 对关键来源使用 WebFetch 获取正文。
3. 输出结构化结论，包括背景、核心发现、风险与建议。
4. 如果用户需要面向汇报的内容，整理成适合 PPT 的分点表达。`
    }
  },
  {
    id: 'issue-triage',
    name: 'Issue Triage',
    description: '用于排查缺陷、收敛根因并给出修复路径，适合日常 Bug 处理。',
    version: '1.0.0',
    author: 'KairoPilot',
    icon: '🛠️',
    tags: ['bugfix', 'triage', 'debug'],
    marketplace: 'KairoPilot Curated',
    installedScopes: [],
    source: {
      type: 'inline',
      content: `---
name: issue-triage
description: 当用户反馈异常、报错、卡顿或行为不一致时使用。
metadata:
  version: "1.0.0"
  allowed-tools: ["SearchCodebase", "Read", "Grep", "RunCommand", "GetDiagnostics"]
---

# Issue Triage

目标是快速定位问题并提供最小可行修复。

执行步骤：
1. 先收集异常现象、影响范围与重现条件。
2. 使用 SearchCodebase 和 Grep 缩小到相关模块。
3. 必要时读取诊断信息或执行验证命令。
4. 输出根因、修复点、验证方式与潜在回归风险。`
    }
  },
  {
    id: 'release-checklist',
    name: 'Release Checklist',
    description: '用于功能上线前的验收与发布检查，适合版本提测和发布前巡检。',
    version: '1.0.0',
    author: 'KairoPilot',
    icon: '🚀',
    tags: ['release', 'qa', 'checklist'],
    marketplace: 'KairoPilot Curated',
    installedScopes: [],
    source: {
      type: 'inline',
      content: `---
name: release-checklist
description: 当用户准备发布版本、提测或做上线检查时使用。
metadata:
  version: "1.0.0"
  allowed-tools: ["Read", "SearchCodebase", "RunCommand", "GetDiagnostics"]
---

# Release Checklist

围绕代码质量、配置、安全性和发布风险做发布前检查。

执行步骤：
1. 明确本次发布范围与涉及模块。
2. 检查关键配置、权限和环境差异。
3. 运行项目已有的 lint、typecheck 或测试命令。
4. 总结发布风险、回滚关注点与建议。`
    }
  }
]

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function trimSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, '')
}

function normalizeRelativePath(value: string) {
  const normalized = value.trim().replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/')) {
    return null
  }

  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) {
    return null
  }

  return parts.join('/')
}

function normalizeSkillFolderId(value: string) {
  const normalized = value.trim()
  if (!/^[a-zA-Z0-9._-]+$/.test(normalized)) {
    return null
  }
  return normalized
}

function normalizeSkillStoreResource(value: unknown) {
  if (!isRecord(value) || typeof value.path !== 'string') {
    return null
  }

  const resourcePath = normalizeRelativePath(value.path)
  if (!resourcePath) {
    return null
  }

  const encoding = value.encoding === 'base64' ? 'base64' : 'utf-8'
  const resource: SkillStoreResource = {
    path: resourcePath,
    encoding
  }

  if (typeof value.url === 'string' && value.url.trim()) {
    resource.url = value.url.trim()
  }

  if (typeof value.content === 'string') {
    resource.content = value.content
  }

  return resource
}

function normalizeSkillStoreSource(value: unknown): SkillStoreSource | null {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null
  }

  if (value.type === 'inline' && typeof value.content === 'string') {
    return {
      type: 'inline',
      content: value.content,
      files: Array.isArray(value.files)
        ? value.files
          .map((item) => normalizeSkillStoreResource(item))
          .filter((item): item is SkillStoreResource => item !== null)
        : []
    }
  }

  if (value.type === 'http' && typeof value.skillUrl === 'string' && value.skillUrl.trim()) {
    return {
      type: 'http',
      skillUrl: value.skillUrl.trim(),
      files: Array.isArray(value.files)
        ? value.files
          .map((item) => normalizeSkillStoreResource(item))
          .filter((item): item is SkillStoreResource => item !== null)
        : []
    }
  }

  if (
    value.type === 'github'
    && typeof value.repo === 'string'
    && value.repo.trim()
    && typeof value.path === 'string'
    && value.path.trim()
  ) {
    return {
      type: 'github',
      repo: value.repo.trim(),
      path: trimSlashes(value.path.trim()),
      ref: typeof value.ref === 'string' && value.ref.trim() ? value.ref.trim() : undefined,
      files: Array.isArray(value.files)
        ? value.files
          .map((item) => normalizeSkillStoreResource(item))
          .filter((item): item is SkillStoreResource => item !== null)
        : []
    }
  }

  return null
}

function normalizeSkillStoreEntry(
  value: unknown,
  marketplaceName?: string,
  registryUrl?: string,
  sourceType?: SkillsRegistrySourceType
): SkillStoreEntry | null {
  if (!isRecord(value)) {
    return null
  }

  if (
    typeof value.id !== 'string'
    || typeof value.name !== 'string'
    || typeof value.description !== 'string'
  ) {
    return null
  }

  const id = normalizeSkillFolderId(value.id)
  if (!id) {
    return null
  }

  const source = normalizeSkillStoreSource(value.source)
  if (!source) {
    return null
  }

  return {
    id,
    name: value.name.trim() || id,
    description: value.description.trim() || `Skill: ${id}`,
    version: typeof value.version === 'string' && value.version.trim() ? value.version.trim() : undefined,
    author: typeof value.author === 'string' && value.author.trim() ? value.author.trim() : undefined,
    icon: typeof value.icon === 'string' && value.icon.trim() ? value.icon.trim() : undefined,
    tags: Array.isArray(value.tags)
      ? value.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean)
      : [],
    homepage: typeof value.homepage === 'string' && value.homepage.trim() ? value.homepage.trim() : undefined,
    marketplace: typeof value.marketplace === 'string' && value.marketplace.trim()
      ? value.marketplace.trim()
      : marketplaceName,
    registryUrl,
    sourceType,
    source,
    installedScopes: []
  }
}

function normalizeMarketplaceResponse(value: unknown) {
  if (Array.isArray(value)) {
    return {
      name: undefined,
      skills: value
    } satisfies SkillMarketplaceCatalog
  }

  if (isRecord(value)) {
    return {
      name: typeof value.name === 'string' ? value.name : undefined,
      skills: value.skills
    } satisfies SkillMarketplaceCatalog
  }

  return {
    name: undefined,
    skills: []
  } satisfies SkillMarketplaceCatalog
}

function normalizeClaudeMarketplaceResponse(value: unknown) {
  if (isRecord(value)) {
    return {
      name: typeof value.name === 'string' ? value.name.trim() : undefined,
      homepage: resolveMarketplaceLink(value.homepage) ?? resolveMarketplaceLink(value.repository),
      plugins: value.plugins
    } satisfies ClaudeMarketplaceCatalog
  }

  return {
    name: undefined,
    homepage: undefined,
    plugins: []
  } satisfies ClaudeMarketplaceCatalog
}

function normalizeSkillsRegistryEntry(value: SkillsRegistryEntry): NormalizedSkillsRegistrySource | null {
  if (typeof value === 'string' && value.trim()) {
    return {
      type: 'manifest',
      url: value.trim()
    }
  }

  if (
    isRecord(value)
    && ((value.type === 'manifest' || value.type === 'claude_marketplace') || typeof value.url === 'string')
    && typeof value.url === 'string'
    && value.url.trim()
    && value.enabled !== false
  ) {
    return {
      type: value.type === 'claude_marketplace' ? 'claude_marketplace' : 'manifest',
      url: value.url.trim(),
      name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : undefined
    }
  }

  return null
}

function isSkillMarketplaceQuery(value: unknown): value is SkillMarketplaceQuery {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return false
  }

  if (value.kind === 'curated') {
    return true
  }

  return value.kind === 'registry' && typeof value.url === 'string' && value.url.trim().length > 0
}

function assertHttpsUrl(url: string) {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid remote url: ${url}`)
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`Only HTTPS skill sources are supported: ${url}`)
  }

  return parsed.toString()
}

function resolveMarketplaceLink(value: unknown) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  if (isRecord(value) && typeof value.url === 'string' && value.url.trim()) {
    return value.url.trim()
  }

  return undefined
}

function normalizeRelativeMarketplacePath(value: string) {
  return normalizeRelativePath(value.trim().replace(/^\.?\//, ''))
}

function parseGithubRawSourceUrl(url: string): ParsedGithubRawSource | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  if (parsed.hostname !== 'raw.githubusercontent.com') {
    return null
  }

  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length < 5) {
    return null
  }

  const [owner, repo, ref, ...filePath] = segments
  if (!owner || !repo || !ref || filePath.length === 0) {
    return null
  }

  const basePath = path.posix.dirname(filePath.join('/'))
  return {
    repo: `${owner}/${repo}`,
    ref,
    basePath: basePath === '.' ? '' : trimSlashes(basePath)
  }
}

function createSkillStoreId(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalizeSkillFolderId(normalized)
}

function resolveSkillStoreAuthor(value: unknown) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  if (isRecord(value) && typeof value.name === 'string' && value.name.trim()) {
    return value.name.trim()
  }

  return undefined
}

function normalizeClaudeMarketplaceSkill(
  value: unknown,
  registrySource: NormalizedSkillsRegistrySource,
  catalog: ClaudeMarketplaceCatalog
): SkillStoreEntry | null {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.source !== 'string') {
    return null
  }

  const githubSource = parseGithubRawSourceUrl(registrySource.url)
  if (!githubSource) {
    return null
  }

  const relativeSourcePath = normalizeRelativeMarketplacePath(value.source)
  if (!relativeSourcePath) {
    return null
  }

  const idCandidate = typeof value.id === 'string' && value.id.trim()
    ? value.id.trim()
    : typeof value.slug === 'string' && value.slug.trim()
      ? value.slug.trim()
      : path.posix.basename(relativeSourcePath)
  const id = createSkillStoreId(idCandidate) ?? createSkillStoreId(value.name) ?? createSkillStoreId(relativeSourcePath)
  if (!id) {
    return null
  }

  const tags = new Set<string>()
  if (typeof value.category === 'string' && value.category.trim()) {
    tags.add(value.category.trim())
  }
  if (Array.isArray(value.keywords)) {
    for (const keyword of value.keywords) {
      if (typeof keyword === 'string' && keyword.trim()) {
        tags.add(keyword.trim())
      }
    }
  }

  const sourcePath = trimSlashes(path.posix.join(githubSource.basePath, relativeSourcePath))
  return {
    id,
    name: value.name.trim() || id,
    description: typeof value.description === 'string' && value.description.trim() ? value.description.trim() : `Skill: ${id}`,
    version: typeof value.version === 'string' && value.version.trim() ? value.version.trim() : undefined,
    author: resolveSkillStoreAuthor(value.author),
    icon: typeof value.icon === 'string' && value.icon.trim() ? value.icon.trim() : undefined,
    tags: Array.from(tags),
    homepage: resolveMarketplaceLink(value.homepage) ?? resolveMarketplaceLink(value.repository) ?? catalog.homepage,
    marketplace: catalog.name ?? registrySource.name,
    registryUrl: registrySource.url,
    sourceType: registrySource.type,
    source: {
      type: 'github',
      repo: githubSource.repo,
      ref: githubSource.ref,
      path: sourcePath
    },
    installedScopes: []
  }
}

function getEncodedContentBytes(file: MaterializedSkillFile) {
  if (file.encoding === 'base64') {
    return Buffer.from(file.content, 'base64').byteLength
  }

  return Buffer.byteLength(file.content, 'utf-8')
}

function formatBytes(size: number) {
  if (size < 1024) {
    return `${size} B`
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function createFinding(
  id: string,
  severity: 'low' | 'medium' | 'high',
  title: string,
  detail: string,
  filePath?: string
): SkillReviewFinding {
  return {
    id,
    severity,
    title,
    detail,
    filePath
  }
}

function summarizeRecommendation(findings: SkillReviewFinding[]) {
  const highCount = findings.filter((item) => item.severity === 'high').length
  const mediumCount = findings.filter((item) => item.severity === 'medium').length

  if (highCount > 0) {
    return 'block' as const
  }

  if (mediumCount > 0) {
    return 'caution' as const
  }

  return 'allow' as const
}

function buildStaticReviewFindings(skill: SkillStoreEntry, materializedSkill: MaterializedSkill) {
  const findings: SkillReviewFinding[] = []
  const parsedSkill = parseSkillFrontmatter(materializedSkill.skillContent, skill.id)
  const normalizedAllowedTools = parsedSkill.metadata.metadata.allowedTools.map((tool) => tool.toLowerCase())
  const riskyTools = normalizedAllowedTools.filter((tool) => (
    tool === '*'
    || tool.includes('runcommand')
    || tool.includes('runskillscript')
    || tool.includes('delete')
    || tool.includes('write')
    || tool.includes('execute')
  ))

  if (normalizedAllowedTools.includes('*')) {
    findings.push(createFinding(
      'allowed-tools-wildcard',
      'high',
      '允许调用任意工具',
      '该技能在 frontmatter 中声明了 * 通配符，安装后会显著扩大可调用能力边界。',
      'SKILL.md'
    ))
  } else if (riskyTools.length > 0) {
    findings.push(createFinding(
      'allowed-tools-privileged',
      'medium',
      '包含高权限工具',
      `该技能声明了较高权限工具：${riskyTools.join(', ')}，建议结合实际用途继续复核。`,
      'SKILL.md'
    ))
  }

  const executableFiles = materializedSkill.files.filter((file) => (
    /^scripts\//.test(file.path)
    || /\.(sh|bash|zsh|ps1|bat|cmd|py|js|mjs|cjs|exe|dylib|so)$/i.test(file.path)
  ))
  if (executableFiles.length > 0) {
    findings.push(createFinding(
      'executable-files',
      'medium',
      '技能包包含可执行脚本或二进制资源',
      `检测到 ${executableFiles.length} 个脚本或可执行资源，安装前应确认来源可信且用途明确。`,
      executableFiles[0]?.path
    ))
  }

  const textFiles: MaterializedSkillFile[] = [
    { path: 'SKILL.md', content: materializedSkill.skillContent, encoding: 'utf-8' },
    ...materializedSkill.files.filter((file) => file.encoding === 'utf-8')
  ]

  const secretPattern = /\b(api[_-]?key|access[_-]?token|secret|password|private[_-]?key)\b/i
  const riskyCommandPattern = /\b(rm\s+-rf|mkfs|diskutil\s+eraseDisk|curl\s+[^|\n]+\|\s*(sh|bash)|wget\s+[^|\n]+\|\s*(sh|bash)|sudo\s+|chmod\s+777|powershell\s+-enc)\b/i
  const insecureUrlPattern = /\bhttp:\/\/[^\s)]+/i

  for (const file of textFiles) {
    if (secretPattern.test(file.content)) {
      findings.push(createFinding(
        `secret-${file.path}`,
        'medium',
        '内容中出现敏感凭证相关字样',
        '检测到 token、secret 或 password 等关键字，需确认技能不会诱导输入或泄露敏感信息。',
        file.path
      ))
    }

    if (riskyCommandPattern.test(file.content)) {
      findings.push(createFinding(
        `command-${file.path}`,
        'high',
        '内容中出现高风险命令模式',
        '检测到删除磁盘、管道执行脚本或提升权限等命令模式，默认应视为高风险。',
        file.path
      ))
    }

    if (insecureUrlPattern.test(file.content)) {
      findings.push(createFinding(
        `http-${file.path}`,
        'medium',
        '内容中出现非 HTTPS 链接',
        '技能内容引用了 HTTP 资源，可能存在供应链劫持风险。',
        file.path
      ))
    }
  }

  return findings
}

function buildReviewSummary(
  recommendation: SkillInstallReview['recommendation'],
  findings: SkillReviewFinding[],
  downloadedFiles: number,
  downloadedBytes: number,
  usedSkillVetter: boolean
) {
  const severitySummary = findings.length === 0
    ? '未发现明显风险'
    : `发现 ${findings.length} 项风险提示（高风险 ${findings.filter((item) => item.severity === 'high').length} 项，中风险 ${findings.filter((item) => item.severity === 'medium').length} 项）`

  const recommendationText = recommendation === 'block'
    ? '建议暂不安装'
    : recommendation === 'caution'
      ? '建议审慎安装'
      : '可以继续安装'

  const vetterText = usedSkillVetter ? '已结合 skill-vetter 进行审核' : '当前仅完成静态审核'
  return `${recommendationText}，${severitySummary}。已下载 ${downloadedFiles} 个文件，共 ${formatBytes(downloadedBytes)}，${vetterText}。`
}

function buildMarkdownReviewReport(params: {
  skill: SkillStoreEntry
  scope: string
  downloadedFiles: number
  downloadedBytes: number
  recommendation: SkillInstallReview['recommendation']
  findings: SkillReviewFinding[]
  usedSkillVetter: boolean
  llmReport?: string
}) {
  const recommendationText = params.recommendation === 'block'
    ? '建议暂不安装'
    : params.recommendation === 'caution'
      ? '建议审慎安装'
      : '可以继续安装'

  const sections = [
    '# Skill Audit Report',
    '',
    `- 技能：${params.skill.name} (${params.skill.id})`,
    `- 安装范围：${params.scope}`,
    `- 来源：${params.skill.marketplace ?? '未知来源'}`,
    `- 下载文件数：${params.downloadedFiles}`,
    `- 下载体积：${formatBytes(params.downloadedBytes)}`,
    `- 审核结论：${recommendationText}`,
    `- 审核方式：${params.usedSkillVetter ? '静态扫描 + skill-vetter' : '静态扫描'}`,
    '',
    '## 静态扫描结果'
  ]

  if (params.findings.length === 0) {
    sections.push('- 未发现明显风险项。')
  } else {
    for (const finding of params.findings) {
      const location = finding.filePath ? ` (${finding.filePath})` : ''
      sections.push(`- [${finding.severity.toUpperCase()}] ${finding.title}${location}：${finding.detail}`)
    }
  }

  if (params.llmReport?.trim()) {
    sections.push('', '## skill-vetter 审核意见', params.llmReport.trim())
  }

  return sections.join('\n')
}

export class SkillsManager {
  private publicSkillsDir: string
  private publicSkillIndex = new Map<string, SkillRecord>()
  private agentSkillIndex = new Map<string, Map<string, SkillRecord>>()
  private pendingInstalls = new Map<string, PreparedSkillInstall>()
  private pendingInstallsDir: string

  constructor() {
    this.publicSkillsDir = path.join(app.getPath('home'), '.kairopilot', 'skills')
    this.pendingInstallsDir = path.join(app.getPath('userData'), 'pending-skill-installs')
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

  async getStoreSkills(query?: SkillMarketplaceQuery) {
    const installedScopeMap = await this.collectInstalledSkillScopes()
    const storeSkills = query
      ? await this.fetchMarketplaceSkillsByQuery(query)
      : await this.fetchMarketplaceSkills()
    return this.applyInstalledScopes(storeSkills, installedScopeMap)
  }

  async getRegistrySources() {
    const config = getKairoPilotConfig()
    return [...config.skills.registry]
  }

  async saveRegistrySources(entries: SkillsRegistryEntry[]) {
    const config = getKairoPilotConfig()
    config.skills.registry = entries
      .map((entry) => normalizeSkillsRegistryEntry(entry))
      .filter((entry): entry is NormalizedSkillsRegistrySource => entry !== null)
    saveKairoPilotConfig(config)
  }

  async prepareStoreSkillInstall(args: SkillInstallReviewArgs): Promise<SkillInstallReview> {
    const skillId = normalizeSkillFolderId(args.id)
    if (!skillId) {
      throw new Error('Invalid skill id.')
    }

    const scope = typeof args.scope === 'string' && args.scope.trim() ? args.scope.trim() : 'public'
    const target = this.resolveInstallScope(scope)
    const scopedMarketplaceQuery = isSkillMarketplaceQuery(args.marketplaceQuery) ? args.marketplaceQuery : undefined
    const storeSkills = await this.getStoreSkills(scopedMarketplaceQuery)
    const storeSkill = storeSkills.find((skill) => skill.id === skillId)

    if (!storeSkill) {
      throw new Error(`Skill ${skillId} not found in marketplace.`)
    }

    const materializedSkill = await this.materializeStoreSkill(storeSkill)
    const targetBaseDir = target.type === 'public'
      ? this.publicSkillsDir
      : this.getAgentSkillsDirectoryPath(target.agentId)
    const targetSkillDir = path.join(targetBaseDir, skillId)
    const requestId = randomUUID()
    const tempSkillDir = path.join(this.pendingInstallsDir, requestId, skillId)

    await fs.rm(tempSkillDir, { recursive: true, force: true })
    await this.writeMaterializedSkillToDirectory(tempSkillDir, materializedSkill)

    const review = await this.createSkillInstallReview({
      requestId,
      skill: storeSkill,
      scope,
      materializedSkill
    })

    const previousPreparedInstall = this.pendingInstalls.get(requestId)
    if (previousPreparedInstall) {
      await fs.rm(previousPreparedInstall.tempSkillDir, { recursive: true, force: true })
    }

    this.pendingInstalls.set(requestId, {
      requestId,
      skillId,
      scope,
      tempSkillDir,
      targetSkillDir,
      review
    })

    return review
  }

  async installStoreSkill(args: SkillInstallArgs) {
    const requestId = typeof args.requestId === 'string' ? args.requestId.trim() : ''
    if (!requestId) {
      throw new Error('Invalid install request id.')
    }

    const preparedInstall = this.pendingInstalls.get(requestId)
    if (!preparedInstall) {
      throw new Error('Install request not found or already handled.')
    }

    await fs.mkdir(path.dirname(preparedInstall.targetSkillDir), { recursive: true })
    await fs.rm(preparedInstall.targetSkillDir, { recursive: true, force: true })
    await fs.rename(preparedInstall.tempSkillDir, preparedInstall.targetSkillDir)
    await fs.rm(path.dirname(preparedInstall.tempSkillDir), { recursive: true, force: true })
    this.pendingInstalls.delete(requestId)

    if (preparedInstall.scope === 'public') {
      await this.loadAllSkills()
      return
    }

    if (preparedInstall.scope.startsWith('agent:')) {
      await this.loadAgentSkills(preparedInstall.scope.slice('agent:'.length))
    }
  }

  async discardPreparedInstall(args: SkillInstallArgs) {
    const requestId = typeof args.requestId === 'string' ? args.requestId.trim() : ''
    if (!requestId) {
      throw new Error('Invalid install request id.')
    }

    const preparedInstall = this.pendingInstalls.get(requestId)
    if (!preparedInstall) {
      return
    }

    await fs.rm(path.dirname(preparedInstall.tempSkillDir), { recursive: true, force: true })
    this.pendingInstalls.delete(requestId)
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
    await Promise.all([
      fs.mkdir(this.publicSkillsDir, { recursive: true }),
      fs.mkdir(this.pendingInstallsDir, { recursive: true })
    ])
  }

  private async writeMaterializedSkillToDirectory(targetDir: string, materializedSkill: MaterializedSkill) {
    await fs.mkdir(targetDir, { recursive: true })
    await fs.writeFile(path.join(targetDir, 'SKILL.md'), materializedSkill.skillContent, 'utf-8')

    for (const file of materializedSkill.files) {
      const normalizedPath = normalizeRelativePath(file.path)
      if (!normalizedPath) {
        throw new Error(`Invalid skill resource path: ${file.path}`)
      }

      const resolvedFilePath = path.join(targetDir, normalizedPath)
      await fs.mkdir(path.dirname(resolvedFilePath), { recursive: true })
      if (file.encoding === 'base64') {
        await fs.writeFile(resolvedFilePath, Buffer.from(file.content, 'base64'))
      } else {
        await fs.writeFile(resolvedFilePath, file.content, 'utf-8')
      }
    }
  }

  private async createSkillInstallReview(params: {
    requestId: string
    skill: SkillStoreEntry
    scope: string
    materializedSkill: MaterializedSkill
  }): Promise<SkillInstallReview> {
    const downloadedFiles = params.materializedSkill.files.length + 1
    const downloadedBytes = Buffer.byteLength(params.materializedSkill.skillContent, 'utf-8')
      + params.materializedSkill.files.reduce((sum, file) => sum + getEncodedContentBytes(file), 0)
    const staticFindings = buildStaticReviewFindings(params.skill, params.materializedSkill)
    const skillVetterReport = await this.runSkillVetterAudit(params.skill, params.scope, params.materializedSkill, staticFindings)
    const mergedFindings = [...staticFindings, ...skillVetterReport.findings]
    const recommendation = summarizeRecommendation(mergedFindings)
    const summary = buildReviewSummary(
      recommendation,
      mergedFindings,
      downloadedFiles,
      downloadedBytes,
      skillVetterReport.usedSkillVetter
    )
    const report = buildMarkdownReviewReport({
      skill: params.skill,
      scope: params.scope,
      downloadedFiles,
      downloadedBytes,
      recommendation,
      findings: mergedFindings,
      usedSkillVetter: skillVetterReport.usedSkillVetter,
      llmReport: skillVetterReport.report
    })

    return {
      requestId: params.requestId,
      skillId: params.skill.id,
      skillName: params.skill.name,
      scope: params.scope,
      marketplace: params.skill.marketplace,
      version: params.skill.version,
      author: params.skill.author,
      recommendation,
      summary,
      report,
      findings: mergedFindings,
      downloadedFiles,
      downloadedBytes,
      usedSkillVetter: skillVetterReport.usedSkillVetter
    }
  }

  private resolveInstallScope(scope: string) {
    if (scope === 'public') {
      return { type: 'public' } as const
    }

    if (scope.startsWith('agent:')) {
      const agentId = scope.slice('agent:'.length).trim()
      if (!agentId || !getAgent(agentId)) {
        throw new Error(`Agent scope ${scope} does not exist.`)
      }
      return { type: 'agent', agentId } as const
    }

    throw new Error(`Unsupported install scope: ${scope}`)
  }

  private async collectInstalledSkillScopes() {
    const scopeMap = new Map<string, string[]>()

    await this.loadAllSkills()
    for (const skill of this.publicSkillIndex.values()) {
      scopeMap.set(skill.id, ['public'])
    }

    for (const agent of getAgents()) {
      await this.loadAgentSkills(agent.id)
      for (const skill of this.getAgentIndex(agent.id).values()) {
        const currentScopes = scopeMap.get(skill.id) ?? []
        currentScopes.push(`agent:${agent.id}`)
        scopeMap.set(skill.id, currentScopes)
      }
    }

    return scopeMap
  }

  private getMarketplaceSources(): NormalizedSkillsRegistrySource[] {
    const config = getKairoPilotConfig()
    const configuredSources = config.skills.registry
      .map((entry) => normalizeSkillsRegistryEntry(entry))
      .filter((entry): entry is NormalizedSkillsRegistrySource => entry !== null)

    if (configuredSources.length > 0) {
      return configuredSources
    }

    return DEFAULT_SKILL_MARKETPLACE_SOURCES.map((source) => ({
      ...source
    }))
  }

  private applyInstalledScopes(storeSkills: SkillStoreEntry[], installedScopeMap: Map<string, string[]>) {
    return storeSkills.map((skill) => ({
      ...skill,
      installedScopes: [...(installedScopeMap.get(skill.id) ?? [])]
    }))
  }

  private async fetchMarketplaceSkillsByQuery(query: SkillMarketplaceQuery) {
    if (query.kind === 'curated') {
      return FALLBACK_STORE_SKILLS.map((skill) => ({
        ...skill,
        tags: [...skill.tags],
        installedScopes: []
      }))
    }

    const source = this.getMarketplaceSources().find((candidate) => candidate.url === query.url)
    if (!source) {
      throw new Error(`Marketplace source not found: ${query.url}`)
    }

    const storeSkills = await this.fetchMarketplaceSkillsFromSource(source)
    return storeSkills.sort((left, right) => left.name.localeCompare(right.name))
  }

  private async fetchMarketplaceSkills() {
    const merged = new Map<string, SkillStoreEntry>()

    for (const fallbackSkill of FALLBACK_STORE_SKILLS) {
      merged.set(fallbackSkill.id, {
        ...fallbackSkill,
        tags: [...fallbackSkill.tags],
        installedScopes: []
      })
    }

    for (const source of this.getMarketplaceSources()) {
      try {
        const catalogSkills = await this.fetchMarketplaceSkillsFromSource(source)
        for (const normalizedSkill of catalogSkills) {
          merged.set(normalizedSkill.id, normalizedSkill)
        }
      } catch {
        continue
      }
    }

    return Array.from(merged.values()).sort((left, right) => left.name.localeCompare(right.name))
  }

  private async fetchMarketplaceSkillsFromSource(source: NormalizedSkillsRegistrySource) {
    const catalogPayload = await this.fetchJson(source.url)

    if (source.type === 'claude_marketplace') {
      const normalizedCatalog = normalizeClaudeMarketplaceResponse(catalogPayload)
      const catalogPlugins = Array.isArray(normalizedCatalog.plugins) ? normalizedCatalog.plugins : []
      return catalogPlugins
        .map((candidate) => normalizeClaudeMarketplaceSkill(candidate, source, normalizedCatalog))
        .filter((skill): skill is SkillStoreEntry => skill !== null)
    }

    const normalizedCatalog = normalizeMarketplaceResponse(catalogPayload)
    const catalogSkills = Array.isArray(normalizedCatalog.skills) ? normalizedCatalog.skills : []
    return catalogSkills
      .map((candidate) => normalizeSkillStoreEntry(candidate, normalizedCatalog.name ?? source.name, source.url, source.type))
      .filter((skill): skill is SkillStoreEntry => skill !== null)
  }

  private async materializeStoreSkill(skill: SkillStoreEntry): Promise<MaterializedSkill> {
    switch (skill.source.type) {
      case 'inline':
        return {
          skillContent: skill.source.content,
          files: await this.materializeStoreFiles(skill.source.files ?? [])
        }
      case 'http':
        return {
          skillContent: await this.fetchText(skill.source.skillUrl),
          files: await this.materializeStoreFiles(skill.source.files ?? [])
        }
      case 'github': {
        const githubSource = skill.source
        const skillUrl = this.buildGithubRawUrl(githubSource, 'SKILL.md')
        return {
          skillContent: await this.fetchText(skillUrl),
          files: await this.materializeStoreFiles(
            githubSource.files ?? [],
            (file) => file.url || this.buildGithubRawUrl(githubSource, file.path)
          )
        }
      }
    }
  }

  private async materializeStoreFiles(
    files: SkillStoreResource[],
    resolveUrl?: (file: SkillStoreResource) => string
  ) {
    const materializedFiles: MaterializedSkillFile[] = []

    for (const file of files) {
      const normalizedPath = normalizeRelativePath(file.path)
      if (!normalizedPath) {
        continue
      }

      if (typeof file.content === 'string') {
        materializedFiles.push({
          path: normalizedPath,
          content: file.content,
          encoding: file.encoding === 'base64' ? 'base64' : 'utf-8'
        })
        continue
      }

      const resolvedUrl = typeof file.url === 'string' && file.url.trim()
        ? file.url
        : resolveUrl?.(file)

      if (!resolvedUrl) {
        continue
      }

      materializedFiles.push({
        path: normalizedPath,
        content: await this.fetchRemoteResource(resolvedUrl, file.encoding === 'base64' ? 'base64' : 'utf-8'),
        encoding: file.encoding === 'base64' ? 'base64' : 'utf-8'
      })
    }

    return materializedFiles
  }

  private buildGithubRawUrl(
    source: {
      type: 'github'
      repo: string
      path: string
      ref?: string
      files?: SkillStoreResource[]
    },
    filePath: string
  ) {
    const repo = source.repo.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/i, '').trim()
    const resourcePath = normalizeRelativePath(path.posix.join(trimSlashes(source.path), filePath))
    if (!repo || !resourcePath) {
      throw new Error('Invalid github source configuration.')
    }

    const ref = source.ref?.trim() || 'main'
    return `https://raw.githubusercontent.com/${repo}/${ref}/${resourcePath}`
  }

  private async fetchJson(url: string) {
    const payload = await this.fetchText(url)
    return JSON.parse(payload) as unknown
  }

  private async fetchText(url: string) {
    const normalizedUrl = assertHttpsUrl(url)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    try {
      const response = await fetch(normalizedUrl, { signal: controller.signal })
      if (!response.ok) {
        throw new Error(`Failed to fetch ${normalizedUrl}: ${response.status}`)
      }
      return await response.text()
    } finally {
      clearTimeout(timeout)
    }
  }

  private async fetchRemoteResource(url: string, encoding: 'utf-8' | 'base64') {
    const normalizedUrl = assertHttpsUrl(url)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    try {
      const response = await fetch(normalizedUrl, { signal: controller.signal })
      if (!response.ok) {
        throw new Error(`Failed to fetch ${normalizedUrl}: ${response.status}`)
      }

      if (encoding === 'base64') {
        const buffer = Buffer.from(await response.arrayBuffer())
        return buffer.toString('base64')
      }

      return await response.text()
    } finally {
      clearTimeout(timeout)
    }
  }

  private async runSkillVetterAudit(
    skill: SkillStoreEntry,
    scope: string,
    materializedSkill: MaterializedSkill,
    staticFindings: SkillReviewFinding[]
  ) {
    const activeAgentId = getActiveAgentId()
    const agent = activeAgentId ? getAgent(activeAgentId) : undefined
    const model = agent ? getModelForAgent(agent) : undefined

    if (!model?.model) {
      return {
        usedSkillVetter: false,
        report: '',
        findings: [] as SkillReviewFinding[]
      }
    }

    try {
      const llm = new OpenAIProvider({
        provider: model.provider || 'openai',
        apiKey: model.apiKey,
        baseUrl: model.baseUrl,
        model: model.model
      })
      const response = await llm.chat([
        {
          role: 'system',
          content: [
            '你现在扮演名为 skill-vetter 的技能审核器。',
            '请审查即将安装的技能包，重点关注权限、远程资源、脚本执行、敏感信息和潜在破坏性指令。',
            '输出必须是 JSON，对象结构为 {"summary": string, "findings": Array<{severity:"low"|"medium"|"high", title:string, detail:string, filePath?:string}>}。',
            '如果没有明确风险，findings 返回空数组。不要输出 JSON 之外的任何内容。'
          ].join('\n')
        },
        {
          role: 'user',
          content: JSON.stringify({
            skill: {
              id: skill.id,
              name: skill.name,
              description: skill.description,
              version: skill.version,
              author: skill.author,
              marketplace: skill.marketplace
            },
            scope,
            staticFindings,
            skillFile: materializedSkill.skillContent,
            files: materializedSkill.files.map((file) => ({
              path: file.path,
              encoding: file.encoding,
              content: file.encoding === 'utf-8'
                ? file.content
                : `[base64:${Math.max(1, Math.round(file.content.length * 0.75))} bytes]`
            }))
          })
        }
      ])

      const rawContent = response.content.trim()
      const parsed = JSON.parse(rawContent) as {
        summary?: unknown
        findings?: Array<Record<string, unknown>>
      }
      const findings = Array.isArray(parsed.findings)
        ? parsed.findings
          .map((finding, index) => {
            const severity = finding.severity === 'high' || finding.severity === 'medium' || finding.severity === 'low'
              ? finding.severity
              : 'low'
            if (typeof finding.title !== 'string' || typeof finding.detail !== 'string') {
              return null
            }
            return createFinding(
              `skill-vetter-${index}`,
              severity,
              finding.title.trim(),
              finding.detail.trim(),
              typeof finding.filePath === 'string' && finding.filePath.trim() ? finding.filePath.trim() : undefined
            )
          })
          .filter((finding): finding is SkillReviewFinding => finding !== null)
        : []

      return {
        usedSkillVetter: true,
        report: typeof parsed.summary === 'string' ? parsed.summary : rawContent,
        findings
      }
    } catch {
      return {
        usedSkillVetter: false,
        report: '',
        findings: [] as SkillReviewFinding[]
      }
    }
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
