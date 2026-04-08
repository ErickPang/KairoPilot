import path from 'path'
import {
  SkillStoreEntry,
  SkillStoreResource
} from '../../../shared/contracts'
import {
  assertHttpsUrl,
  normalizeClaudeMarketplaceResponse,
  normalizeClaudeMarketplaceSkill,
  normalizeMarketplaceResponse,
  normalizeRelativePath,
  normalizeSkillStoreEntry,
  NormalizedSkillsRegistrySource,
  trimSlashes
} from './skillStoreUtils'
import {
  MaterializedSkill,
  MaterializedSkillFile
} from './skillReviewUtils'

export async function fetchText(url: string) {
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

export async function fetchJson(url: string) {
  const payload = await fetchText(url)
  return JSON.parse(payload) as unknown
}

export async function fetchRemoteResource(url: string, encoding: 'utf-8' | 'base64') {
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

export function buildGithubRawUrl(
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

export async function materializeStoreFiles(
  files: SkillStoreResource[],
  params: {
    fetchRemoteResource: typeof fetchRemoteResource
    resolveUrl?: (file: SkillStoreResource) => string | undefined
  }
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
      : params.resolveUrl?.(file)

    if (!resolvedUrl) {
      continue
    }

    const encoding = file.encoding === 'base64' ? 'base64' : 'utf-8'
    materializedFiles.push({
      path: normalizedPath,
      content: await params.fetchRemoteResource(resolvedUrl, encoding),
      encoding
    })
  }

  return materializedFiles
}

export async function materializeStoreSkill(
  skill: SkillStoreEntry,
  params: {
    fetchText: typeof fetchText
    fetchRemoteResource: typeof fetchRemoteResource
  }
): Promise<MaterializedSkill> {
  switch (skill.source.type) {
    case 'inline':
      return {
        skillContent: skill.source.content,
        files: await materializeStoreFiles(skill.source.files ?? [], {
          fetchRemoteResource: params.fetchRemoteResource
        })
      }
    case 'http':
      return {
        skillContent: await params.fetchText(skill.source.skillUrl),
        files: await materializeStoreFiles(skill.source.files ?? [], {
          fetchRemoteResource: params.fetchRemoteResource
        })
      }
    case 'github': {
      const githubSource = skill.source
      const skillUrl = buildGithubRawUrl(githubSource, 'SKILL.md')
      return {
        skillContent: await params.fetchText(skillUrl),
        files: await materializeStoreFiles(githubSource.files ?? [], {
          fetchRemoteResource: params.fetchRemoteResource,
          resolveUrl: (file) => file.url || buildGithubRawUrl(githubSource, file.path)
        })
      }
    }
  }
}

export function normalizeMarketplaceSkills(
  source: NormalizedSkillsRegistrySource,
  catalogPayload: unknown
) {
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

export async function fetchMarketplaceSkillsFromSource(
  source: NormalizedSkillsRegistrySource,
  params: {
    fetchJson: typeof fetchJson
  }
) {
  const catalogPayload = await params.fetchJson(source.url)
  return normalizeMarketplaceSkills(source, catalogPayload)
}
