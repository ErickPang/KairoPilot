export const DEFAULT_WEB_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
} as const;

type RequestUrlOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
};

export async function requestUrl(url: string, options: RequestUrlOptions) {
  return fetch(url, {
    method: options.method || 'GET',
    headers: {
      ...DEFAULT_WEB_HEADERS,
      ...(options.headers || {})
    },
    body: options.body,
    signal: AbortSignal.timeout(options.timeoutMs)
  });
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
