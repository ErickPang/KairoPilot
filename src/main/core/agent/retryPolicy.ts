import type { LLMUsage } from '../llm/types';

// ---------------------------------------------------------------------------
// 错误分类
// ---------------------------------------------------------------------------
export type ErrorCategory =
  | 'rate_limit'       // 429 / rate limit → 可重试
  | 'server_error'     // 5xx → 可重试
  | 'timeout'          // 网络超时 → 可重试
  | 'connection'       // DNS/TCP 连接失败 → 可重试
  | 'content_filter'   // 内容策略拦截 → 不可重试
  | 'auth_failure'     // 401/403 → 不可重试
  | 'bad_request'      // 400 → 不可重试
  | 'context_overflow' // 上下文过长 → 不可重试
  | 'unknown';         // 未知错误 → 保守不可重试

export interface RetryConfig {
  /** 最大重试次数 */
  maxRetries: number;
  /** 初始退避延迟（毫秒） */
  initialDelayMs: number;
  /** 退避倍增因子 */
  backoffMultiplier: number;
  /** 最大延迟上限（毫秒） */
  maxDelayMs: number;
  /** 可重试的错误类别 */
  retryableCategories: ErrorCategory[];
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 30000,
  retryableCategories: ['rate_limit', 'server_error', 'timeout', 'connection']
};

// ---------------------------------------------------------------------------
// 错误检测
// ---------------------------------------------------------------------------
export function categorizeError(error: unknown): ErrorCategory {
  if (!(error instanceof Error)) return 'unknown';

  const message = error.message || '';
  const statusCode = extractStatusCode(error);

  // HTTP status code based
  if (statusCode === 429) return 'rate_limit';
  if (statusCode === 408) return 'timeout';
  if (statusCode === 413) return 'context_overflow';
  if (statusCode === 400) return 'bad_request';
  if (statusCode === 401 || statusCode === 403) return 'auth_failure';
  if (statusCode && statusCode >= 500 && statusCode < 600) return 'server_error';

  // Message based heuristics
  const lower = message.toLowerCase();
  if (/rate.?limit|too many requests|quota exceeded|throttl/i.test(lower)) return 'rate_limit';
  if (/timeout|timed out|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(lower)) return 'timeout';
  if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|ENETUNREACH|getaddrinfo/i.test(lower)) return 'connection';
  if (/content.?filter|safety|content policy|moderation/i.test(lower)) return 'content_filter';
  if (/unauthorized|invalid.*api.?key|authentication|forbidden/i.test(lower)) return 'auth_failure';
  if (/context.?length|token.?limit|maximum context length|reduce the length/i.test(lower)) return 'context_overflow';
  if (/stream_options|include_usage|unsupported|unrecognized|unknown parameter|invalid value/i.test(lower)) return 'bad_request';

  return 'unknown';
}

function extractStatusCode(error: unknown): number | null {
  if (!(error instanceof Error)) return null;

  // Anthropic/OpenAI-style error with status field
  const obj = error as unknown as Record<string, unknown>;
  if (typeof obj.status === 'number') return obj.status;
  if (typeof obj.statusCode === 'number') return obj.statusCode;

  // Try to parse from message "status 429" pattern
  const match = (error.message || '').match(/\bstatus\s*(\d{3})\b/i);
  if (match) return parseInt(match[1], 10);

  return null;
}

// ---------------------------------------------------------------------------
// 退避延迟计算
// ---------------------------------------------------------------------------
export function computeBackoffDelay(attempt: number, config: RetryConfig): number {
  const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
  // 加 ±20% 随机抖动，避免惊群
  const jitter = delay * (0.8 + Math.random() * 0.4);
  return Math.min(jitter, config.maxDelayMs);
}

export function isRetryable(category: ErrorCategory, config: RetryConfig): boolean {
  return config.retryableCategories.includes(category);
}

// ---------------------------------------------------------------------------
// 流式调用重试包装器
// ---------------------------------------------------------------------------
export interface StreamCallParams {
  streamFn: (attempt: number) => Promise<{
    content: string;
    toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    model: string;
    usage?: LLMUsage;
  }>;
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
  config?: Partial<RetryConfig>;
  signal?: AbortSignal;
}

export async function executeWithRetry(params: StreamCallParams): Promise<{
  content: string;
  toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  model: string;
  usage?: LLMUsage;
}> {
  const {
    streamFn,
    onRetry,
    config: userConfig,
    signal
  } = params;

  const config: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...userConfig };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      if (signal?.aborted) throw new Error('Execution interrupted.');
      return await streamFn(attempt);
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
      const category = categorizeError(lastError);

      if (attempt >= config.maxRetries || !isRetryable(category, config)) {
        throw lastError;
      }

      const delayMs = computeBackoffDelay(attempt, config);
      onRetry?.(attempt + 1, lastError, delayMs);

      await new Promise<void>((resolve, reject) => {
        const interrupt = () => { clearTimeout(timer); signal?.removeEventListener('abort', interrupt); reject(new Error('Execution interrupted.')); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', interrupt); resolve(); }, delayMs);
        signal?.addEventListener('abort', interrupt, { once: true });
        if (signal?.aborted) interrupt();
      });
    }
  }

  throw lastError ?? new Error('Retry exhausted with no error captured');
}
