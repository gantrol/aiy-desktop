import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { I18nContext } from '@/renderer/i18n/I18nContext';
import { enMessages } from '@/renderer/i18n/locales/en';
import { htmlLanguages } from '@/renderer/i18n/catalog';
import type { PetalLanguage } from '@/shared/contracts/petal-language';
import { createCoalescedRefresh } from '@/shared/coalesced-refresh';

/** A read-only language view: the main UI remains the owner of locale and enabled language packs. */
export function PetalI18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<PetalLanguage>({ locale: 'en', messages: enMessages.desktopPetals });
  useEffect(() => {
    let live = true,
      generation = 0;
    const unsubscribe = window.desktopPetals.onLanguageChanged((value) => {
      generation++;
      if (live) setLanguage(value);
    });
    const updates = createCoalescedRefresh(
      async () => {
        const request = generation;
        const value = await window.desktopPetals.language();
        if (live && request === generation) setLanguage(value);
      },
      (error) => console.error('[desktop-petals] language load failed', error),
    );
    window.addEventListener('focus', updates.request);
    updates.request();
    return () => {
      live = false;
      updates.dispose();
      unsubscribe();
      window.removeEventListener('focus', updates.request);
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = htmlLanguages[language.locale];
  }, [language.locale]);
  const value = useMemo(
    () => ({
      locale: language.locale,
      availableLocales: [language.locale],
      messages: {
        ...enMessages,
        desktopPetals: language.messages,
        contentEditor: { ...enMessages.contentEditor, ...language.messages.editor },
      },
      setLocale: () => undefined,
    }),
    [language],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
