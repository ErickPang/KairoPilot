import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTavilySearchProvider } from './tavily';

describe('tavily search provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('通过 Tavily API 返回统一搜索结果结构并附带 Bearer 鉴权', async () => {
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

    const provider = createTavilySearchProvider('https://api.tavily.com', 'tvly-secret');
    const result = await provider.search({
      query: 'openai latest',
      maxResults: 5,
      languageHint: 'lang_en',
      timeoutMs: 1000
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.tavily.com/search');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer tvly-secret'
      })
    });
    expect(result).toEqual({
      ok: true,
      providerId: 'tavily',
      providerLabel: 'Tavily',
      providerKind: 'api',
      results: [
        {
          title: 'Result A',
          url: 'https://example.com/a',
          snippet: 'Snippet A'
        }
      ],
      searchUrl: 'https://api.tavily.com/search'
    });
  });
});
