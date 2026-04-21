import type { AppNotice } from '../types';
import { useTranslation } from '../hooks/useTranslation';
import { IconCheck, IconShield, IconX } from './Icons';

interface AppNoticeBannerProps {
  notice: AppNotice;
  onDismiss: () => void;
}

export function AppNoticeBanner({ notice, onDismiss }: AppNoticeBannerProps) {
  const { t } = useTranslation();
  const variantClass = notice.kind === 'success'
    ? 'success'
    : notice.kind === 'info'
      ? 'info'
      : 'error';
  const title = notice.kind === 'success'
    ? t('common.success')
    : notice.kind === 'info'
      ? t('common.notice')
      : t('common.error');
  const Icon = notice.kind === 'success' ? IconCheck : IconShield;

  return (
    <div className={`app-notice app-notice-${variantClass}`} role="status" aria-live="polite">
      <div className="app-notice-icon">
        <Icon size={16} />
      </div>
      <div className="app-notice-content">
        <div className="app-notice-title">{title}</div>
        <div className="app-notice-message">{notice.message}</div>
      </div>
      <button
        type="button"
        className="app-notice-dismiss"
        onClick={onDismiss}
        aria-label={t('common.close')}
      >
        <IconX size={16} />
      </button>
    </div>
  );
}
