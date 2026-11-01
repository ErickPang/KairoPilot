import { describe, expect, it } from 'vitest';
import { prioritizeSearchProviders, resolveAllowedSearchProviders, runSearchRouter } from './router';
import type { SearchProvider } from './types';

function createProvider(id: string, label: string): SearchProvider {
  return {
    id,
    label,
    kind: 'html',
    permissionUrls: [`https://${id}.example.com/search`],
    async search() {
      return {
        ok: true,
        providerId: id,
        providerLabel: label,
        providerKind: 'html',
        results: [
          {
            title: `${label} Result`,
            url: `https://${id}.example.com/result`,
            snippet: `${label} Snippet`
          }
        ],
        searchUrl: `https://${id}.example.com/search`
      };
    }
  };
}

describe('web router', () => {
  it('英文查询时优先选择 Bing，再回退 DuckDuckGo 和百度', () => {
    const ordered = prioritizeSearchProviders([
      createProvider('duckduckgo', 'DuckDuckGo'),
      createProvider('baidu', 'Baidu'),
      createProvider('bing', 'Bing')
    ], 'openai latest', 'lang_en');

    expect(ordered.map((provider) => provider.id)).toEqual(['bing', 'duckduckgo', 'baidu']);
  });

  it('中文查询时优先选择 Bing，再回退百度和 DuckDuckGo', () => {
    const ordered = prioritizeSearchProviders([
      createProvider('duckduckgo', 'DuckDuckGo'),
      createProvider('baidu', 'Baidu'),
      createProvider('bing', 'Bing')
    ], '人工智能 最新 新闻', 'lang_zh');

    expect(ordered.map((provider) => provider.id)).toEqual(['bing', 'baidu', 'duckduckgo']);
  });

  it('显式偏好 provider 时优先使用偏好顺序，再拼接语言默认顺序', () => {
    const ordered = prioritizeSearchProviders([
      createProvider('duckduckgo', 'DuckDuckGo'),
      createProvider('baidu', 'Baidu'),
      createProvider('bing', 'Bing'),
      createProvider('searxng', 'SearxNG')
    ], 'openai latest', 'lang_en', ['searxng']);

    expect(ordered.map((provider) => provider.id)).toEqual(['searxng', 'bing', 'duckduckgo', 'baidu']);
  });

  it('只保留权限允许的 provider', () => {
    const filtered = resolveAllowedSearchProviders([
      createProvider('duckduckgo', 'DuckDuckGo'),
      createProvider('bing', 'Bing')
    ], ['bing']);

    expect(filtered.map((provider) => provider.id)).toEqual(['bing']);
  });

  it('所有 provider 失败时返回聚合 diagnostics', async () => {
    const failingProvider: SearchProvider = {
      id: 'bing',
      label: 'Bing',
      kind: 'html',
      permissionUrls: ['https://bing.example.com/search'],
      async search() {
        return {
          ok: false,
          providerId: 'bing',
          providerLabel: 'Bing',
          providerKind: 'html',
          searchUrl: 'https://bing.example.com/search',
          reason: 'Timed out',
          category: 'network',
          retryable: true
        };
      }
    };

    const result = await runSearchRouter({
      query: 'test',
      maxResults: 5,
      languageHint: 'lang_en',
      timeoutMs: 1000,
      providers: [failingProvider]
    });

    expect(result).toEqual({
      ok: false,
      reason: 'Timed out',
      diagnostics: [
        {
          source: 'bing',
          provider: 'Bing',
          providerKind: 'html',
          url: 'https://bing.example.com/search',
          reason: 'Timed out',
          category: 'network',
          retryable: true
        }
      ]
    });
  });

  it('provider 返回空结果时视为失败并继续汇总 diagnostics', async () => {
    const emptyProvider: SearchProvider = {
      id: 'bing',
      label: 'Bing',
      kind: 'html',
      permissionUrls: ['https://bing.example.com/search'],
      async search() {
        return {
          ok: false,
          providerId: 'bing',
          providerLabel: 'Bing',
          providerKind: 'html',
          searchUrl: 'https://bing.example.com/search',
          reason: 'Bing returned a page but no parsable results were found.',
          category: 'empty',
          retryable: true
        };
      }
    };

    const result = await runSearchRouter({
      query: 'test',
      maxResults: 5,
      languageHint: 'lang_en',
      timeoutMs: 1000,
      providers: [emptyProvider]
    });

    expect(result).toEqual({
      ok: false,
      reason: 'Bing returned a page but no parsable results were found.',
      diagnostics: [
        {
          source: 'bing',
          provider: 'Bing',
          providerKind: 'html',
          url: 'https://bing.example.com/search',
          reason: 'Bing returned a page but no parsable results were found.',
          category: 'empty',
          retryable: true
        }
      ]
    });
  });
});
