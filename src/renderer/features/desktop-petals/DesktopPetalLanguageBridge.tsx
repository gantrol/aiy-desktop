import { useEffect } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';

export function DesktopPetalLanguageBridge() {
  const { locale, messages } = useI18n();
  useEffect(() => {
    void window.desktopPetals
      .setLanguage?.({ locale, messages: messages.desktopPetals })
      .catch((error) => console.error('[desktop-petals] language update failed', error));
  }, [locale, messages.desktopPetals]);
  return null;
}
