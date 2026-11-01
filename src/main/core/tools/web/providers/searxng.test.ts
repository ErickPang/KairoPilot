import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSearxngSearchProvider } from './searxng';

describe('searxng search provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('将 json 结果规范化为统一搜索结果结构', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            title: 'Result A',
            url: 'https://example.com/a',
            content: 'Snippet A'
          }
        ]
      })
    } satisfies Partial<Response>);

    vi.stubGlobal('fetch', fetchMock);

    const provider = createSearxngSearchProvider('https://searx.example.com/');
    const result = await provider.search({
      query: 'openai',
      maxResults: 5,
      languageHint: 'lang_en',
      timeoutMs: 1000
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('https://searx.example.com/search?q=openai');
    expect(result).toEqual({
      ok: true,
      providerId: 'searxng',
      providerLabel: 'SearxNG',
      providerKind: 'api',
      results: [
        {
          title: 'Result A',
          url: 'https://example.com/a',
          snippet: 'Snippet A'
        }
      ],
      searchUrl: 'https://searx.example.com/search?q=openai&format=json&pageno=1&language=lang_en'
    });
  });
});
