import { z } from 'zod';
import { getWebSearchConfig } from '../../store/config';
import { createDefaultWebSearchConfig } from '../../store/configWebSearchUtils';
import { ToolDefinition } from '../llm/types';
import { toolError, toolOk } from './result';
import { classifyNetworkError } from './web/diagnostics';
import { fetchHtml, requestUrl } from './web/fetch';
import { getWebSearchProviders, webProviderTestUtils } from './web/providers';
import { runSearchRouter } from './web/router';
const FETCH_WEBPAGE_TIMEOUT_MS = 15_000;
const HTTP_REQUEST_TIMEOUT_MS = 20_000;
const HTTP_REQUEST_MAX_LENGTH = 12_000;
const FETCH_WEBPAGE_FALLBACK_TIMEOUT_MS = 25_000;

export const __webToolTestUtils = {
  ...webProviderTestUtils
};

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function looksLikeBlockedWebpage(html: string) {
  const normalizedHtml = html.toLowerCase();
  return (
    normalizedHtml.includes('百度安全验证')
    || normalizedHtml.includes('安全验证')
    || normalizedHtml.includes('captcha')
    || normalizedHtml.includes('verify you are human')
    || normalizedHtml.includes('access denied')
    || normalizedHtml.includes('robot check')
    || normalizedHtml.includes('unusual traffic')
  );
}

function extractPrimaryHtmlSegment(html: string) {
  const candidates = [
    html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1],
    html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1],
    html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1]
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  return candidates[0] || html;
}

function htmlToPlainText(html: string) {
  return decodeHtmlEntities(html)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractWebpageText(html: string) {
  const title = decodeHtmlEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim();
  const description = decodeHtmlEntities(
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1]
      || html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1]
      || ''
  ).trim();
  const primaryText = htmlToPlainText(extractPrimaryHtmlSegment(html));
  const fullText = htmlToPlainText(html);
  let content = primaryText.length >= 160 ? primaryText : fullText;
  if (title && content.startsWith(`${title} `)) {
    content = content.slice(title.length).trim();
  }

  return [title, description, content]
    .filter((segment, index, values) => Boolean(segment) && values.indexOf(segment) === index)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getEffectiveWebSearchConfig() {
  try {
    return getWebSearchConfig();
  } catch {
    return createDefaultWebSearchConfig();
  }
}

export function getConfiguredWebSearchProviders() {
  return getWebSearchProviders(getEffectiveWebSearchConfig());
}

export const WebSearchTool: ToolDefinition = {
  name: 'web_search',
  description: 'Search the internet for real-time information using multiple providers with automatic fallback. Returns titles, snippets, and URLs of the top search results.',
  parameters: z.object({
    query: z.string().describe('The search query'),
    maxResults: z.number().optional().describe('Maximum number of results to return (default: 5, max: 10)'),
    num: z.number().optional().describe('Alias of maxResults. Maximum number of results to return (default: 5, max: 10)'),
    lr: z.string().optional().describe('Optional language hint for query filtering, such as lang_en')
  }),
  execute: async (args: Record<string, unknown>) => {
    try {
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      if (!query) {
        return toolError('Invalid arguments: query is required');
      }

      const preferredMaxResults = typeof args.maxResults === 'number' && Number.isFinite(args.maxResults)
        ? args.maxResults
        : typeof args.num === 'number' && Number.isFinite(args.num)
          ? args.num
          : undefined;
      const languageHint = typeof args.lr === 'string' ? args.lr.trim() : '';
      const maxResults = typeof preferredMaxResults === 'number'
        ? preferredMaxResults
        : undefined;
      const limit = Math.max(1, Math.min(maxResults || 5, 10));
      const webSearchConfig = getEffectiveWebSearchConfig();

      const result = await runSearchRouter({
        query,
        maxResults: limit,
        languageHint,
        timeoutMs: webSearchConfig.timeoutMs,
        providers: getWebSearchProviders(webSearchConfig),
        allowedProviderIds: args.__allowedSearchProviders,
        preferredProviderIds: webSearchConfig.preferredProviders
      });

      if (result.ok) {
        return toolOk({
          results: result.results,
          source: result.source,
          provider: result.provider,
          providerKind: result.providerKind,
          searchUrl: result.searchUrl,
          diagnostics: result.diagnostics
        });
      }

      return toolError(
        `Web search failed. ${result.reason}`,
        result.diagnostics,
        {
          suggestion: 'If network permission is already enabled, verify that at least one supported search provider is reachable from this machine and permitted by allowedDomains.'
        }
      );
    } catch (error: unknown) {
      return toolError(
        classifyNetworkError(error, 'the configured web search providers'),
        undefined,
        {
          suggestion: 'If network permission is already enabled, check the target site reachability, DNS, HTTPS interception, or local proxy settings.'
        }
      );
    }
  }
};

