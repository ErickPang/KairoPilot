import { describe, expect, it } from 'vitest'
import {
  assertHttpsUrl,
  matchesAllowedToolName,
  normalizeClaudeMarketplaceResponse,
  normalizeClaudeMarketplaceSkill,
  normalizeMarketplaceResponse,
  normalizeSkillStoreEntry,
  normalizeSkillsRegistryEntry,
  parseSkillFrontmatter,
  resolveAllowedToolToRegisteredNames
} from './skillStoreUtils'

describe('skillStoreUtils', () => {
  it('解析 frontmatter 中的多行描述与 allowed-tools 列表', () => {
    const result = parseSkillFrontmatter(`---
name: review-helper
description: |
  第一行描述
  第二行描述
metadata:
  version: "1.2.3"
  allowed-tools:
    - Read
    - SearchCodebase
---

# Skill Body

正文内容`, 'fallback-name')

    expect(result.metadata).toEqual({
      name: 'review-helper',
      description: '第一行描述\n第二行描述',
      version: '1.2.3',
      allowedTools: ['Read', 'SearchCodebase'],
      whenToUse: '第一行描述\n第二行描述',
      arguments: [],
      userInvocable: true,
      modelInvocable: true,
      executionMode: 'inline'
    })
    expect(result.body).toBe('# Skill Body\n\n正文内容')
  })

  it('解析 Agent Skills 扩展字段与 arguments 列表', () => {
    const result = parseSkillFrontmatter(`---
name: release-review
description: Review release readiness
version: "2.0.0"
allowed-tools: [Read, RunCommand]
when_to_use: |
  当用户要做发布检查时使用
user-invocable: true
disable-model-invocation: true
context: fork
arguments:
  - name: release_scope
    description: |
      本次发布范围
    required: true
  - name: environment
    description: target environment
    default: staging
---

# Release Review`, 'fallback-name')

    expect(result.metadata).toEqual({
      name: 'release-review',
      description: 'Review release readiness',
      version: '2.0.0',
      allowedTools: ['Read', 'RunCommand'],
      whenToUse: '当用户要做发布检查时使用',
      arguments: [
        {
          name: 'release_scope',
          description: '本次发布范围',
          required: true,
          defaultValue: undefined
        },
        {
          name: 'environment',
          description: 'target environment',
          required: false,
          defaultValue: 'staging'
        }
      ],
      userInvocable: true,
      modelInvocable: false,
      executionMode: 'fork'
    })
  })

  it('规范化 manifest 技能条目并过滤非法资源路径', () => {
    const result = normalizeSkillStoreEntry({
      id: 'demo_skill',
      name: ' Demo Skill ',
      description: ' Demo description ',
      tags: ['tools', ' review '],
      source: {
        type: 'inline',
        content: 'demo',
        files: [
          { path: 'docs/guide.md', content: 'guide' },
          { path: '../secret.txt', content: 'bad' }
        ]
      }
    }, 'Curated', 'https://example.com/store.json', 'manifest')

    expect(result).toEqual({
      id: 'demo_skill',
      name: 'Demo Skill',
      description: 'Demo description',
      version: undefined,
      author: undefined,
      icon: undefined,
      tags: ['tools', 'review'],
      homepage: undefined,
      marketplace: 'Curated',
      registryUrl: 'https://example.com/store.json',
      sourceType: 'manifest',
      source: {
        type: 'inline',
        content: 'demo',
        files: [
          { path: 'docs/guide.md', encoding: 'utf-8', content: 'guide' }
        ]
      },
      installedScopes: []
    })
  })

  it('支持将 allowed-tools 别名映射到内部工具名', () => {
    expect(matchesAllowedToolName('RunCommand', 'execute_command')).toBe(true)
    expect(matchesAllowedToolName('Read', 'read_file')).toBe(true)
    expect(matchesAllowedToolName('LS', 'list_directory')).toBe(true)
    expect(matchesAllowedToolName('WebFetch', 'fetch_webpage')).toBe(true)
    expect(matchesAllowedToolName('RunCommand', 'web_search')).toBe(false)
  })

  it('能将技能声明的工具名解析为已注册工具名列表', () => {
    expect(resolveAllowedToolToRegisteredNames('RunCommand', [
      'read_file',
      'execute_command',
      'web_search'
    ])).toEqual(['execute_command'])

    expect(resolveAllowedToolToRegisteredNames('*', [
      'read_file',
      'execute_command'
    ])).toEqual(['read_file', 'execute_command'])
  })

  it('将 Claude marketplace 插件映射为 github 技能源', () => {
    const catalog = normalizeClaudeMarketplaceResponse({
      name: 'Claude Hub',
      homepage: { url: 'https://claude.example.com' }
    })
    const source = normalizeSkillsRegistryEntry({
      type: 'claude_marketplace',
      url: 'https://raw.githubusercontent.com/demo-org/demo-repo/main/registry/claude.json',
      name: 'Claude Hub'
    })

    expect(source).not.toBeNull()

    const result = normalizeClaudeMarketplaceSkill({
      name: 'Planning Assistant',
      source: './skills/planning-assistant',
      category: 'planning',
      keywords: ['team', 'workflow'],
      repository: { url: 'https://github.com/demo-org/demo-repo' }
    }, source!, catalog)

    expect(result).toEqual({
      id: 'planning-assistant',
      name: 'Planning Assistant',
      description: 'Skill: planning-assistant',
      version: undefined,
      author: undefined,
      icon: undefined,
      tags: ['planning', 'team', 'workflow'],
      homepage: 'https://github.com/demo-org/demo-repo',
      marketplace: 'Claude Hub',
      registryUrl: 'https://raw.githubusercontent.com/demo-org/demo-repo/main/registry/claude.json',
      sourceType: 'claude_marketplace',
      source: {
        type: 'github',
        repo: 'demo-org/demo-repo',
        ref: 'main',
        path: 'registry/skills/planning-assistant'
      },
      installedScopes: []
    })
  })

  it('规范化 marketplace 响应并限制远程地址为 https', () => {
    expect(normalizeMarketplaceResponse([{ id: 'a' }])).toEqual({
      name: undefined,
      skills: [{ id: 'a' }]
    })
    expect(assertHttpsUrl('https://example.com/skill.md')).toBe('https://example.com/skill.md')
    expect(() => assertHttpsUrl('http://example.com/skill.md')).toThrow('Only HTTPS skill sources are supported')
  })
})
