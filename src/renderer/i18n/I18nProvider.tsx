import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { I18nContext } from '@/renderer/i18n/I18nContext';
export { I18nContext } from '@/renderer/i18n/I18nContext';
import type { ExtensionDto, ExtensionLanguagePackDto, Locale } from '@/shared/contracts';
import { ENGLISH_LANGUAGE_EXTENSION_ID } from '@/shared/extension-ids';
import { htmlLanguages, languagePluginOrder, type MessageCatalog } from '@/renderer/i18n/catalog';
import { hydrateLanguageCatalog } from '@/renderer/i18n/languageCatalog';
import { enMessages } from '@/renderer/i18n/locales/en';
import {
  enabledLanguagePluginLocales,
  getPublishedLanguagePluginState,
  LANGUAGE_PLUGIN_STATE_EVENT,
  type LanguagePluginStateEventDetail,
} from '@/renderer/i18n/languagePluginState';

function initialLocale(): Locale {
  return localStorage.getItem('aiy.locale.v1') === 'en' ? 'en' : 'zh';
}

interface RuntimeLanguagePack {
  extensionId: string;
  htmlLanguage: string;
  messages: MessageCatalog;
}

const defaultMessages: MessageCatalog = enMessages;
const hostLanguagePacks: Partial<Record<Locale, RuntimeLanguagePack>> = {
  en: {
    extensionId: ENGLISH_LANGUAGE_EXTENSION_ID,
    htmlLanguage: htmlLanguages.en,
    messages: defaultMessages,
  },
};

function hydrateLanguagePacks(packs: readonly ExtensionLanguagePackDto[]) {
  const hydrated: Partial<Record<Locale, RuntimeLanguagePack>> = { ...hostLanguagePacks };
  for (const pack of packs) {
    hydrated[pack.locale] = {
      extensionId: pack.extensionId,
      htmlLanguage: pack.htmlLanguage,
      messages: hydrateLanguageCatalog(pack.messages, defaultMessages),
    };
  }
  return hydrated;
}

let cachedLanguagePacks: readonly ExtensionLanguagePackDto[] | null = null;
let languagePackRefreshRequested = false;
let languagePackRefreshRunning: Promise<readonly ExtensionLanguagePackDto[]> | null = null;

function requestLanguagePacks(forceRefresh = false) {
  if (forceRefresh) cachedLanguagePacks = null;
  if (languagePackRefreshRunning) {
    if (forceRefresh) languagePackRefreshRequested = true;
    return languagePackRefreshRunning;
  }
  if (!forceRefresh && cachedLanguagePacks) return Promise.resolve(cachedLanguagePacks);
  languagePackRefreshRequested = true;
  languagePackRefreshRunning = (async () => {
    try {
      do {
        languagePackRefreshRequested = false;
        cachedLanguagePacks = await window.desktopApi.extensionLanguagePacksList();
      } while (languagePackRefreshRequested);
      return cachedLanguagePacks;
    } finally {
      languagePackRefreshRunning = null;
    }
  })();
  return languagePackRefreshRunning;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setActiveLocale] = useState<Locale>(initialLocale);
  const [extensions, setExtensions] = useState<readonly ExtensionDto[]>([]);
  const [languagePacks, setLanguagePacks] = useState(hostLanguagePacks);
  const [catalogReady, setCatalogReady] = useState(false);
  const messages = languagePacks[locale]?.messages ?? defaultMessages;
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
    const refreshLanguagePacks = async (forceRefresh = false) => {
      const requestRevision = ++revision;
      if (forceRefresh) setCatalogReady(false);
      try {
        const packs = await requestLanguagePacks(forceRefresh);
        if (disposed || requestRevision !== revision) return;
        setLanguagePacks(hydrateLanguagePacks(packs));
        setCatalogReady(getPublishedLanguagePluginState() !== null);
      } catch {
        if (disposed || requestRevision !== revision) return;
        setCatalogReady(false);
      }
    };

    const handleLanguagePluginsChanged = (event: Event) => {
      const detail = (event as CustomEvent<LanguagePluginStateEventDetail>).detail;
      setExtensions(detail.extensions);
      void refreshLanguagePacks(detail.reloadLanguagePacks);
    };
    window.addEventListener(LANGUAGE_PLUGIN_STATE_EVENT, handleLanguagePluginsChanged);
    const knownExtensions = getPublishedLanguagePluginState();
    if (knownExtensions) setExtensions(knownExtensions);
    void refreshLanguagePacks();
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
  useEffect(() => {
    // Do not publish the English fallback while the selected language pack is still loading.
    if (!languagePacks[locale]) return;
    void window.desktopApi.appShellSetLanguage({ locale, messages: messages.appShell }).catch((error) => {
      console.error('[i18n] Failed to synchronize application shell language', error);
    });
  }, [languagePacks, locale, messages.appShell]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
