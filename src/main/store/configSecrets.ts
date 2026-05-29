import * as electron from 'electron';

const SAFE_STORAGE_PREFIX = 'safe-storage:v1:';

function canUseSafeStorage() {
  const safeStorage = electron.safeStorage;
  return Boolean(safeStorage?.isEncryptionAvailable?.());
}

function shouldRequireEncryptedStorage() {
  return Boolean(electron.app?.isPackaged);
}

function encryptWithSafeStorage(value: string): string | null {
  const safeStorage = electron.safeStorage;
  if (!canUseSafeStorage()) {
    if (shouldRequireEncryptedStorage()) {
      throw new Error('Secure credential storage is not available on this device.');
    }
    return null;
  }

  return `${SAFE_STORAGE_PREFIX}${safeStorage.encryptString(value).toString('base64')}`;
}

export function decryptConfigSecret(encryptedValue: string | undefined): string | null {
  const safeStorage = electron.safeStorage;
  if (!encryptedValue?.startsWith(SAFE_STORAGE_PREFIX) || !canUseSafeStorage()) {
    return null;
  }

  try {
    const payload = encryptedValue.slice(SAFE_STORAGE_PREFIX.length);
    return safeStorage.decryptString(Buffer.from(payload, 'base64'));
  } catch {
    return null;
  }
}

export function resolveConfigSecret(plainValue: string | undefined, encryptedValue: string | undefined): string {
  return decryptConfigSecret(encryptedValue) ?? plainValue ?? '';
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
      encryptedValue: undefined
    };
  }

  if (existingEncryptedValue && decryptConfigSecret(existingEncryptedValue) === normalizedPlainValue) {
    return {
      plainValue: '',
      encryptedValue: existingEncryptedValue
    };
  }

  const encryptedValue = encryptWithSafeStorage(normalizedPlainValue);
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
