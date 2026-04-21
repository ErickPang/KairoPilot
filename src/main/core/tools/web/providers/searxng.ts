import { classifyNetworkError, classifyNetworkErrorCategory } from '../diagnostics';
import { fetchJson } from '../fetch';
import type { SearchProvider, SearchProviderResult, SearchResultItem } from '../types';

type SearxngSearchResponse = {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
  }>;
};

function normalizeSearxngBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function createSearxngSearchProvider(baseUrl: string): SearchProvider {
  const normalizedBaseUrl = normalizeSearxngBaseUrl(baseUrl);
  const searchEndpoint = normalizedBaseUrl ? `${normalizedBaseUrl}/search` : '';

  return {
    id: 'searxng',
    label: 'SearxNG',
    kind: 'api',
    permissionUrls: searchEndpoint ? [searchEndpoint] : [],
    async search(input): Promise<SearchProviderResult> {
      if (!searchEndpoint) {
        return {
          ok: false,
          providerId: 'searxng',
          providerLabel: 'SearxNG',
          providerKind: 'api',
          searchUrl: '',
          reason: 'SearxNG base URL is not configured.',
          category: 'config',
          retryable: false
        };
      }

      const searchUrl = `${searchEndpoint}?q=${encodeURIComponent(input.query)}&format=json&pageno=1&language=${encodeURIComponent(input.languageHint || 'all')}`;

      try {
        const response = await fetchJson<SearxngSearchResponse>(searchUrl, input.timeoutMs);
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
          providerId: 'searxng',
          providerLabel: 'SearxNG',
          providerKind: 'api',
          results: normalizedResults,
          searchUrl
        };
      } catch (error) {
        return {
          ok: false,
          providerId: 'searxng',
          providerLabel: 'SearxNG',
          providerKind: 'api',
          searchUrl,
          reason: classifyNetworkError(error, searchUrl),
          category: classifyNetworkErrorCategory(error),
          retryable: true
        };
      }
    }
  };
}
