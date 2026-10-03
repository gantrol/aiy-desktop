import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Locale } from '@/shared/contracts';
import { I18nContext } from '@/renderer/i18n/I18nContext';
import { hydrateLanguageCatalog } from '@/renderer/i18n/languageCatalog';
import { enMessages } from '@/renderer/i18n/locales/en';
import { htmlLanguages } from '@/renderer/i18n/catalog';
import zhMessages from '../extensions/com.aiy.language.zh-cn/messages.json';
import { Workbench } from './minimal-loop/Workbench';
import '@/renderer/styles/index.css';

const catalogs = { en: enMessages, zh: hydrateLanguageCatalog(zhMessages, enMessages) };
function Root() {
  const [locale, setLocale] = useState<Locale>(() =>
    new URLSearchParams(location.search).get('locale') === 'en' ? 'en' : 'zh',
  );
  useEffect(() => {
    document.documentElement.lang = htmlLanguages[locale];
    document.title = catalogs[locale].designLab.themeCreation.title;
  }, [locale]);
  const value = useMemo(
    () => ({ locale, setLocale, messages: catalogs[locale], availableLocales: ['zh', 'en'] as const }),
    [locale],
  );
  return (
    <I18nContext.Provider value={value}>
      <Workbench />
    </I18nContext.Provider>
  );
}
createRoot(document.getElementById('root')!).render(<Root />);
