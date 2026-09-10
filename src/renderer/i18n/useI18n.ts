import { useContext } from 'react';
import { I18nContext } from '@/renderer/i18n/I18nContext';

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
