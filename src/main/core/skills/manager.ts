import { app } from 'electron'
import { existsSync, readFileSync, realpathSync, watch, type FSWatcher } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import { createHash, randomUUID } from 'crypto'
import { createLLMProvider } from '../llm/provider'
import { getAgent, getAgents, getModelForAgent, readKairoPilotConfig, saveKairoPilotConfig } from '../../store/config'
import {
  DEFAULT_SKILL_MARKETPLACE_PRESETS,
  SKILL_IMPORT_ERROR,
  ModelConfig,
  SkillImportArgs,
  SkillInstallArgs,
  SkillInstallReview,
  SkillInstallReviewArgs,
  SkillMarketplaceQuery,
  SkillUninstallArgs,
  SkillRollbackArgs,
  SkillSummary,
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
  existingSkill?: SkillRecord
}

interface SkillRollbackMetadata {
  version?: string
  contentHash?: string
  backupDir: string
  backedUpAt: number
}

const SKILL_ROLLBACK_FILE = '_kairopilot_rollback.json'

export interface SkillCatalogEntrySnapshot {
  id: string
  summary: string
}

export interface SkillCatalogSnapshot {
  fingerprint: string
  fullSummary: string
  entries: SkillCatalogEntrySnapshot[]
}

const AVAILABLE_SKILLS_MAX_CHARS = 3600
const AVAILABLE_SKILL_ENTRY_MAX_CHARS = 180

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

function trimSkillCatalogText(value: string, maxChars: number) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) {
    return normalized
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
}

function deriveSkillInvocationMode(skill: Pick<SkillSummary, 'userInvocable' | 'modelInvocable'>) {
  if (skill.modelInvocable === false) {
    return skill.userInvocable === false ? 'hidden' : 'manual_only'
  }
  return skill.userInvocable === false ? 'hidden_auto' : 'auto'
}

function cloneSkillCatalogSnapshot(snapshot: SkillCatalogSnapshot): SkillCatalogSnapshot {
  return {
    fingerprint: snapshot.fingerprint,
    fullSummary: snapshot.fullSummary,
    entries: snapshot.entries.map((entry) => ({ ...entry }))
  }
}

export class SkillsManager {
  private publicSkillsDir: string
  private publicSkillIndex = new Map<string, SkillRecord>()
  private agentSkillIndex = new Map<string, Map<string, SkillRecord>>()
  private pendingInstalls = new Map<string, PreparedSkillInstall>()
  private pendingInstallsDir: string
  private publicSkillsLoaded = false
  private publicSkillsLoadPromise: Promise<void> | null = null
  private publicSkillsRevision = 0
  private agentSkillLoaded = new Map<string, boolean>()
  private agentSkillLoadPromises = new Map<string, Promise<void>>()
  private agentSkillRevisions = new Map<string, number>()
  private skillCatalogCache = new Map<string, SkillCatalogSnapshot>()
  private skillFileIndex = new Map<string, string[]>()
  private directoryWatchers = new Map<string, FSWatcher>()

  constructor() {
    this.publicSkillsDir = path.join(app.getPath('home'), '.kairopilot', 'skills')
    this.pendingInstallsDir = path.join(app.getPath('userData'), 'pending-skill-installs')
  }

  async initialize() {
    await this.ensureSkillsDirectories()
    this.ensurePublicSkillWatchers()
    await this.loadAllSkills()
  }

  dispose() {
    for (const watcher of this.directoryWatchers.values()) {
      watcher.close()
    }
    this.directoryWatchers.clear()
  }

  async loadAllSkills(options?: { force?: boolean }) {
    this.ensurePublicSkillWatchers()
    if (!options?.force && this.publicSkillsLoaded) {
      return
    }
    if (!options?.force && this.publicSkillsLoadPromise) {
      await this.publicSkillsLoadPromise
      return
    }

    const loadPromise = (async () => {
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
      this.publicSkillsLoaded = true
    })()

    this.publicSkillsLoadPromise = loadPromise
    try {
      await loadPromise
    } finally {
      if (this.publicSkillsLoadPromise === loadPromise) {
        this.publicSkillsLoadPromise = null
      }
    }
  }

