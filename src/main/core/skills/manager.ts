import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { createLLMProvider } from '../llm/provider'
import { getActiveAgentId, getAgent, getAgents, getKairoPilotConfig, getModelForAgent, saveKairoPilotConfig } from '../../store/config'
import {
  DEFAULT_SKILL_MARKETPLACE_PRESETS,
  SKILL_IMPORT_ERROR,
  SkillImportArgs,
  SkillInstallArgs,
  SkillInstallReview,
  SkillInstallReviewArgs,
  SkillMarketplaceQuery,
  SkillRecord,
  SkillReviewFinding,
  SkillsRegistryEntry,
  SkillStoreEntry
} from '../../../shared/contracts'
import {
  isSkillMarketplaceQuery,
  matchesAllowedToolName,
  normalizeRelativePath,
  normalizeSkillFolderId,
  normalizeSkillsRegistryEntry,
  NormalizedSkillsRegistrySource
} from './skillStoreUtils'
import {
  buildStaticReviewFindings,
  buildSkillInstallReview,
  createFinding,
  MaterializedSkill
} from './skillReviewUtils'
import {
  fetchJson,
  fetchMarketplaceSkillsFromSource,
  fetchRemoteResource,
  fetchText,
  materializeStoreSkill
} from './skillSourceUtils'
import {
  extractImportedSkillArchive,
  importPreparedSkillDirectory,
  resolveImportedSkillDirectory
} from './skillImportUtils'
import {
  findSkillRecord,
  readSkillRecord,
  resolveSkillResourcePath,
  scanSkillsDirectory,
  toSkillSummary
} from './skillIndexUtils'
import { getBuiltinSkillsSourcePath } from '../../services/appRuntime'

interface PreparedSkillInstall {
  requestId: string
  skillId: string
  scope: string
  tempSkillDir: string
  targetSkillDir: string
  review: SkillInstallReview
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
    const mergedPublicSkills = new Map<string, SkillRecord>()
    const builtinSkillsDir = getBuiltinSkillsSourcePath()
    const publicSkillDirectories = [
      this.publicSkillsDir,
      builtinSkillsDir
    ]
      .filter((dirPath): dirPath is string => typeof dirPath === 'string' && dirPath.trim().length > 0)
      .map((dirPath) => path.resolve(dirPath))
      .filter((dirPath, index, directories) => directories.indexOf(dirPath) === index)

    for (const skillsDir of publicSkillDirectories) {
      const publicSkills = await scanSkillsDirectory(skillsDir, 'public')
      for (const skill of publicSkills) {
        mergedPublicSkills.set(skill.id, skill)
      }
    }

