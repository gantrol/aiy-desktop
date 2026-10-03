import { hydrateLanguageCatalog } from '@/renderer/i18n/languageCatalog';
import { enMessages } from '@/renderer/i18n/locales/en';
import zhMessages from '../../extensions/com.aiy.language.zh-cn/messages.json';

export const storyCatalogs = { en: enMessages, zh: hydrateLanguageCatalog(zhMessages, enMessages) };
