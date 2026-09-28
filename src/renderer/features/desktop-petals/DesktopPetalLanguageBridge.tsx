import { useEffect } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { enMessages } from '@/renderer/i18n/locales/en';
import { createCoalescedRefresh } from '@/shared/coalesced-refresh';

export function DesktopPetalLanguageBridge() {
  const { locale, messages } = useI18n();
  useEffect(() => {
    // The selected pack is still loading; do not publish its English fallback.
    if (locale !== 'en' && messages.desktopPetals === enMessages.desktopPetals) return;
    const updates = createCoalescedRefresh(
      async () => {
        await window.desktopPetals.setLanguage({ locale, messages: messages.desktopPetals });
      },
      (error) => console.error('[desktop-petals] language update failed', error),
    );
    // A transient IPC failure must not leave every petal in English until the
    // user changes language. Refocusing the owner republishes the current pack.
    window.addEventListener('focus', updates.request);
    updates.request();
    return () => {
      updates.dispose();
      window.removeEventListener('focus', updates.request);
    };
  }, [locale, messages.desktopPetals]);
  return null;
}
