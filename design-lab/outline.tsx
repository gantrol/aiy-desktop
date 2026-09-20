import { createRoot } from 'react-dom/client';
import { I18nContext } from '@/renderer/i18n/I18nContext';
import { hydrateLanguageCatalog } from '@/renderer/i18n/languageCatalog';
import { enMessages } from '@/renderer/i18n/locales/en';
import zhMessages from '../extensions/com.aiy.language.zh-cn/messages.json';
import { AIYOutlineExample } from '@/renderer/features/content-editor/AIYOutlineExample';
import './style.css';
const locale = new URLSearchParams(location.search).get('locale') === 'en' ? 'en' : 'zh';
createRoot(document.getElementById('root')!).render(
  <I18nContext.Provider
    value={{
      locale,
      setLocale: (next) => {
        location.search = '?locale=' + next;
      },
      messages: hydrateLanguageCatalog(locale === 'zh' ? zhMessages : {}, enMessages),
      availableLocales: ['zh', 'en'],
    }}
  >
    <main className="mx-auto flex h-screen max-w-6xl flex-col gap-3 bg-background p-4 text-foreground sm:p-8">
      <header className="mb-1 shrink-0">
        <a className="text-xs text-muted-foreground underline-offset-4 hover:underline" href="./index.html">
          AIY Design Lab
        </a>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          {locale === 'zh' ? '从需求到验收' : 'From requirements to acceptance'}
        </h1>
      </header>
      <AIYOutlineExample />
    </main>
  </I18nContext.Provider>,
);
