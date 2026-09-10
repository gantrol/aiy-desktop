import { createContext } from 'react';
import type { Locale } from '@/shared/contracts';
import type { MessageCatalog } from '@/renderer/i18n/catalog';

export interface I18nContextValue {
  locale: Locale;
  setLocale(locale: Locale): void;
  messages: MessageCatalog;
  availableLocales: readonly Locale[];
}
export const I18nContext = createContext<I18nContextValue | null>(null);