export const FetchWebpageTool: ToolDefinition = {
  name: 'fetch_webpage',
  description: 'Fetch and extract the text content from a specific webpage URL.',
  parameters: z.object({
    url: z.string().describe('The URL of the webpage to fetch'),
    maxLength: z.number().optional().describe('Maximum number of characters to return (default: 8000)')
  }),
  execute: async (args: Record<string, unknown>) => {
    try {
      const url = typeof args.url === 'string' ? args.url.trim() : '';
      if (!url) {
        return toolError('Invalid arguments: url is required');
      }

      const maxLength = args.maxLength as number | undefined;
      let html: string;
      try {
        html = await fetchHtml(url, FETCH_WEBPAGE_TIMEOUT_MS);
      } catch (error) {
        if (error instanceof Error && /Permission Denied|redirect limit/.test(error.message)) throw error;
        html = await fetchHtml(url, FETCH_WEBPAGE_FALLBACK_TIMEOUT_MS);
      }

      if (looksLikeBlockedWebpage(html)) {
        return toolError(`Request to ${url} returned a verification or blocked page instead of readable content.`);
      }

      let text = extractWebpageText(html);
      if (!text) {
        return toolError(`Request to ${url} succeeded but no readable page text could be extracted.`);
      }

      const limit = maxLength || 8000;
      if (text.length > limit) {
        text = `${text.substring(0, limit)}... [Content truncated]`;
      }

      return toolOk({ content: text, length: text.length, url });
    } catch (error: unknown) {
      const url = typeof args.url === 'string' ? args.url.trim() : 'the requested URL';
      return toolError(
        classifyNetworkError(error, url),
        undefined,
        {
          suggestion: 'Check whether the target URL is reachable from this machine and whether Agent allowedDomains includes this URL or host.'
        }
      );
    }
  }
};

function normalizeHttpMethod(value: unknown) {
  const method = typeof value === 'string' ? value.trim().toUpperCase() : 'GET';
  return method || 'GET';
}

function isJsonContentType(contentType: string) {
  return contentType.includes('application/json') || contentType.endsWith('+json');
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 22)).trimEnd()}... [Content truncated]`;
}

export const HttpRequestTool: ToolDefinition = {
  name: 'http_request',
  description: 'Make an HTTP request to a URL and return JSON or text. Supports GET, POST, PUT, PATCH, DELETE, and HEAD for API and documentation access.',
  parameters: z.object({
    url: z.string().describe('The target URL to request'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).optional().describe('HTTP method to use (default: GET)'),
    headers: z.object({}).catchall(z.string()).optional().describe('Optional request headers'),
    body: z.string().optional().describe('Optional raw request body for non-JSON requests'),
    json: z.object({}).catchall(z.unknown()).optional().describe('Optional JSON request body'),
    responseType: z.enum(['auto', 'text', 'json']).optional().describe('How to decode the response body (default: auto)'),
    maxLength: z.number().optional().describe(`Maximum number of characters returned for text responses (default: ${HTTP_REQUEST_MAX_LENGTH})`)
  }),
  execute: async (args: Record<string, unknown>) => {
    try {
      const url = typeof args.url === 'string' ? args.url.trim() : '';
      if (!url) {
        return toolError('Invalid arguments: url is required');
      }

      const method = normalizeHttpMethod(args.method);
      const headers = args.headers && typeof args.headers === 'object' && !Array.isArray(args.headers)
        ? Object.fromEntries(
          Object.entries(args.headers as Record<string, unknown>)
            .map(([key, value]) => [key, String(value)])
        )
        : {};
      const rawBody = typeof args.body === 'string' ? args.body : undefined;
      const jsonBody = args.json && typeof args.json === 'object' && !Array.isArray(args.json)
        ? args.json as Record<string, unknown>
        : undefined;
      const responseType = typeof args.responseType === 'string' ? args.responseType : 'auto';
      const maxLength = typeof args.maxLength === 'number' && Number.isFinite(args.maxLength)
        ? Math.max(1, Math.min(Math.round(args.maxLength), 100_000))
        : HTTP_REQUEST_MAX_LENGTH;

      if (rawBody && jsonBody) {
        return toolError('Invalid arguments: provide either body or json, not both');
      }

      if ((method === 'GET' || method === 'HEAD') && (rawBody || jsonBody)) {
        return toolError(`Invalid arguments: ${method} requests do not accept body or json`);
      }

      const requestBody = jsonBody ? JSON.stringify(jsonBody) : rawBody;
      if (jsonBody && !Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/json';
      }

      const response = await requestUrl(url, {
        method,
        headers,
        body: requestBody,
        timeoutMs: HTTP_REQUEST_TIMEOUT_MS
      });
      const contentType = response.headers.get('content-type') || '';

      if (method === 'HEAD') {
        return toolOk({
          url,
          method,
          status: response.status,
          ok: response.ok,
          contentType,
          headers: Object.fromEntries(response.headers.entries())
        });
      }

      const text = await response.text();
      const normalizedText = text.trim();

      if (!response.ok) {
        return toolError(
          `HTTP ${response.status} while requesting ${url}`,
          {
            url,
            method,
            status: response.status,
            contentType,
            body: truncateText(normalizedText, maxLength)
          }
        );
      }

      const shouldParseJson = responseType === 'json'
        || (responseType === 'auto' && isJsonContentType(contentType));

      if (shouldParseJson) {
        try {
          const data = normalizedText ? JSON.parse(normalizedText) : null;
          return toolOk({
            url,
            method,
            status: response.status,
            ok: response.ok,
            contentType,
            data
          });
        } catch (error) {
          if (responseType === 'json') {
            return toolError(
              `Response from ${url} is not valid JSON: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        }
      }

      return toolOk({
        url,
        method,
        status: response.status,
        ok: response.ok,
        contentType,
        text: truncateText(normalizedText, maxLength),
        length: normalizedText.length
      });
    } catch (error: unknown) {
      const url = typeof args.url === 'string' ? args.url.trim() : 'the requested URL';
      return toolError(
        classifyNetworkError(error, url),
        undefined,
        {
          suggestion: 'Check whether the target URL is reachable from this machine and whether Agent allowedDomains includes this URL or host.'
        }
      );
    }
  }
};
