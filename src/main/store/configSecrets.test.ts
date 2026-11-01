import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  encryptionAvailable: true,
  isPackaged: false
}));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electronMock.isPackaged;
    }
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => electronMock.encryptionAvailable),
    encryptString: vi.fn((value: string) => Buffer.from(`sealed:${value}`, 'utf-8')),
    decryptString: vi.fn((value: Buffer) => value.toString('utf-8').replace(/^sealed:/, ''))
  }
}));

import {
  prepareConfigSecretForStorage,
  redactPlainConfigSecrets,
  resolveConfigSecret
} from './configSecrets';

describe('configSecrets', () => {
  beforeEach(() => {
    electronMock.encryptionAvailable = true;
    electronMock.isPackaged = false;
  });

  it('encrypts secrets for storage and resolves them for runtime use', () => {
    const stored = prepareConfigSecretForStorage('sk-test');

    expect(stored.plainValue).toBe('');
    expect(stored.encryptedValue).toMatch(/^safe-storage:v1:/);
    expect(stored.encryptedValue).not.toContain('sk-test');
    expect(resolveConfigSecret('', stored.encryptedValue)).toBe('sk-test');
  });

  it('reuses existing encrypted secrets when the plaintext is unchanged', () => {
    const stored = prepareConfigSecretForStorage('sk-test');
    const reused = prepareConfigSecretForStorage('sk-test', stored.encryptedValue);

    expect(reused).toEqual(stored);
  });

  it('allows plaintext fallback only outside packaged builds when secure storage is unavailable', () => {
    electronMock.encryptionAvailable = false;

    expect(prepareConfigSecretForStorage('sk-dev')).toEqual({
      plainValue: 'sk-dev',
      encryptedValue: undefined
    });

    electronMock.isPackaged = true;
    expect(() => prepareConfigSecretForStorage('sk-prod')).toThrow(/Secure credential storage/);
  });

  it('redacts plaintext apiKey fields from invalid backup content', () => {
    expect(redactPlainConfigSecrets('{"apiKey":"sk-live","nested":{"apiKey":"token"}}')).toBe(
      '{"apiKey":"[REDACTED]","nested":{"apiKey":"[REDACTED]"}}'
    );
  });
});
