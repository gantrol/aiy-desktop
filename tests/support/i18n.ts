import type { Locale } from '../../src/shared/contracts';
import { hydrateLanguageCatalog } from '../../src/renderer/i18n/languageCatalog';
import { enMessages } from '../../src/renderer/i18n/locales/en';
import zhSerializedMessages from '../../extensions/com.aiy.language.zh-cn/messages.json';

export const testMessages = {
  en: enMessages,
  zh: hydrateLanguageCatalog(zhSerializedMessages, enMessages),
} as const;

export function testI18nValue(locale: Locale) {
  return {
    locale,
    setLocale: () => undefined,
    messages: testMessages[locale],
    availableLocales: ['zh', 'en'] as const,
  };
}
