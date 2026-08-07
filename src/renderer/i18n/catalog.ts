import type { Locale } from '@/shared/contracts';

export const htmlLanguages: Record<Locale, string> = {
  zh: 'zh-CN',
  en: 'en',
};

export const languagePluginOrder: readonly Locale[] = ['zh', 'en'];

export type { DictionaryMessages, MessageCatalog, RecipeItemMessages } from '@/renderer/i18n/types';
