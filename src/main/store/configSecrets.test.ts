import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  encryptionAvailable: true,
  isPackaged: false,
  shouldReEncrypt: false,
  failEncryption: false
}));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electronMock.isPackaged;
    }
  },
  safeStorage: {
    isAsyncEncryptionAvailable: vi.fn(async () => electronMock.encryptionAvailable),
    encryptStringAsync: vi.fn(async (value: string) => { if(electronMock.failEncryption)throw new Error('Synthetic storage failure'); return Buffer.from(`sealed:${value}`, 'utf-8'); }),
    decryptStringAsync: vi.fn(async (value: Buffer) => ({ result: value.toString('utf-8').replace(/^(old-)?sealed:/, ''), shouldReEncrypt: electronMock.shouldReEncrypt }))
  }
}));

import {
  prepareConfigSecretForStorage,
  prepareConfigSecret,
  redactPlainConfigSecrets,
  resolveConfigSecret
} from './configSecrets';

describe('configSecrets', () => {
  beforeEach(() => {
    electronMock.encryptionAvailable = true;
    electronMock.isPackaged = false;
    electronMock.shouldReEncrypt = false;
    electronMock.failEncryption = false;
  });

  it('encrypts secrets asynchronously for storage and resolves them from memory for runtime use', async () => {
    await prepareConfigSecret('sk-test');
    const stored = prepareConfigSecretForStorage('sk-test');

    expect(stored.plainValue).toBe('');
    expect(stored.encryptedValue).toMatch(/^safe-storage:v1:/);
    expect(stored.encryptedValue).not.toContain('sk-test');
    expect(resolveConfigSecret('', stored.encryptedValue)).toBe('sk-test');
  });

  it('reuses existing encrypted secrets when the plaintext is unchanged', async () => {
    await prepareConfigSecret('sk-test');
    const stored = prepareConfigSecretForStorage('sk-test');
    const reused = prepareConfigSecretForStorage('sk-test', stored.encryptedValue);

    expect(reused).toEqual(stored);
  });

  it('rejects unreadable credentials and preserves their ciphertext when saving an empty runtime value', async () => {
    const encryptedValue = 'safe-storage:v1:' + Buffer.from('sealed:unreadable-key').toString('base64');
    electronMock.encryptionAvailable = false;
    await expect(prepareConfigSecret(undefined, encryptedValue)).rejects.toThrow('Unable to decrypt');
    expect(() => resolveConfigSecret('', encryptedValue)).toThrow('Unable to decrypt');
    expect(prepareConfigSecretForStorage('', encryptedValue)).toEqual({ plainValue:'', encryptedValue });
  });

  it('allows plaintext fallback only outside packaged builds when secure storage is unavailable', async () => {
    electronMock.encryptionAvailable = false;
    await prepareConfigSecret('sk-dev');

    expect(prepareConfigSecretForStorage('sk-dev')).toEqual({
      plainValue: 'sk-dev',
      encryptedValue: undefined
    });
    expect(() => prepareConfigSecretForStorage('unprepared-dev-key')).toThrow('prepared asynchronously');

    electronMock.isPackaged = true;
    await expect(prepareConfigSecret('sk-prod')).rejects.toThrow(/Secure credential storage/);
    expect(() => prepareConfigSecretForStorage('sk-prod')).toThrow(/Secure credentials/);
  });

  it('reads existing v1 ciphertext using the async API without changing its value', async () => {
    const encrypted = 'safe-storage:v1:' + Buffer.from('sealed:legacy-key').toString('base64');
    await prepareConfigSecret(undefined, encrypted);
    expect(resolveConfigSecret('', encrypted)).toBe('legacy-key');
    expect(prepareConfigSecretForStorage('legacy-key', encrypted).encryptedValue).toBe(encrypted);
  });

  it('re-encrypts when the asynchronous backend requests key rotation', async () => {
    const encrypted = 'safe-storage:v1:' + Buffer.from('old-sealed:rotated-key').toString('base64');
    electronMock.shouldReEncrypt = true;
    await prepareConfigSecret(undefined, encrypted);
    const stored = prepareConfigSecretForStorage('rotated-key', encrypted);
    expect(stored.encryptedValue).not.toBe(encrypted); expect(resolveConfigSecret('', stored.encryptedValue)).toBe('rotated-key');
  });

  it('does not fall back to plaintext when asynchronous encryption fails', async () => {
    electronMock.failEncryption = true;
    await expect(prepareConfigSecret('failed-key')).rejects.toThrow('Synthetic storage failure');
    expect(() => prepareConfigSecretForStorage('failed-key')).toThrow('prepared asynchronously');
  });

  it('redacts plaintext apiKey fields from invalid backup content', () => {
    expect(redactPlainConfigSecrets('{"apiKey":"sk-live","nested":{"apiKey":"token"}}')).toBe(
      '{"apiKey":"[REDACTED]","nested":{"apiKey":"[REDACTED]"}}'
    );
  });
});
