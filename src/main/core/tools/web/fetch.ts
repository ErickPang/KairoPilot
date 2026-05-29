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

const TRANSIENT_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function isTransientNetworkError(error: unknown) {
  if (!(error instanceof Error)) {
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
  const method = options.method || 'GET';
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
      const response = await fetch(url, {
        method,
        headers,
        body: options.body,
        redirect: 'follow',
        signal: controller.signal
      });

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
