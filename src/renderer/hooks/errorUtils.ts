import type { AppNotice } from '../types';

export function getErrorMessage(error: unknown, fallback = 'Unknown error') {
  return error instanceof Error ? error.message : fallback;
}

export function logRendererError(scope: string, error: unknown) {
  console.error(`[Renderer] ${scope}`, error);
}

export function createErrorNotice(message: string, source?: string): AppNotice {
  return {
    kind: 'error',
    message,
    source
  };
}

export function createInfoNotice(message: string, source?: string): AppNotice {
  return {
    kind: 'info',
    message,
    source
  };
}

export function createSuccessNotice(message: string, source?: string): AppNotice {
  return {
    kind: 'success',
    message,
    source
  };
}
