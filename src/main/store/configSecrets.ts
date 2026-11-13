import * as electron from 'electron';

const SAFE_STORAGE_PREFIX = 'safe-storage:v1:';

const decryptedSecrets = new Map<string, { value: string; shouldReEncrypt: boolean }>();
const encryptedSecrets = new Map<string, string | null>();

function shouldRequireEncryptedStorage() {
  return Boolean(electron.app?.isPackaged);
}

/** Complete OS credential work before synchronous config normalization or persistence. */
export async function prepareConfigSecret(plainValue?: string, existingEncryptedValue?: string): Promise<void> {
  const plain = plainValue?.trim() || '';
  if (!plain && !existingEncryptedValue) return;
  const safeStorage = electron.safeStorage;
  let existing = existingEncryptedValue ? decryptedSecrets.get(existingEncryptedValue) : undefined;
  if (existingEncryptedValue && !existing) {
    try {
      if (!existingEncryptedValue.startsWith(SAFE_STORAGE_PREFIX) || !await safeStorage?.isAsyncEncryptionAvailable?.()) throw new Error();
      const decrypted = await safeStorage.decryptStringAsync(Buffer.from(existingEncryptedValue.slice(SAFE_STORAGE_PREFIX.length), 'base64'));
      if (typeof decrypted.result !== 'string') throw new Error();
      existing = { value: decrypted.result, shouldReEncrypt: decrypted.shouldReEncrypt };
      decryptedSecrets.set(existingEncryptedValue, existing);
    } catch { throw new Error('Unable to decrypt saved credentials. Unlock system secure storage and retry.'); }
  }
  const value = plain || existing?.value || '';
  if (!value) return;
  if (existingEncryptedValue && existing?.value === value && !existing.shouldReEncrypt) {
    encryptedSecrets.set(value, existingEncryptedValue); return;
  }
  if (encryptedSecrets.get(value) && (!existing?.shouldReEncrypt || encryptedSecrets.get(value) !== existingEncryptedValue)) return;
  const isEncryptionAvailable = Boolean(await safeStorage?.isAsyncEncryptionAvailable?.());
  if (!isEncryptionAvailable) {
    if (shouldRequireEncryptedStorage()) throw new Error('Secure credential storage is not available on this device.');
    encryptedSecrets.set(value, null);
    return;
  }
  const encrypted = `${SAFE_STORAGE_PREFIX}${(await safeStorage.encryptStringAsync(value)).toString('base64')}`;
  encryptedSecrets.set(value, encrypted);
  decryptedSecrets.set(encrypted, { value, shouldReEncrypt: false });
}

export function resolveConfigSecret(plainValue: string | undefined, encryptedValue: string | undefined): string {
  if (encryptedValue) {
    const decrypted = decryptedSecrets.get(encryptedValue);
    if (!decrypted) throw new Error('Unable to decrypt saved credentials. Unlock system secure storage and restart.');
    return decrypted.value;
  }
  return plainValue ?? '';
}

export function prepareConfigSecretForStorage(
  plainValue: string | undefined,
  existingEncryptedValue?: string
): {
  plainValue: string;
  encryptedValue?: string;
} {
  const normalizedPlainValue = plainValue?.trim() ?? '';
  if (!normalizedPlainValue) {
    return {
      plainValue: '',
      encryptedValue: existingEncryptedValue
    };
  }

  const existing = existingEncryptedValue ? decryptedSecrets.get(existingEncryptedValue) : undefined;
  if (existing?.value === normalizedPlainValue && !existing.shouldReEncrypt) {
    return {
      plainValue: '',
      encryptedValue: existingEncryptedValue
    };
  }

  const encryptedValue = encryptedSecrets.get(normalizedPlainValue);
  if (!encryptedValue && (shouldRequireEncryptedStorage() || !encryptedSecrets.has(normalizedPlainValue) && electron.safeStorage)) {
    throw new Error('Secure credentials must be prepared asynchronously before saving.');
  }
  return encryptedValue
    ? {
      plainValue: '',
      encryptedValue
    }
    : {
      plainValue: normalizedPlainValue,
      encryptedValue: undefined
    };
}

export function redactPlainConfigSecrets(content: string) {
  return content.replace(/("apiKey"\s*:\s*")[^"]*(")/g, '$1[REDACTED]$2');
}
