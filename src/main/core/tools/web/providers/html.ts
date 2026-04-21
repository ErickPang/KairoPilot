import { classifyNetworkError, classifyNetworkErrorCategory } from '../diagnostics';
import { fetchHtml } from '../fetch';
import type { SearchProvider, SearchProviderFailure, SearchProviderResult, SearchResultItem } from '../types';

export function cleanHtmlText(value: string) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeSearchResultUrl(rawUrl: string) {
  const trimmedUrl = rawUrl.trim();
  const redirectMatch = trimmedUrl.match(/[?&]uddg=([^&]+)/);
  if (redirectMatch) {
    return decodeURIComponent(redirectMatch[1]);
  }
  if (trimmedUrl.startsWith('//')) {
    return `https:${trimmedUrl}`;
  }
  return trimmedUrl;
}

type HtmlSearchProviderConfig = {
  id: string;
  label: string;
  permissionUrls: string[];
  buildSearchUrls: (query: string, languageHint: string) => string[];
  parseResults: (html: string, limit: number) => SearchResultItem[];
};

export function createHtmlSearchProvider(config: HtmlSearchProviderConfig): SearchProvider {
  return {
    id: config.id,
    label: config.label,
    kind: 'html',
    permissionUrls: config.permissionUrls,
    async search(input): Promise<SearchProviderResult> {
      const candidateSearchUrls = config.buildSearchUrls(input.query, input.languageHint);
      let lastSuccessfulSearchUrl: string | null = null;
      let lastFailure: SearchProviderFailure | null = null;

      for (const searchUrl of candidateSearchUrls) {
        try {
          const html = await fetchHtml(searchUrl, input.timeoutMs);
          const results = config.parseResults(html, input.maxResults);

          if (results.length > 0) {
            return {
              ok: true,
              providerId: config.id,
              providerLabel: config.label,
              providerKind: 'html',
              results,
              searchUrl
            };
          }

          lastSuccessfulSearchUrl = searchUrl;
          continue;
        } catch (error) {
          lastFailure = {
            ok: false,
            providerId: config.id,
            providerLabel: config.label,
            providerKind: 'html',
            searchUrl,
            reason: classifyNetworkError(error, searchUrl),
            category: classifyNetworkErrorCategory(error),
            retryable: true
          };
        }
      }

      if (lastSuccessfulSearchUrl) {
        return {
          ok: true,
          providerId: config.id,
          providerLabel: config.label,
          providerKind: 'html',
          results: [],
          searchUrl: lastSuccessfulSearchUrl
        };
      }

      if (lastFailure) {
        return lastFailure;
      }

      return {
        ok: false,
        providerId: config.id,
        providerLabel: config.label,
        providerKind: 'html',
        searchUrl: candidateSearchUrls[0] || '',
        reason: `${config.label} has no configured search URLs.`,
        category: 'config',
        retryable: false
      };
    }
  };
}
