import { createHtmlSearchProvider, cleanHtmlText, normalizeSearchResultUrl } from './html';

export function parseBaiduHtmlResults(html: string, limit: number) {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const regex = /<div[^>]+class="result[^"]*"[\s\S]*?<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<div[^>]+class="c-abstract"[^>]*>([\s\S]*?)<\/div>|<span[^>]+class="content-right_8Zs40"[^>]*>([\s\S]*?)<\/span>)/gi;
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

export const baiduHtmlSearchProvider = createHtmlSearchProvider({
  id: 'baidu',
  label: 'Baidu',
  permissionUrls: ['https://www.baidu.com/s', 'http://www.baidu.com/s'],
  buildSearchUrls: (query, languageHint) => {
    const effectiveQuery = languageHint ? `${query} ${languageHint}` : query;
    return [
      `http://www.baidu.com/s?wd=${encodeURIComponent(effectiveQuery)}`,
      `https://www.baidu.com/s?wd=${encodeURIComponent(effectiveQuery)}`
    ];
  },
  parseResults: parseBaiduHtmlResults
});