  async loadAgentSkills(agentId: string, options?: { force?: boolean }) {
    if (!options?.force && this.agentSkillLoaded.get(agentId)) {
      return
    }

    const existingPromise = this.agentSkillLoadPromises.get(agentId)
    if (!options?.force && existingPromise) {
      await existingPromise
      return
    }

    const loadPromise = (async () => {
      await this.ensureSkillsDirectories()
      const agentSkillsDir = this.getAgentSkillsDirectoryPath(agentId)
      await fs.mkdir(agentSkillsDir, { recursive: true })
      this.ensureAgentSkillWatcher(agentId)
      const agentSkills = await scanSkillsDirectory(agentSkillsDir, 'agent', { agentId })
      this.agentSkillIndex.set(agentId, new Map(agentSkills.map((skill) => [skill.id, skill])))
      this.agentSkillLoaded.set(agentId, true)
    })()

    this.agentSkillLoadPromises.set(agentId, loadPromise)
    try {
      await loadPromise
    } finally {
      if (this.agentSkillLoadPromises.get(agentId) === loadPromise) {
        this.agentSkillLoadPromises.delete(agentId)
      }
    }
  }

  async listPublicSkills(options?: { force?: boolean }) {
    await this.loadAllSkills(options)
    return Array.from(this.publicSkillIndex.values()).map((skill) => this.toManagedSkillSummary(skill))
  }

  async listAgentSkills(agentId: string, options?: { force?: boolean }) {
    await this.loadAgentSkills(agentId, options)
    return Array.from(this.getAgentIndex(agentId).values()).map((skill) => this.toManagedSkillSummary(skill))
  }

  async listMergedSkills(agentId: string, options?: { force?: boolean }) {
    await this.loadAllSkills(options)
    await this.loadAgentSkills(agentId, options)

    const merged = new Map<string, SkillRecord>()
    for (const skill of this.publicSkillIndex.values()) {
      merged.set(skill.id, skill)
    }
    for (const skill of this.getAgentIndex(agentId).values()) {
      merged.set(skill.id, skill)
    }

    return Array.from(merged.values()).map((skill) => this.toManagedSkillSummary(skill))
  }

  async getSkillCatalogSnapshot(agentId: string, options?: { force?: boolean }) {
    if (!options?.force) {
      const cachedSnapshot = this.skillCatalogCache.get(agentId)
      if (cachedSnapshot) {
        return cloneSkillCatalogSnapshot(cachedSnapshot)
      }
    }

    const skills = await this.listMergedSkills(agentId, options)
    const snapshot = this.buildSkillCatalogSnapshot(skills)
    this.skillCatalogCache.set(agentId, snapshot)
    return cloneSkillCatalogSnapshot(snapshot)
  }

  getSkillScopeRevision(agentId: string) {
    return `${this.publicSkillsRevision}:${this.agentSkillRevisions.get(agentId) ?? 0}`
  }

  async getStoreSkills(query?: SkillMarketplaceQuery) {
    const installedScopeMap = await this.collectInstalledSkillScopes()
    const storeSkills = query
      ? await this.fetchMarketplaceSkillsByQuery(query)
      : await this.fetchMarketplaceSkills()
    return this.applyInstalledScopes(storeSkills, installedScopeMap)
  }

  async getRegistrySources() {
    const config = readKairoPilotConfig()
    return [...config.skills.registry]
  }

