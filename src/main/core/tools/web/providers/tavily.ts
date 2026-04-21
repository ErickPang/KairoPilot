import { classifyNetworkError, classifyNetworkErrorCategory } from '../diagnostics';
import { postJson } from '../fetch';
import type { SearchProvider, SearchProviderResult, SearchResultItem } from '../types';

type TavilySearchResponse = {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
  }>;
};

function normalizeTavilyBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function createTavilySearchProvider(baseUrl: string, apiKey: string): SearchProvider {
  const normalizedBaseUrl = normalizeTavilyBaseUrl(baseUrl);
  const normalizedApiKey = apiKey.trim();
  const searchEndpoint = normalizedBaseUrl ? `${normalizedBaseUrl}/search` : '';

  return {
    id: 'tavily',
    label: 'Tavily',
    kind: 'api',
    permissionUrls: searchEndpoint ? [searchEndpoint] : [],
    async search(input): Promise<SearchProviderResult> {
      if (!searchEndpoint) {
        return {
          ok: false,
          providerId: 'tavily',
          providerLabel: 'Tavily',
          providerKind: 'api',
          searchUrl: '',
          reason: 'Tavily base URL is not configured.',
          category: 'config',
          retryable: false
        };
      }

      if (!normalizedApiKey) {
        return {
          ok: false,
          providerId: 'tavily',
          providerLabel: 'Tavily',
          providerKind: 'api',
          searchUrl: searchEndpoint,
          reason: 'Tavily API key is not configured.',
          category: 'config',
          retryable: false
        };
      }

      try {
        const response = await postJson<TavilySearchResponse>(
          searchEndpoint,
          {
            query: input.query,
            search_depth: 'basic',
            max_results: input.maxResults,
            topic: 'general',
            include_answer: false,
            include_raw_content: false,
            include_images: false
          },
          input.timeoutMs,
          {
            Authorization: `Bearer ${normalizedApiKey}`
          }
        );

        const normalizedResults: SearchResultItem[] = Array.isArray(response.results)
          ? response.results
            .map((item) => ({
              title: String(item.title || '').trim(),
              url: String(item.url || '').trim(),
              snippet: String(item.content || '').trim()
            }))
            .filter((item) => item.title.length > 0 && item.url.length > 0)
            .slice(0, input.maxResults)
          : [];

        return {
          ok: true,
          providerId: 'tavily',
          providerLabel: 'Tavily',
          providerKind: 'api',
          results: normalizedResults,
          searchUrl: searchEndpoint
        };
      } catch (error) {
        return {
          ok: false,
          providerId: 'tavily',
          providerLabel: 'Tavily',
          providerKind: 'api',
          searchUrl: searchEndpoint,
          reason: classifyNetworkError(error, searchEndpoint),
          category: classifyNetworkErrorCategory(error),
          retryable: true
        };
      }
    }
  };
}
