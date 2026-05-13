import path from 'path'
import {
  SkillMarketplaceQuery,
  SkillMetadata,
  SkillsRegistryEntry,
  SkillsRegistrySourceType,
  SkillStoreEntry,
  SkillStoreResource,
  SkillStoreSource
} from '../../../shared/contracts'

export interface FrontmatterParseResult {
  metadata: SkillMetadata
  body: string
}

export interface SkillMarketplaceCatalog {
  name?: string
  skills?: unknown
}

export interface ClaudeMarketplaceCatalog {
  name?: string
  homepage?: string
  plugins?: unknown
}

export interface NormalizedSkillsRegistrySource {
  type: SkillsRegistrySourceType
  url: string
  name?: string
}

export interface ParsedGithubRawSource {
  repo: string
  ref: string
  basePath: string
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

const TOOL_NAME_ALIAS_MAP: Record<string, string[]> = {
  read_file: ['Read', 'ReadFile'],
  write_file: ['Write', 'WriteFile'],
  list_directory: ['LS', 'ListDirectory', 'ListDir'],
  delete_file: ['Delete', 'DeleteFile', 'RemoveFile'],
  execute_command: ['RunCommand', 'ExecuteCommand', 'Bash', 'Shell', 'Command'],
  system_info: ['SystemInfo'],
  web_search: ['WebSearch', 'SearchWeb', 'Search'],
  fetch_webpage: ['WebFetch', 'FetchWebpage', 'FetchPage'],
  load_skill: ['Skill', 'LoadSkill'],
  read_skill_resource: ['ReadSkillResource'],
  run_skill_script: ['RunSkillScript'],
  search_codebase: ['SearchCodebase'],
  grep: ['Grep'],
  get_diagnostics: ['GetDiagnostics']
}

const TOOL_NAME_ALIAS_INDEX = new Map<string, string>()

for (const [canonicalName, aliases] of Object.entries(TOOL_NAME_ALIAS_MAP)) {
  TOOL_NAME_ALIAS_INDEX.set(normalizeToolCapabilityName(canonicalName), canonicalName)
  for (const alias of aliases) {
    TOOL_NAME_ALIAS_INDEX.set(normalizeToolCapabilityName(alias), canonicalName)
  }
}

export function normalizeToolCapabilityName(value: string) {
  const normalized = value.trim()
  if (!normalized) {
    return ''
  }
  if (normalized === '*') {
    return '*'
  }
  return normalized.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function resolveCanonicalToolCapabilityName(value: string) {
  const normalized = normalizeToolCapabilityName(value)
  if (!normalized || normalized === '*') {
    return normalized
  }
  return TOOL_NAME_ALIAS_INDEX.get(normalized) ?? normalized
}

export function matchesAllowedToolName(allowedToolName: string, toolName: string) {
  const normalizedAllowedToolName = resolveCanonicalToolCapabilityName(allowedToolName)
  if (!normalizedAllowedToolName) {
    return false
  }
  if (normalizedAllowedToolName === '*') {
    return true
  }
  return normalizedAllowedToolName === resolveCanonicalToolCapabilityName(toolName)
}

export function resolveAllowedToolToRegisteredNames(
  allowedToolName: string,
  registeredToolNames: Iterable<string>
) {
  const matches = new Set<string>()

  for (const registeredToolName of registeredToolNames) {
    if (matchesAllowedToolName(allowedToolName, registeredToolName)) {
      matches.add(registeredToolName)
    }
  }

  return Array.from(matches)
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

export function parseSkillFrontmatter(content: string, folderName: string): FrontmatterParseResult {
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

// ===== Progressive Disclosure: Skill Metadata Validation =====

/**
 * Validation result for a skill's frontmatter metadata.
 * Follows Claude Code's schema constraints:
 * - name: required, max 64 characters
 * - description: required, max 1024 characters, no XML tags
 */
export interface SkillMetadataValidation {
  valid: boolean
  warnings: string[]
  errors: string[]
}

const SKILL_NAME_MAX_LENGTH = 64
const SKILL_DESCRIPTION_MAX_LENGTH = 1024
const XML_TAG_PATTERN = /<\/?[a-zA-Z][^>]*>/

/**
 * Validates skill frontmatter metadata against Claude Code-compatible schema constraints.
 * Returns errors for hard violations (skill should not load) and warnings for soft issues.
 */
export function validateSkillMetadata(metadata: SkillMetadata): SkillMetadataValidation {
  const errors: string[] = []
  const warnings: string[] = []

  // Name validation
  const name = metadata.name.trim()
  if (!name) {
    errors.push('Skill name is required.')
  } else if (name.length > SKILL_NAME_MAX_LENGTH) {
    errors.push(`Skill name exceeds ${SKILL_NAME_MAX_LENGTH} characters (current: ${name.length}). Use a concise gerund form (e.g., "code-reviewing", "pdf-processing").`)
  }

  // Description validation
  const description = metadata.description.trim()
  if (!description || description === `Skill: ${name}`) {
    errors.push('Skill description is required. Write a clear description that tells the agent when to use this skill.')
  } else {
    if (description.length > SKILL_DESCRIPTION_MAX_LENGTH) {
      errors.push(`Skill description exceeds ${SKILL_DESCRIPTION_MAX_LENGTH} characters (current: ${description.length}). Keep it concise — the description is loaded into every system prompt.`)
    }
    if (XML_TAG_PATTERN.test(description)) {
      errors.push('Skill description must not contain XML tags. Use plain text only.')
    }
    // Soft checks
    const hasUsageHint = /use when|when the user|when you|适合|当用户|使用场景/i.test(description)
    if (!hasUsageHint) {
      warnings.push('Description lacks trigger hints. Add "Use when..." or specific scenarios to help the agent know when to activate this skill.')
    }
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors
  }
}

// ===== Progressive Disclosure: Token Estimation =====

/**
 * Estimates the token count of a text string.
 * Uses a heuristic approximation: ~4 English chars or ~1.5 CJK chars per token.
 * This is sufficient for budget management without requiring a full tokenizer dependency.
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0
  // Count CJK characters (Chinese, Japanese, Korean)
  const cjkChars = (text.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g) || []).length
  const nonCjkChars = text.length - cjkChars
  return Math.ceil(nonCjkChars / 4 + cjkChars / 1.5)
}

/**
 * Checks if a SKILL.md body exceeds the recommended token limit.
 * Claude Code enforces < 5000 tokens for the SKILL.md body.
 * Larger skills should split knowledge into references/ files.
 */
export const SKILL_BODY_TOKEN_LIMIT = 5000

export function checkSkillBodySize(body: string): { withinLimit: boolean; estimatedTokens: number; warning?: string } {
  const estimatedTokens = estimateTokenCount(body)
  if (estimatedTokens <= SKILL_BODY_TOKEN_LIMIT) {
    return { withinLimit: true, estimatedTokens }
  }
  return {
    withinLimit: false,
    estimatedTokens,
    warning: `SKILL.md body is ~${estimatedTokens} tokens (limit: ${SKILL_BODY_TOKEN_LIMIT}). Consider moving reference material to the references/ directory and keeping only process steps in SKILL.md.`
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function trimSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, '')
}

export function normalizeRelativePath(value: string) {
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

export function normalizeSkillFolderId(value: string) {
  const normalized = value.trim()
  if (!/^[a-zA-Z0-9._-]+$/.test(normalized)) {
    return null
  }
  return normalized
}

export function normalizeSkillStoreResource(value: unknown) {
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

export function normalizeSkillStoreSource(value: unknown): SkillStoreSource | null {
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

export function normalizeSkillStoreEntry(
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

export function normalizeMarketplaceResponse(value: unknown) {
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

export function normalizeClaudeMarketplaceResponse(value: unknown) {
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

export function normalizeSkillsRegistryEntry(value: SkillsRegistryEntry): NormalizedSkillsRegistrySource | null {
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

export function isSkillMarketplaceQuery(value: unknown): value is SkillMarketplaceQuery {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return false
  }

  if (value.kind === 'curated') {
    return true
  }

  return value.kind === 'registry' && typeof value.url === 'string' && value.url.trim().length > 0
}

export function assertHttpsUrl(url: string) {
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

export function resolveMarketplaceLink(value: unknown) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  if (isRecord(value) && typeof value.url === 'string' && value.url.trim()) {
    return value.url.trim()
  }

  return undefined
}

export function normalizeRelativeMarketplacePath(value: string) {
  return normalizeRelativePath(value.trim().replace(/^\.?\//, ''))
}

export function parseGithubRawSourceUrl(url: string): ParsedGithubRawSource | null {
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

export function createSkillStoreId(value: string) {
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

export function normalizeClaudeMarketplaceSkill(
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
