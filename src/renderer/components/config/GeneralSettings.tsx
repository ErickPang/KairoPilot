import { memo } from 'react';
import { Select } from '../Select';
import { useTranslation } from '../../hooks/useTranslation';

export const GeneralSettings = memo(function GeneralSettings() {
  const { t, locale, setLocale } = useTranslation();

  return (
    <div className="config-section">
      <div className="config-section-header">
        <h3>{t('settings.general')}</h3>
      </div>
      <div className="config-card">
        <div className="form-group">
          <label>{t('general.language')}</label>
          <Select 
            value={locale} 
            onChange={(val) => setLocale(val as 'zh' | 'en')}
            style={{ width: '300px' }}
            options={[
              { value: 'zh', label: t('general.language.zh') },
              { value: 'en', label: t('general.language.en') }
            ]}
          />
        </div>
      </div>
    </div>
  );
});
