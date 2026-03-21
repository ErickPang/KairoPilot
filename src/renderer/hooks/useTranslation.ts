import { useContext } from 'react';
import { I18nContext } from '../components/layout/I18nContext';

export function useTranslation() {
  return useContext(I18nContext);
}
