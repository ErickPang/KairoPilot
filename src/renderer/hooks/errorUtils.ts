import type { AppNotice } from '../types';
import type { I18nContextValue } from '../components/layout/I18nContext';

export function getErrorMessage(error: unknown, fallback = 'Unknown error') {
  return error instanceof Error ? error.message : fallback;
}

export function logRendererError(scope: string, error: unknown) {
  console.error(`[Renderer] ${scope}`, error);
}

export function withActionableErrorHint(message: string, t: I18nContextValue['t']) {
  const normalized = message.toLowerCase();
  const hints: string[] = [];

  if (
    normalized.includes('model not found')
    || normalized.includes('缺少 api key')
    || normalized.includes('api key')
    || normalized.includes('no provider adapter')
    || normalized.includes('尚未接入原生适配器')
  ) {
    hints.push(t('app.errorHint.modelConfig'));
  }

  if (
    normalized.includes('real-time web access')
    || normalized.includes('alloweddomains')
    || normalized.includes('allowed network')
    || normalized.includes('network targets')
    || normalized.includes('web_search requires')
    || normalized.includes('fetch_webpage requires')
    || normalized.includes('http_request requires')
  ) {
    hints.push(t('app.errorHint.network'));
  }

  if (
    normalized.includes('permission denied')
    || normalized.includes('execution profile')
    || normalized.includes('file system access')
    || normalized.includes('is not allowed')
  ) {
    hints.push(t('app.errorHint.permissions'));
  }

  if (
    normalized.includes('command')
    && (
      normalized.includes('not allowed')
      || normalized.includes('shell execution is disabled')
      || normalized.includes('interactive shell commands')
    )
  ) {
    hints.push(t('app.errorHint.shell'));
  }

  if (normalized.includes('session does not belong') || normalized.includes('active session')) {
    hints.push(t('app.errorHint.session'));
  }

  const uniqueHints = Array.from(new Set(hints.filter(Boolean)));
  if (uniqueHints.length === 0) {
    return message;
  }

  return `${message}\n\n${uniqueHints.join('\n')}`;
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
