import { createHtmlSearchProvider, cleanHtmlText, normalizeSearchResultUrl } from './html';

export function parseDuckDuckGoHtmlResults(html: string, limit: number) {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const regex = /<h2 class="result__title">[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a class="result__snippet[^>]*>([\s\S]*?)<\/a>|<div class="result__snippet[^>]*>([\s\S]*?)<\/div>)/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null && results.length < limit) {
    const normalizedUrl = normalizeSearchResultUrl(match[1]);
    if (!normalizedUrl || normalizedUrl.includes('duckduckgo.com/y.js')) {
      continue;
    }

    results.push({
      title: cleanHtmlText(match[2]),
      url: normalizedUrl,
      snippet: cleanHtmlText(match[3] || match[4] || '')
    });
  }

  return results.filter((result) => result.title && result.url);
}

export const duckDuckGoHtmlSearchProvider = createHtmlSearchProvider({
  id: 'duckduckgo',
  label: 'DuckDuckGo',
  permissionUrls: ['https://html.duckduckgo.com/html/'],
  buildSearchUrls: (query, languageHint) => {
    const effectiveQuery = languageHint ? `${query} ${languageHint}` : query;
    return [`https://html.duckduckgo.com/html/?q=${encodeURIComponent(effectiveQuery)}`];
  },
  parseResults: parseDuckDuckGoHtmlResults
});
