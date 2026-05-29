import {
  SkillInstallReview,
  SkillReviewFinding,
  SkillStoreEntry
} from '../../../shared/contracts'
import { normalizeToolCapabilityName, parseSkillFrontmatter } from './skillStoreUtils'

export interface MaterializedSkillFile {
  path: string
  content: string
  encoding: 'utf-8' | 'base64'
}

export interface MaterializedSkill {
  skillContent: string
  files: MaterializedSkillFile[]
}

export interface SkillVetterAuditResult {
  usedSkillVetter: boolean
  report: string
  findings: SkillReviewFinding[]
}

export function createFinding(
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

export function summarizeRecommendation(findings: SkillReviewFinding[]) {
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

export function buildStaticReviewFindings(skill: SkillStoreEntry, materializedSkill: MaterializedSkill) {
  const findings: SkillReviewFinding[] = []
  const parsedSkill = parseSkillFrontmatter(materializedSkill.skillContent, skill.id)
  const normalizedAllowedTools = parsedSkill.metadata.allowedTools.map((tool) => normalizeToolCapabilityName(tool))
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

export function buildReviewSummary(
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

export function buildMarkdownReviewReport(params: {
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

export function buildSkillInstallReview(params: {
  requestId: string
  skill: SkillStoreEntry
  scope: string
  materializedSkill: MaterializedSkill
  skillVetterReport: SkillVetterAuditResult
}): SkillInstallReview {
  const downloadedFiles = params.materializedSkill.files.length + 1
  const downloadedBytes = Buffer.byteLength(params.materializedSkill.skillContent, 'utf-8')
    + params.materializedSkill.files.reduce((sum, file) => sum + getEncodedContentBytes(file), 0)
  const staticFindings = buildStaticReviewFindings(params.skill, params.materializedSkill)
  const mergedFindings = [...staticFindings, ...params.skillVetterReport.findings]
  const recommendation = summarizeRecommendation(mergedFindings)
  const summary = buildReviewSummary(
    recommendation,
    mergedFindings,
    downloadedFiles,
    downloadedBytes,
    params.skillVetterReport.usedSkillVetter
  )
  const report = buildMarkdownReviewReport({
    skill: params.skill,
    scope: params.scope,
    downloadedFiles,
    downloadedBytes,
    recommendation,
    findings: mergedFindings,
    usedSkillVetter: params.skillVetterReport.usedSkillVetter,
    llmReport: params.skillVetterReport.report
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
    usedSkillVetter: params.skillVetterReport.usedSkillVetter
  }
}
