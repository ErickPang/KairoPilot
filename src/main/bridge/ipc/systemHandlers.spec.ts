import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const registeredHandlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    registeredHandlers.set(channel, handler);
  }),
  showOpenDialog: vi.fn()
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMocks.handle
  },
  dialog: {
    showOpenDialog: electronMocks.showOpenDialog
  }
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    on: vi.fn(),
    unref: vi.fn()
  }))
}));

import { KAIRO_INVOKE } from '../../../shared/ipc';
import { registerSystemHandlers } from './systemHandlers';

describe('systemHandlers', () => {
  afterEach(() => { vi.useRealTimers(); });
  beforeEach(() => {
    registeredHandlers.clear();
    electronMocks.handle.mockClear();
    electronMocks.showOpenDialog.mockReset();
    vi.unstubAllGlobals();
    registerSystemHandlers();
  });

  it('normalizes Ollama pull HTTP failures through ipc result payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      statusText: 'Not Found'
    })));

    const handler = registeredHandlers.get(KAIRO_INVOKE.ollamaPull);
    const result = await handler?.({ sender: { send: vi.fn() } }, {
      baseUrl: 'http://localhost:11434',
      modelName: 'missing-model'
    });

    expect(result).toEqual({
      success: false,
      error: 'Failed to pull: Not Found'
    });
  });

  it('checks Ollama with a bounded request signal', async () => {
    const fetch = vi.fn(async () => ({ ok: true, text: async () => 'ready' }));
    vi.stubGlobal('fetch', fetch);
    expect(await registeredHandlers.get(KAIRO_INVOKE.ollamaCheck)?.({}, 'http://localhost:11434')).toEqual({ running: true, message: 'ready' });
    expect(fetch).toHaveBeenCalledWith('http://localhost:11434', { signal: expect.any(AbortSignal) });
  });

  it('does not report startup success when health checks fail', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => { throw new Error('not ready'); });
    vi.stubGlobal('fetch', fetch);
    const pending = registeredHandlers.get(KAIRO_INVOKE.ollamaStart)?.({});
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({ success: false });
    expect(fetch).toHaveBeenCalledTimes(10);
  });

  it('reports startup success only after the service is reachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => 'ready' })));
    expect(await registeredHandlers.get(KAIRO_INVOKE.ollamaStart)?.({})).toEqual({ success: true });
  });

  function pullStream(chunks: string[]) {
    const cancel = vi.fn();
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); },
      cancel
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, body })));
    const send = vi.fn();
    const result = registeredHandlers.get(KAIRO_INVOKE.ollamaPull)?.({ sender: { send } }, { baseUrl: 'http://localhost:11434', modelName: 'llama3' });
    return { result, send, body };
  }

  it.each([
    ['{"status":"pulling"}\n{"status":"success"}\n'],
    ['{"sta', 'tus":"pulling"}\n{"status":"suc', 'cess"}'],
    ['\n{"status":"pulling"}\r\n', '{"status":"success"}']
  ])('buffers streamed progress and requires a completion record (%j)', async (...chunks) => {
    const { result, send, body } = pullStream(chunks);
    expect(await result).toEqual({ success: true });
    expect(send.mock.calls.map(call => call[1])).toEqual([{ status: 'pulling' }, { status: 'success' }]);
    expect(body.locked).toBe(false);
  });

  it('returns a stream error instead of reporting success', async () => {
    const { result, body } = pullStream(['{"status":"pulling"}\n{"error":"model not found"}\n']);
    expect(await result).toEqual({ success: false, error: 'model not found' });
    expect(body.locked).toBe(false);
  });

  it.each([[], ['{"status":"pulling"}\n'], ['broken-json\n']])('rejects incomplete or malformed streams (%j)', async (...chunks) => {
    const { result, body } = pullStream(chunks);
    expect(await result).toMatchObject({ success: false });
    expect(body.locked).toBe(false);
  });
});