    this.publicSkillIndex = mergedPublicSkills
  }

  async loadAgentSkills(agentId: string) {
    await this.ensureSkillsDirectories()
    const agentSkillsDir = this.getAgentSkillsDirectoryPath(agentId)
    const agentSkills = await scanSkillsDirectory(agentSkillsDir, 'agent', { agentId })
    this.agentSkillIndex.set(agentId, new Map(agentSkills.map((skill) => [skill.id, skill])))
  }

  async listPublicSkills() {
    await this.loadAllSkills()
    return Array.from(this.publicSkillIndex.values()).map((skill) => toSkillSummary(skill))
  }

  async listAgentSkills(agentId: string) {
    await this.loadAgentSkills(agentId)
    return Array.from(this.getAgentIndex(agentId).values()).map((skill) => toSkillSummary(skill))
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

    return Array.from(merged.values()).map((skill) => toSkillSummary(skill))
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

    const materializedSkill = await materializeStoreSkill(storeSkill, {
      fetchText,
      fetchRemoteResource
    })
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

  async importSkill(args: SkillImportArgs) {
    const sourceFile = typeof args.sourceFile === 'string' ? args.sourceFile.trim() : ''
    if (!sourceFile) {
      throw new Error(SKILL_IMPORT_ERROR.invalidArchive)
    }

    const scope = typeof args.scope === 'string' && args.scope.trim() ? args.scope.trim() : 'public'
    const target = this.resolveInstallScope(scope)

    await this.ensureSkillsDirectories()
    let resolvedSourceFile = ''
    let sourceStats: Awaited<ReturnType<typeof fs.stat>>
    try {
      resolvedSourceFile = await fs.realpath(sourceFile)
      sourceStats = await fs.stat(resolvedSourceFile)
    } catch {
      throw new Error(SKILL_IMPORT_ERROR.invalidArchivePath)
    }

    if (!sourceStats.isFile()) {
      throw new Error(SKILL_IMPORT_ERROR.invalidArchivePath)
    }

    if (path.extname(resolvedSourceFile).toLowerCase() !== '.zip') {
      throw new Error(SKILL_IMPORT_ERROR.zipRequired)
    }

    const extractionDir = path.join(this.pendingInstallsDir, 'imports', randomUUID())

    try {
      await extractImportedSkillArchive(resolvedSourceFile, extractionDir)
      const resolvedSourceDir = await resolveImportedSkillDirectory(extractionDir)
      const targetBaseDir = target.type === 'public'
        ? this.publicSkillsDir
        : this.getAgentSkillsDirectoryPath(target.agentId)

      await importPreparedSkillDirectory({
        sourceDir: resolvedSourceDir,
        targetBaseDir,
        agentId: target.type === 'agent' ? target.agentId : undefined,
        pathExists: (targetPath) => this.pathExists(targetPath),
        readSkillRecord
      })
    } finally {
      await fs.rm(extractionDir, { recursive: true, force: true })
    }

    if (target.type === 'public') {
      await this.loadAllSkills()
      return
    }

    await this.loadAgentSkills(target.agentId)
  }

  async getMetadata(skillName: string, agentId?: string) {
    const skill = await findSkillRecord({
      skillName,
      agentId,
      loadAllSkills: () => this.loadAllSkills(),
      loadAgentSkills: (resolvedAgentId) => this.loadAgentSkills(resolvedAgentId),
      getPublicSkillIndex: () => this.publicSkillIndex,
      getAgentIndex: (resolvedAgentId) => this.getAgentIndex(resolvedAgentId)
    })
    return skill?.metadata ?? null
  }

  async readSkillContent(skillName: string, agentId?: string) {
    const skill = await findSkillRecord({
      skillName,
      agentId,
      loadAllSkills: () => this.loadAllSkills(),
      loadAgentSkills: (resolvedAgentId) => this.loadAgentSkills(resolvedAgentId),
      getPublicSkillIndex: () => this.publicSkillIndex,
      getAgentIndex: (resolvedAgentId) => this.getAgentIndex(resolvedAgentId)
    })
    return skill?.content ?? null
  }

  async resolveSkillPath(skillName: string, agentId?: string) {
    const skill = await findSkillRecord({
      skillName,
      agentId,
      loadAllSkills: () => this.loadAllSkills(),
      loadAgentSkills: (resolvedAgentId) => this.loadAgentSkills(resolvedAgentId),
      getPublicSkillIndex: () => this.publicSkillIndex,
      getAgentIndex: (resolvedAgentId) => this.getAgentIndex(resolvedAgentId)
    })
    return skill?.skillDir ?? null
  }

  async resolveResourcePath(skillName: string, resourcePath: string, agentId?: string) {
    const skill = await findSkillRecord({
      skillName,
      agentId,
      loadAllSkills: () => this.loadAllSkills(),
      loadAgentSkills: (resolvedAgentId) => this.loadAgentSkills(resolvedAgentId),
      getPublicSkillIndex: () => this.publicSkillIndex,
      getAgentIndex: (resolvedAgentId) => this.getAgentIndex(resolvedAgentId)
    })
    if (!skill) {
      return null
    }

    return resolveSkillResourcePath(skill, resourcePath)
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

    return metadata.metadata.allowedTools.some((allowedToolName) => matchesAllowedToolName(allowedToolName, toolName))
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

  private async pathExists(targetPath: string) {
    try {
      await fs.access(targetPath)
      return true
    } catch {
      return false
    }
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
    const staticFindings = buildStaticReviewFindings(params.skill, params.materializedSkill)
    const skillVetterReport = await this.runSkillVetterAudit(params.skill, params.scope, params.materializedSkill, staticFindings)
    return buildSkillInstallReview({
      requestId: params.requestId,
      skill: params.skill,
      scope: params.scope,
      materializedSkill: params.materializedSkill,
      skillVetterReport
    })
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

    const storeSkills = await fetchMarketplaceSkillsFromSource(source, { fetchJson })
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
        const catalogSkills = await fetchMarketplaceSkillsFromSource(source, { fetchJson })
        for (const normalizedSkill of catalogSkills) {
          merged.set(normalizedSkill.id, normalizedSkill)
        }
      } catch {
        continue
      }
    }

    return Array.from(merged.values()).sort((left, right) => left.name.localeCompare(right.name))
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
      const llm = createLLMProvider({
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

}

export const skillsManager = new SkillsManager()
