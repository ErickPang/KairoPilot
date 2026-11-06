import { AsyncLocalStorage } from 'node:async_hooks';

export const DEFAULT_WEB_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Upgrade-Insecure-Requests': '1'
} as const;

type RequestUrlOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
};

type WebRequestPolicy = { checkUrl: (url: string) => boolean; signal?: AbortSignal };
const requestPolicy = new AsyncLocalStorage<WebRequestPolicy>();
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const CROSS_ORIGIN_SAFE_HEADERS = new Set(['accept', 'accept-language', 'user-agent', 'cache-control', 'pragma', 'upgrade-insecure-requests']);
class WebRequestPolicyError extends Error {}

export function withWebRequestPolicy<T>(checkUrl: (url: string) => boolean, signal: AbortSignal | undefined, action: () => T): T {
  return requestPolicy.run({ checkUrl, signal }, action);
}

function checkRequestUrl(url: string, policy?: WebRequestPolicy) {
  const target = new URL(url);
  if (!['http:', 'https:'].includes(target.protocol) || (policy && !policy.checkUrl(target.href))) {
    throw new WebRequestPolicyError('Permission Denied: Network target is not allowed.');
  }
  return target;
}

const TRANSIENT_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function isTransientNetworkError(error: unknown) {
  if (!(error instanceof Error) || error instanceof WebRequestPolicyError) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('timed out')
    || message.includes('timeout')
    || message.includes('fetch failed')
    || message.includes('socket')
    || message.includes('econnreset')
    || message.includes('econnrefused')
    || message.includes('enotfound')
    || message.includes('eai_again')
  );
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function requestUrl(url: string, options: RequestUrlOptions) {
  const method = (options.method || 'GET').toUpperCase();
  const policy = requestPolicy.getStore();
  const headers = {
    ...DEFAULT_WEB_HEADERS,
    ...(options.headers || {})
  };
  const attempts = method === 'GET' || method === 'HEAD' ? 2 : 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error(`Request timed out after ${options.timeoutMs}ms`)), options.timeoutMs);

    try {
      let target = checkRequestUrl(url, policy);
      let requestMethod = method;
      let body = options.body;
      const requestHeaders: Record<string, string> = { ...headers };
      let response: Response;
      for (let redirects = 0; ; redirects += 1) {
        checkRequestUrl(target.href, policy);
        response = await fetch(target.href, {
          method: requestMethod,
          headers: requestHeaders,
          body,
          redirect: 'manual',
          signal: policy?.signal ? AbortSignal.any([controller.signal, policy.signal]) : controller.signal
        });
        const location = REDIRECT_STATUSES.has(response.status) ? response.headers.get('location') : null;
        if (!location) break;
        await response.body?.cancel();
        if (redirects >= MAX_REDIRECTS) throw new WebRequestPolicyError('Network redirect limit exceeded.');
        if (!policy) throw new WebRequestPolicyError('Permission Denied: Redirect requires a network policy.');
        const next = checkRequestUrl(new URL(location, target).href, policy);
        if (target.protocol === 'https:' && next.protocol !== 'https:') {
          throw new WebRequestPolicyError('Permission Denied: HTTPS downgrade is not allowed.');
        }
        if (target.origin !== next.origin) {
          if (requestMethod !== 'GET' && requestMethod !== 'HEAD') {
            throw new WebRequestPolicyError('Permission Denied: Cross-origin redirect of a write request is not allowed.');
          }
          for (const key of Object.keys(requestHeaders)) {
            if (!CROSS_ORIGIN_SAFE_HEADERS.has(key.toLowerCase())) delete requestHeaders[key];
          }
        }
        if ((response.status === 303 && requestMethod !== 'HEAD') || ([301, 302].includes(response.status) && requestMethod === 'POST')) {
          requestMethod = 'GET';
          body = undefined;
          for (const key of Object.keys(requestHeaders)) {
            if (['content-type', 'content-length'].includes(key.toLowerCase())) delete requestHeaders[key];
          }
        }
        target = next;
      }

      clearTimeout(timeoutId);

      if (attempt < attempts - 1 && TRANSIENT_HTTP_STATUS.has(response.status)) {
        await wait(250 * (attempt + 1));
        continue;
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
      if (attempt >= attempts - 1 || !isTransientNetworkError(error)) {
        throw error;
      }
      await wait(250 * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Unknown network error');
}

export async function fetchHtml(url: string, timeoutMs: number) {
  const response = await requestUrl(url, { timeoutMs });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

export async function fetchJson<T>(url: string, timeoutMs: number): Promise<T> {
  const response = await requestUrl(url, {
    timeoutMs,
    headers: {
      'Accept': 'application/json,text/plain;q=0.9,*/*;q=0.8'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function postJson<T>(url: string, body: Record<string, unknown>, timeoutMs: number, headers?: Record<string, string>): Promise<T> {
  const response = await requestUrl(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/json,text/plain;q=0.9,*/*;q=0.8',
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body),
    timeoutMs
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}
