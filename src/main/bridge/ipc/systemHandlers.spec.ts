import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('returns success after streaming Ollama pull progress', async () => {
    const send = vi.fn();
    const encoded = new TextEncoder().encode('{"status":"pulling"}\n');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      body: {
        getReader: () => ({
          read: vi
            .fn()
            .mockResolvedValueOnce({ value: encoded, done: false })
            .mockResolvedValueOnce({ value: undefined, done: true })
        })
      }
    })));

    const handler = registeredHandlers.get(KAIRO_INVOKE.ollamaPull);
    const result = await handler?.({ sender: { send } }, {
      baseUrl: 'http://localhost:11434',
      modelName: 'llama3'
    });

    expect(result).toEqual({ success: true });
    expect(send).toHaveBeenCalledWith('ollama:pull-progress', {
      status: 'pulling'
    });
  });
});
