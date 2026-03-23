import { z } from 'zod';
import { ToolDefinition } from '../llm/types';

export const WebSearchTool: ToolDefinition = {
  name: 'web_search',
  description: 'Search the internet for real-time information using DuckDuckGo. Returns titles, snippets, and URLs of the top search results.',
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
        return { error: 'Invalid arguments: query is required' };
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
      const effectiveQuery = languageHint ? `${query} ${languageHint}` : query;
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(effectiveQuery)}`;
      
      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: AbortSignal.timeout(15000) // 15 seconds timeout
      });
      
      if (!response.ok) {
        return { error: `Failed to search: HTTP ${response.status}` };
      }
      
      const html = await response.text();
      const results = [];
      const regex = /<h2 class="result__title">[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet[^>]*>([\s\S]*?)<\/a>/gi;
      let match;
      
      while ((match = regex.exec(html)) !== null && results.length < limit) {
        let url = match[1];
        if (!url.includes('duckduckgo.com/y.js')) { // skip ads
          // Extract real URL if it's a redirect
          const urlMatch = url.match(/uddg=([^&]+)/);
          if (urlMatch) {
            url = decodeURIComponent(urlMatch[1]);
          } else if (url.startsWith('//')) {
            url = 'https:' + url;
          }
          
          // Clean up HTML entities and tags
          const cleanHtml = (str: string) => {
            return str
              .replace(/<[^>]+>/g, '')
              .replace(/&#x27;/g, "'")
              .replace(/&quot;/g, '"')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .trim();
          };

          results.push({
            title: cleanHtml(match[2]),
            url: url,
            snippet: cleanHtml(match[3])
          });
        }
      }
      
      if (results.length === 0) {
        return { message: "No results found.", results: [] };
      }
      
      return { results };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { error: `Search failed: ${errorMessage}` };
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
      const url = args.url as string;
      const maxLength = args.maxLength as number | undefined;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: AbortSignal.timeout(15000) // 15 seconds timeout
      });
      
      if (!response.ok) {
        return { error: `Failed to fetch URL: HTTP ${response.status}` };
      }
      
      const html = await response.text();
      
      // Simple text extraction
      let text = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
        
      const limit = maxLength || 8000;
      if (text.length > limit) {
        text = text.substring(0, limit) + '... [Content truncated]';
      }
      
      return { content: text, length: text.length };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { error: `Failed to fetch webpage: ${errorMessage}` };
    }
  }
};
