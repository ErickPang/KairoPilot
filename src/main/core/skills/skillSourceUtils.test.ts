import { describe, expect, it, vi, afterEach } from 'vitest'
import { SkillStoreEntry } from '../../../shared/contracts'
import {
  buildGithubRawUrl,
  fetchRemoteResource,
  materializeStoreFiles,
  materializeStoreSkill,
  normalizeMarketplaceSkills
} from './skillSourceUtils'
import { NormalizedSkillsRegistrySource } from './skillStoreUtils'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('skillSourceUtils', () => {
  it('规范化 marketplace catalog 并映射为技能列表', () => {
    const source: NormalizedSkillsRegistrySource = {
      type: 'manifest',
      url: 'https://example.com/store.json',
      name: 'Curated'
    }

    const skills = normalizeMarketplaceSkills(source, {
      name: 'Custom Store',
      skills: [
        {
          id: 'demo-skill',
          name: 'Demo Skill',
          description: 'Demo',
          source: {
            type: 'inline',
            content: 'demo'
          }
        }
      ]
    })

    expect(skills).toEqual([
      expect.objectContaining({
        id: 'demo-skill',
        name: 'Demo Skill',
        marketplace: 'Custom Store',
        registryUrl: 'https://example.com/store.json'
      })
    ])
  })

  it('构建 GitHub 原始文件地址并清理 repo/path', () => {
    const url = buildGithubRawUrl({
      type: 'github',
      repo: 'https://github.com/demo-org/demo-repo.git',
      path: '/skills/release-helper/',
      ref: 'stable'
    }, 'SKILL.md')

    expect(url).toBe('https://raw.githubusercontent.com/demo-org/demo-repo/stable/skills/release-helper/SKILL.md')
  })

  it('物化技能资源时保留内联内容并解析远程地址', async () => {
    const files = await materializeStoreFiles([
      { path: 'docs/readme.md', content: '# demo' },
      { path: '../secret.txt', content: 'blocked' },
      { path: 'bin/tool.txt', url: 'https://example.com/tool.txt' }
    ], {
      fetchRemoteResource: vi.fn(async (url: string) => `remote:${url}`)
    })

    expect(files).toEqual([
      {
        path: 'docs/readme.md',
        content: '# demo',
        encoding: 'utf-8'
      },
      {
        path: 'bin/tool.txt',
        content: 'remote:https://example.com/tool.txt',
        encoding: 'utf-8'
      }
    ])
  })

  it('物化 github 技能时使用 raw url 拉取 skill 文件与附加资源', async () => {
    const skill: SkillStoreEntry = {
      id: 'release-helper',
      name: 'Release Helper',
      description: 'demo',
      version: undefined,
      author: undefined,
      icon: undefined,
      tags: [],
      homepage: undefined,
      marketplace: 'Curated',
      registryUrl: 'https://example.com/store.json',
      sourceType: 'manifest',
      source: {
        type: 'github',
        repo: 'demo-org/demo-repo',
        path: 'skills/release-helper',
        ref: 'main',
        files: [
          { path: 'docs/guide.md' }
        ]
      },
      installedScopes: []
    }

    const fetchTextMock = vi.fn(async (url: string) => `text:${url}`)
    const fetchRemoteResourceMock = vi.fn(async (url: string, encoding: 'utf-8' | 'base64') => `${encoding}:${url}`)
    const materialized = await materializeStoreSkill(skill, {
      fetchText: fetchTextMock,
      fetchRemoteResource: fetchRemoteResourceMock
    })

    expect(fetchTextMock).toHaveBeenCalledWith('https://raw.githubusercontent.com/demo-org/demo-repo/main/skills/release-helper/SKILL.md')
    expect(fetchRemoteResourceMock).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/demo-org/demo-repo/main/skills/release-helper/docs/guide.md',
      'utf-8'
    )
    expect(materialized).toEqual({
      skillContent: 'text:https://raw.githubusercontent.com/demo-org/demo-repo/main/skills/release-helper/SKILL.md',
      files: [
        {
          path: 'docs/guide.md',
          content: 'utf-8:https://raw.githubusercontent.com/demo-org/demo-repo/main/skills/release-helper/docs/guide.md',
          encoding: 'utf-8'
        }
      ]
    })
  })

  it('远程资源支持 base64 编码下载', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => Uint8Array.from([104, 105]).buffer
    }))
    vi.stubGlobal('fetch', fetchMock)

    const content = await fetchRemoteResource('https://example.com/file.bin', 'base64')

    expect(content).toBe(Buffer.from('hi').toString('base64'))
  })
})
