import { describe, expect, it } from 'vitest'
import {
  assertHttpsUrl,
  normalizeClaudeMarketplaceResponse,
  normalizeClaudeMarketplaceSkill,
  normalizeMarketplaceResponse,
  normalizeSkillStoreEntry,
  normalizeSkillsRegistryEntry,
  parseSkillFrontmatter
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
      metadata: {
        version: '1.2.3',
        allowedTools: ['Read', 'SearchCodebase']
      }
    })
    expect(result.body).toBe('# Skill Body\n\n正文内容')
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
