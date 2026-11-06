import { describe, expect, it, vi } from 'vitest';
import { executeWithRetry } from './retryPolicy';

describe('abortable retry', () => {
  it('aborting during backoff prevents another model request', async () => {
    const controller = new AbortController();
    const streamFn = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const pending = executeWithRetry({
      streamFn, signal: controller.signal,
      config: { initialDelayMs: 30000 },
      onRetry: () => queueMicrotask(() => controller.abort())
    });
    await expect(pending).rejects.toThrow('Execution interrupted');
    expect(streamFn).toHaveBeenCalledTimes(1);
  });

  it('does not request a provider when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const streamFn = vi.fn();
    await expect(executeWithRetry({ streamFn, signal: controller.signal })).rejects.toThrow('interrupted');
    expect(streamFn).not.toHaveBeenCalled();
  });
});
