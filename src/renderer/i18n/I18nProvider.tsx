import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ExtensionDto, ExtensionLanguagePackDto, Locale } from '@/shared/contracts';
import { ENGLISH_LANGUAGE_EXTENSION_ID } from '@/shared/extension-ids';
import { htmlLanguages, languagePluginOrder, type MessageCatalog } from '@/renderer/i18n/catalog';
import { hydrateLanguageCatalog } from '@/renderer/i18n/languageCatalog';
import { enMessages } from '@/renderer/i18n/locales/en';
import { enabledLanguagePluginLocales, LANGUAGE_PLUGIN_STATE_EVENT } from '@/renderer/i18n/languagePluginState';

interface I18nContextValue {
  locale: Locale;
  setLocale(locale: Locale): void;
  messages: MessageCatalog;
  availableLocales: readonly Locale[];
}

export const I18nContext = createContext<I18nContextValue | null>(null);

function initialLocale(): Locale {
  return localStorage.getItem('aiy.locale.v1') === 'en' ? 'en' : 'zh';
}

interface RuntimeLanguagePack {
  extensionId: string;
  htmlLanguage: string;
  messages: MessageCatalog;
}

const hostLanguagePacks: Partial<Record<Locale, RuntimeLanguagePack>> = {
  en: {
    extensionId: ENGLISH_LANGUAGE_EXTENSION_ID,
    htmlLanguage: htmlLanguages.en,
    messages: enMessages,
  },
};

function hydrateLanguagePacks(packs: readonly ExtensionLanguagePackDto[]) {
  const hydrated: Partial<Record<Locale, RuntimeLanguagePack>> = { ...hostLanguagePacks };
  for (const pack of packs) {
    hydrated[pack.locale] = {
      extensionId: pack.extensionId,
      htmlLanguage: pack.htmlLanguage,
      messages: hydrateLanguageCatalog(pack.messages, enMessages),
    };
  }
  return hydrated;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setActiveLocale] = useState<Locale>(initialLocale);
  const [extensions, setExtensions] = useState<readonly ExtensionDto[]>([]);
  const [languagePacks, setLanguagePacks] = useState(hostLanguagePacks);
  const [catalogReady, setCatalogReady] = useState(false);
  const messages = languagePacks[locale]?.messages ?? enMessages;
  const availableLocales = useMemo<readonly Locale[]>(() => {
    if (!catalogReady) return languagePluginOrder;
    const catalogExtensionIds = new Set(
      Object.values(languagePacks).flatMap((pack) => (pack ? [pack.extensionId] : [])),
    );
    const enabled = enabledLanguagePluginLocales(extensions, catalogExtensionIds);
    return enabled.length ? enabled : ['en'];
  }, [catalogReady, extensions, languagePacks]);

  useEffect(() => {
    let disposed = false;
    let revision = 0;
    const refresh = async (knownExtensions?: readonly ExtensionDto[]) => {
      const requestRevision = ++revision;
      setCatalogReady(false);
      const [extensionResult, packResult] = await Promise.allSettled([
        knownExtensions ? Promise.resolve(knownExtensions) : window.desktopApi.extensionsList(),
        window.desktopApi.extensionLanguagePacksList(),
      ]);
      if (disposed || requestRevision !== revision) return;
      if (extensionResult.status === 'fulfilled') setExtensions(extensionResult.value);
      if (packResult.status === 'fulfilled') setLanguagePacks(hydrateLanguagePacks(packResult.value));
      setCatalogReady(extensionResult.status === 'fulfilled' && packResult.status === 'fulfilled');
    };
    void refresh();
    const handleLanguagePluginsChanged = (event: Event) => {
      void refresh((event as CustomEvent<readonly ExtensionDto[]>).detail);
    };
    window.addEventListener(LANGUAGE_PLUGIN_STATE_EVENT, handleLanguagePluginsChanged);
    return () => {
      disposed = true;
      window.removeEventListener(LANGUAGE_PLUGIN_STATE_EVENT, handleLanguagePluginsChanged);
    };
  }, []);

  useEffect(() => {
    if (!catalogReady) return;
    setActiveLocale((current) => {
      if (availableLocales.includes(current)) return current;
      const fallback = availableLocales[0] ?? 'en';
      localStorage.setItem('aiy.locale.v1', fallback);
      return fallback;
    });
  }, [availableLocales, catalogReady]);

  const setLocale = useCallback(
    (next: Locale) => {
      if (availableLocales.includes(next)) {
        localStorage.setItem('aiy.locale.v1', next);
        setActiveLocale(next);
      }
    },
    [availableLocales],
  );

  useEffect(() => {
    document.documentElement.lang = languagePacks[locale]?.htmlLanguage ?? htmlLanguages[locale];
    document.title = messages.app.title;
  }, [languagePacks, locale, messages.app.title]);

  const value = useMemo(
    () => ({ locale, setLocale, messages, availableLocales }),
    [availableLocales, locale, messages, setLocale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
