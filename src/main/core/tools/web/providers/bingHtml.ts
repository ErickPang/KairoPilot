import { createHtmlSearchProvider, cleanHtmlText, normalizeSearchResultUrl } from './html';

export function parseBingHtmlResults(html: string, limit: number) {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const regex = /<li class="b_algo"[\s\S]*?<h2><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>[\s\S]*?(?:<div class="b_caption"[^>]*><p[^>]*>([\s\S]*?)<\/p>|<p class="b_lineclamp\d+"[^>]*>([\s\S]*?)<\/p>)/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null && results.length < limit) {
    const normalizedUrl = normalizeSearchResultUrl(match[1]);
    if (!normalizedUrl) {
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

export const bingHtmlSearchProvider = createHtmlSearchProvider({
  id: 'bing',
  label: 'Bing',
  permissionUrls: ['https://www.bing.com/search', 'https://cn.bing.com/search'],
  buildSearchUrls: (query, languageHint) => {
    const effectiveQuery = languageHint ? `${query} ${languageHint}` : query;
    return [
      `https://cn.bing.com/search?q=${encodeURIComponent(effectiveQuery)}`,
      `https://www.bing.com/search?q=${encodeURIComponent(effectiveQuery)}`
    ];
  },
  parseResults: parseBingHtmlResults
});
