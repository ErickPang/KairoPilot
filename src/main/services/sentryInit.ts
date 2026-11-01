import * as Sentry from '@sentry/electron/main';
import { app } from 'electron';

export function initSentry() {
  const dsn = process.env.KAIROPILOT_SENTRY_DSN;
  if (!dsn) {
    // 未配置 DSN 时静默跳过
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV === 'development' ? 'development' : 'production',
    release: `kairopilot@${app.getVersion()}`,
    sendDefaultPii: false,
    beforeSend(event) {
      return {
        type: event.type,
        event_id: event.event_id,
        timestamp: event.timestamp,
        platform: event.platform,
        level: event.level,
        release: event.release,
        environment: event.environment,
        exception: event.exception ? {
          values: event.exception.values?.map(() => ({type: 'Error', value: '[redacted]'}))
        } : undefined
      };
    }
  });
}
