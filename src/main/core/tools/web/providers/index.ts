import type { SearchProvider } from '../types';
import type { WebSearchConfig } from '../../../../../shared/contracts';
import { baiduHtmlSearchProvider, parseBaiduHtmlResults } from './baiduHtml';
import { bingHtmlSearchProvider, parseBingHtmlResults } from './bingHtml';
import { duckDuckGoHtmlSearchProvider, parseDuckDuckGoHtmlResults } from './duckduckgoHtml';
import { createSearxngSearchProvider } from './searxng';
import { createTavilySearchProvider } from './tavily';

export function getWebSearchProviders(config: WebSearchConfig) {
  const providers: SearchProvider[] = [];

  if (config.providers.searxng.enabled && config.providers.searxng.baseUrl.trim().length > 0) {
    providers.push(createSearxngSearchProvider(config.providers.searxng.baseUrl));
  }
  if (config.providers.tavily.enabled && config.providers.tavily.baseUrl.trim().length > 0 && config.providers.tavily.apiKey.trim().length > 0) {
    providers.push(createTavilySearchProvider(config.providers.tavily.baseUrl, config.providers.tavily.apiKey));
  }
  if (config.providers.duckduckgo.enabled) {
    providers.push(duckDuckGoHtmlSearchProvider);
  }
  if (config.providers.bing.enabled) {
    providers.push(bingHtmlSearchProvider);
  }
  if (config.providers.baidu.enabled) {
    providers.push(baiduHtmlSearchProvider);
  }

  return providers;
}

export const webProviderTestUtils = {
  parseDuckDuckGoHtmlResults,
  parseBingHtmlResults,
  parseBaiduHtmlResults,
  createSearxngSearchProvider,
  createTavilySearchProvider
};