  async saveRegistrySources(entries: SkillsRegistryEntry[]) {
    const config = readKairoPilotConfig()
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
    const existingSkill = await readSkillRecord(
      targetSkillDir,
      target.type === 'agent' ? 'agent' : 'public',
      skillId,
      target.type === 'agent' ? target.agentId : undefined
    )
    const requestId = randomUUID()
    const tempSkillDir = path.join(this.pendingInstallsDir, requestId, skillId)

    await fs.rm(tempSkillDir, { recursive: true, force: true })
    await this.writeMaterializedSkillToDirectory(tempSkillDir, materializedSkill)

    const review = await this.createSkillInstallReview({
      requestId,
      skill: storeSkill,
      scope,
      materializedSkill,
      existingSkill
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
      review,
      existingSkill: existingSkill ?? undefined
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
    let rollbackMetadata: SkillRollbackMetadata | null = null
    if (preparedInstall.existingSkill) {
      const backupDir = path.join(this.pendingInstallsDir, 'skill-backups', `${preparedInstall.skillId}-${Date.now()}`)
      await fs.mkdir(path.dirname(backupDir), { recursive: true })
      await fs.cp(preparedInstall.existingSkill.skillDir, backupDir, { recursive: true })
      rollbackMetadata = {
        version: preparedInstall.existingSkill.metadata.version,
        contentHash: preparedInstall.existingSkill.contentHash,
        backupDir,
        backedUpAt: Date.now()
      }
    }
    await fs.rm(preparedInstall.targetSkillDir, { recursive: true, force: true })
    await fs.rename(preparedInstall.tempSkillDir, preparedInstall.targetSkillDir)
    if (rollbackMetadata) {
      await fs.writeFile(path.join(preparedInstall.targetSkillDir, SKILL_ROLLBACK_FILE), JSON.stringify(rollbackMetadata, null, 2), 'utf-8')
    }
    await fs.rm(path.dirname(preparedInstall.tempSkillDir), { recursive: true, force: true })
    this.pendingInstalls.delete(requestId)

    if (preparedInstall.scope === 'public') {
      this.invalidatePublicSkills()
      await this.loadAllSkills({ force: true })
      return
    }

    if (preparedInstall.scope.startsWith('agent:')) {
      const agentId = preparedInstall.scope.slice('agent:'.length)
      this.invalidateAgentSkills(agentId)
      await this.loadAgentSkills(agentId, { force: true })
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
      this.invalidatePublicSkills()
      await this.loadAllSkills({ force: true })
      return
    }

    this.invalidateAgentSkills(target.agentId)
    await this.loadAgentSkills(target.agentId, { force: true })
  }

  async uninstallSkill(args: SkillUninstallArgs) {
    const skillId = normalizeSkillFolderId(args.id)
    if (!skillId) {
      throw new Error('Invalid skill id.')
    }

    const scope = typeof args.scope === 'string' && args.scope.trim() ? args.scope.trim() : 'public'
    if (scope === 'public') {
      await this.loadAllSkills()
      const skill = this.publicSkillIndex.get(skillId)
      if (!skill) {
        throw new Error(`Skill ${skillId} not found in public scope.`)
      }
      if (!this.isSkillRecordRemovable(skill)) {
        throw new Error('Built-in skills cannot be removed.')
      }
      await fs.rm(skill.skillDir, { recursive: true, force: true })
      this.invalidatePublicSkills()
      await this.loadAllSkills({ force: true })
      return
    }

    if (scope.startsWith('agent:')) {
      const agentId = scope.slice('agent:'.length).trim()
      if (!agentId) {
        throw new Error(`Unsupported uninstall scope: ${scope}`)
      }
      await this.loadAgentSkills(agentId)
      const skill = this.getAgentIndex(agentId).get(skillId)
      if (!skill) {
        throw new Error(`Skill ${skillId} not found in scope ${scope}.`)
      }
      if (!this.isSkillRecordRemovable(skill)) {
        throw new Error('Built-in skills cannot be removed.')
      }
      await fs.rm(skill.skillDir, { recursive: true, force: true })
      this.invalidateAgentSkills(agentId)
      await this.loadAgentSkills(agentId, { force: true })
      return
    }

    throw new Error(`Unsupported uninstall scope: ${scope}`)
  }

  async rollbackSkill(args: SkillRollbackArgs) {
    const skillId = normalizeSkillFolderId(args.id)
    if (!skillId) {
      throw new Error('Invalid skill id.')
    }
    const scope = typeof args.scope === 'string' && args.scope.trim() ? args.scope.trim() : 'public'
    const target = this.resolveInstallScope(scope)
    const targetBaseDir = target.type === 'public'
      ? this.publicSkillsDir
      : this.getAgentSkillsDirectoryPath(target.agentId)
    const targetSkillDir = path.join(targetBaseDir, skillId)
    const rollbackMetadata = this.readSkillRollbackMetadata(targetSkillDir)
    if (!rollbackMetadata) {
      throw new Error(`Skill ${skillId} has no rollback snapshot.`)
    }
    await fs.rm(targetSkillDir, { recursive: true, force: true })
    await fs.cp(rollbackMetadata.backupDir, targetSkillDir, { recursive: true })
    await fs.rm(path.join(targetSkillDir, SKILL_ROLLBACK_FILE), { force: true })
    if (target.type === 'public') {
      this.invalidatePublicSkills()
      await this.loadAllSkills({ force: true })
      return
    }
    this.invalidateAgentSkills(target.agentId)
    await this.loadAgentSkills(target.agentId, { force: true })
  }

  async getSkillRecord(skillName: string, agentId?: string) {
    return this.findSkill(skillName, agentId)
  }

  async getMetadata(skillName: string, agentId?: string) {
    const skill = await this.findSkill(skillName, agentId)
    return skill?.metadata ?? null
  }

  async readSkillContent(skillName: string, agentId?: string) {
    const skill = await this.findSkill(skillName, agentId)
    return skill?.content ?? null
  }

  async resolveSkillPath(skillName: string, agentId?: string) {
    const skill = await this.findSkill(skillName, agentId)
    return skill?.skillDir ?? null
  }

  async resolveResourcePath(skillName: string, resourcePath: string, agentId?: string) {
    const skill = await this.findSkill(skillName, agentId)
    if (!skill) {
      return null
    }

    return resolveSkillResourcePath(skill, resourcePath)
  }

  async listSkillFiles(skillName: string, agentId?: string) {
    const skill = await this.findSkill(skillName, agentId)
    if (!skill) {
      return []
    }

    const filePaths = await this.collectSkillFiles(skill.skillDir)
    return filePaths.sort((left, right) => left.localeCompare(right))
  }

  async listSkillFilesForRecord(skill: SkillRecord) {
    const cacheKey = skill.skillDir
    const cachedFilePaths = this.skillFileIndex.get(cacheKey)
    if (cachedFilePaths) {
      return [...cachedFilePaths]
    }

    const filePaths = await this.collectSkillFiles(skill.skillDir)
    this.skillFileIndex.set(cacheKey, [...filePaths])
    return filePaths.sort((left, right) => left.localeCompare(right))
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

    return metadata.allowedTools.some((allowedToolName) => matchesAllowedToolName(allowedToolName, toolName))
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

  private async findSkill(skillName: string, agentId?: string) {
    return findSkillRecord({
      skillName,
      agentId,
      loadAllSkills: () => this.loadAllSkills(),
      loadAgentSkills: (resolvedAgentId) => this.loadAgentSkills(resolvedAgentId),
      getPublicSkillIndex: () => this.publicSkillIndex,
      getAgentIndex: (resolvedAgentId) => this.getAgentIndex(resolvedAgentId)
    })
  }

  private invalidatePublicSkills() {
    this.publicSkillsLoaded = false
    this.publicSkillsLoadPromise = null
    this.publicSkillsRevision += 1
    this.publicSkillIndex.clear()
    this.skillFileIndex.clear()
    this.skillCatalogCache.clear()
  }

  private invalidateAgentSkills(agentId: string) {
    this.agentSkillLoaded.delete(agentId)
    this.agentSkillLoadPromises.delete(agentId)
    this.agentSkillRevisions.set(agentId, (this.agentSkillRevisions.get(agentId) ?? 0) + 1)
    this.agentSkillIndex.delete(agentId)
    this.skillFileIndex.clear()
    this.skillCatalogCache.delete(agentId)
  }

  private toManagedSkillSummary(skill: SkillRecord): SkillSummary {
    const rollbackMetadata = this.readSkillRollbackMetadata(skill.skillDir)
    return {
      ...toSkillSummary(skill),
      removable: this.isSkillRecordRemovable(skill),
      rollbackAvailable: Boolean(rollbackMetadata),
      previousVersion: rollbackMetadata?.version
    }
  }

  private readSkillRollbackMetadata(skillDir: string): SkillRollbackMetadata | null {
    const metadataPath = path.join(skillDir, SKILL_ROLLBACK_FILE)
    if (!existsSync(metadataPath)) {
      return null
    }
    try {
      const payload = JSON.parse(readFileSync(metadataPath, 'utf-8')) as Partial<SkillRollbackMetadata>
      if (typeof payload.backupDir === 'string' && payload.backupDir.trim()) {
        return {
          backupDir: payload.backupDir,
          version: typeof payload.version === 'string' ? payload.version : undefined,
          contentHash: typeof payload.contentHash === 'string' ? payload.contentHash : undefined,
          backedUpAt: typeof payload.backedUpAt === 'number' ? payload.backedUpAt : 0
        }
      }
    } catch {
      return null
    }
    return null
  }

  private isSkillRecordRemovable(skill: SkillRecord) {
    const normalizeManagedPath = (targetPath: string) => {
      try {
        return realpathSync(targetPath)
      } catch {
        return path.resolve(targetPath)
      }
    }

    const skillDir = normalizeManagedPath(skill.skillDir)
    if (skill.scope === 'agent') {
      const agentSkillsDir = skill.agentId
        ? normalizeManagedPath(this.getAgentSkillsDirectoryPath(skill.agentId))
        : ''
      return Boolean(agentSkillsDir) && (skillDir === agentSkillsDir || skillDir.startsWith(`${agentSkillsDir}${path.sep}`))
    }

    const publicSkillsDir = normalizeManagedPath(this.publicSkillsDir)
    return skillDir === publicSkillsDir || skillDir.startsWith(`${publicSkillsDir}${path.sep}`)
  }

  private ensurePublicSkillWatchers() {
    const builtinSkillsDir = getBuiltinSkillsSourcePath()
    const publicSkillDirectories = [
      this.publicSkillsDir,
      builtinSkillsDir
    ]
      .filter((dirPath): dirPath is string => typeof dirPath === 'string' && dirPath.trim().length > 0)
      .map((dirPath) => path.resolve(dirPath))
      .filter((dirPath, index, directories) => directories.indexOf(dirPath) === index)

    for (const skillsDir of publicSkillDirectories) {
      this.ensureDirectoryWatcher(skillsDir, () => this.invalidatePublicSkills())
    }
  }

  private ensureAgentSkillWatcher(agentId: string) {
    const skillsDir = path.resolve(this.getAgentSkillsDirectoryPath(agentId))
    this.ensureDirectoryWatcher(skillsDir, () => this.invalidateAgentSkills(agentId))
  }

  private ensureDirectoryWatcher(targetPath: string, onInvalidate: () => void) {
    if (!targetPath || this.directoryWatchers.has(targetPath)) {
      return
    }

    try {
      const watcher = watch(targetPath, { recursive: true }, () => {
        onInvalidate()
      })
      watcher.on('error', () => {
        watcher.close()
        this.directoryWatchers.delete(targetPath)
      })
      this.directoryWatchers.set(targetPath, watcher)
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code ?? '') : ''
      if (code === 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM' || code === 'ERR_INVALID_ARG_VALUE') {
        try {
          const watcher = watch(targetPath, () => {
            onInvalidate()
          })
          watcher.on('error', () => {
            watcher.close()
            this.directoryWatchers.delete(targetPath)
          })
          this.directoryWatchers.set(targetPath, watcher)
        } catch {
          return
        }
      }
    }
  }

  private buildSkillCatalogSnapshot(skills: SkillSummary[]): SkillCatalogSnapshot {
    if (skills.length === 0) {
      return {
        fingerprint: 'empty',
        fullSummary: 'No skills available.',
        entries: []
      }
    }

    const prioritizedSkills = skills
      .slice()
      .sort((left, right) => {
        if (left.source !== right.source) {
          return left.source === 'agent' ? -1 : 1
        }
        return left.id.localeCompare(right.id)
      })

    const entryRecords = prioritizedSkills.map((skill) => {
      const summaryText = `${skill.description} ${skill.whenToUse}`.replace(/\s+/g, ' ').trim()
      const trimmedDescription = summaryText.length > AVAILABLE_SKILL_ENTRY_MAX_CHARS
        ? `${summaryText.slice(0, AVAILABLE_SKILL_ENTRY_MAX_CHARS - 1).trimEnd()}…`
        : summaryText
      const versionText = skill.version ? ` | version: ${skill.version}` : ''
      const sourceText = ` | scope: ${skill.source}`
      const invocationText = ` | invocation: ${deriveSkillInvocationMode(skill)}`
      return {
        id: skill.id,
        summary: `- ${skill.id}: ${trimmedDescription}${versionText}${sourceText}${invocationText}`
      }
    })

    const entries: string[] = []
    for (const record of entryRecords) {
      const entry = record.summary
      const nextEntries = [...entries, entry]
      const remainingCount = entryRecords.length - nextEntries.length
      const suffix = remainingCount > 0 ? `\n- ${remainingCount} more skills omitted from this summary.` : ''
      const candidate = `${nextEntries.join('\n')}${suffix}`
      if (candidate.length > AVAILABLE_SKILLS_MAX_CHARS) {
        if (entries.length === 0) {
          return {
            fingerprint: JSON.stringify(entryRecords.map((entryRecord) => entryRecord.summary)),
            fullSummary: trimSkillCatalogText(entry, AVAILABLE_SKILLS_MAX_CHARS),
            entries: entryRecords
          }
        }
        break
      }
      entries.push(entry)
    }

    const omittedCount = entryRecords.length - entries.length
    return {
      fingerprint: JSON.stringify(entryRecords.map((entryRecord) => entryRecord.summary)),
      fullSummary: omittedCount > 0
        ? `${entries.join('\n')}\n- ${omittedCount} more skills omitted from this summary.`
        : entries.join('\n'),
      entries: entryRecords
    }
  }

  private async collectSkillFiles(skillDir: string, relativeSegments: string[] = []): Promise<string[]> {
    const currentDir = relativeSegments.length > 0
      ? path.join(skillDir, ...relativeSegments)
      : skillDir
    const files: string[] = []

    let entryNames: string[]
    try {
      entryNames = await fs.readdir(currentDir, { encoding: 'utf-8' })
    } catch {
      return files
    }

    for (const entryName of entryNames) {
      if (entryName.startsWith('.')) {
        continue
      }

      const nextSegments = [...relativeSegments, entryName]
      let stats: Awaited<ReturnType<typeof fs.stat>>
      try {
        stats = await fs.stat(path.join(currentDir, entryName))
      } catch {
        continue
      }

      if (stats.isDirectory()) {
        files.push(...await this.collectSkillFiles(skillDir, nextSegments))
        continue
      }

      if (entryName === 'SKILL.md' || entryName === '_meta.json') {
        continue
      }

      files.push(nextSegments.join('/'))
    }

    return files
  }

  private async createSkillInstallReview(params: {
    requestId: string
    skill: SkillStoreEntry
    scope: string
    materializedSkill: MaterializedSkill
    existingSkill?: SkillRecord | null
  }): Promise<SkillInstallReview> {
    const staticFindings = buildStaticReviewFindings(params.skill, params.materializedSkill)
    const skillVetterReport = await this.runSkillVetterAudit(params.skill, params.scope, params.materializedSkill, staticFindings)
    const review = buildSkillInstallReview({
      requestId: params.requestId,
      skill: params.skill,
      scope: params.scope,
      materializedSkill: params.materializedSkill,
      skillVetterReport
    })
    if (params.existingSkill) {
      review.versionDiff = {
        fromVersion: params.existingSkill.metadata.version,
        toVersion: review.version,
        fromHash: params.existingSkill.contentHash,
        toHash: params.materializedSkill.skillContent
          ? createHash('sha256').update(params.materializedSkill.skillContent).digest('hex')
          : undefined
      }
    }
    return review
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
    const config = readKairoPilotConfig()
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
    const model = this.resolveSkillReviewModel(scope)

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

  private resolveSkillReviewModel(scope: string): ModelConfig | undefined {
    const candidateAgents = new Map<string, ReturnType<typeof getAgent>>()
    const registerCandidate = (agentId: string | undefined) => {
      if (!agentId || candidateAgents.has(agentId)) {
        return
      }
      candidateAgents.set(agentId, getAgent(agentId))
    }

    if (scope.startsWith('agent:')) {
      registerCandidate(scope.slice('agent:'.length).trim())
    }

    registerCandidate('mainAgent')

    for (const agent of getAgents()) {
      registerCandidate(agent.id)
    }

    for (const agent of candidateAgents.values()) {
      if (!agent) {
        continue
      }
      const model = getModelForAgent(agent)
      if (model?.model) {
        return model
      }
    }

    return undefined
  }

  private getAgentIndex(agentId: string) {
    return this.agentSkillIndex.get(agentId) ?? new Map<string, SkillRecord>()
  }

}

export const skillsManager = new SkillsManager()
