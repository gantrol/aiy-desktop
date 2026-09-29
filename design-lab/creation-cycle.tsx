import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FileTextIcon, FolderIcon, ImagePlusIcon, LanguagesIcon } from 'lucide-react';
import type { Locale } from '@/shared/contracts';
import { I18nContext } from '@/renderer/i18n/I18nContext';
import { hydrateLanguageCatalog } from '@/renderer/i18n/languageCatalog';
import { htmlLanguages } from '@/renderer/i18n/catalog';
import { enMessages } from '@/renderer/i18n/locales/en';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import { AppSidebarButton } from '@/renderer/components/app/AppSidebarButton';
import { primaryNavigationItems } from '@/renderer/components/app/app-navigation-items';
import { WorkbenchNavigationPane } from '@/renderer/components/workbench/WorkbenchNavigationPane';
import { WorkbenchPaneHeader } from '@/renderer/components/workbench/WorkbenchPane';
import { cn } from '@/renderer/lib/utils';
import zhMessages from '../extensions/com.aiy.language.zh-cn/messages.json';
import { useCycleModel } from './creation-cycle-model';
import { MaterialBrowser } from './creation-cycle-materials';
import { WritingWorkspace } from './creation-cycle-workspace';
import './style.css';

const catalogs = { en: enMessages, zh: hydrateLanguageCatalog(zhMessages, enMessages) };

function CycleLab() {
  const model = useCycleModel();
  const { messages, locale, setLocale } = useI18n();
  const copy = model.copy;
  const [toggleHost, setToggleHost] = useState<HTMLDivElement | null>(null);
  return (
    <TooltipProvider>
      <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
        <header className="flex min-h-10 shrink-0 flex-wrap items-center gap-3 border-b px-4 py-1.5 text-xs">
          <a href="./index.html" className="font-semibold">
            AIY / Design Lab
          </a>
          <span>
            {copy.prototype} · {copy.title}
          </span>
          <span className="ml-auto text-muted-foreground">{copy.memoryOnly}</span>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setLocale(locale === 'en' ? 'zh' : 'en')}
            aria-label={messages.designLab.language}
          >
            <LanguagesIcon className="size-3.5" />
            {locale.toUpperCase()}
          </Button>
        </header>
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-14 shrink-0 flex-col items-center gap-2 border-r bg-muted py-3">
            <span className="mb-2 text-xs font-bold">AIY</span>
            {primaryNavigationItems.map(({ id, icon }) => (
              <AppSidebarButton
                key={id}
                icon={icon}
                label={messages.app.navigation[id]}
                disabled={id !== 'creator' && id !== 'gallery'}
                selected={id === (model.surface === 'materials' ? 'gallery' : 'creator')}
                onClick={() => model.setSurface(id === 'gallery' ? 'materials' : 'write')}
              />
            ))}
          </aside>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <WorkbenchPaneHeader className="h-11 gap-1">
              <div ref={setToggleHost} className="flex" />
              <Button
                variant={model.surface === 'write' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => {
                  model.setSurface('write');
                  model.setOperation(null);
                }}
              >
                <FileTextIcon className="size-3.5" />
                {model.title}
              </Button>
              <Button
                variant={model.surface === 'materials' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => model.setSurface('materials')}
              >
                {copy.materials}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void model.begin('image')}>
                <ImagePlusIcon className="size-3.5" />
                {copy.imageMaking}
              </Button>
            </WorkbenchPaneHeader>
            <div className="flex min-h-0 min-w-0 flex-1">
              <WorkbenchNavigationPane
                layoutKey="design-cycle-library"
                label={messages.creator.results.library}
                selectionKey={model.surface}
                initialWidth={220}
                minimumContentWidth={1000}
                toggleHost={toggleHost}
              >
                <WorkbenchPaneHeader>
                  <FolderIcon className="size-4" />
                  {messages.creator.results.library}
                </WorkbenchPaneHeader>
                <div className="space-y-1 p-2">
                  <Button
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={() => model.setSurface('materials')}
                  >
                    <FolderIcon className="size-4" />
                    {copy.materials}
                  </Button>
                  <Button
                    variant="secondary"
                    className="h-auto w-full justify-start whitespace-normal text-left"
                    onClick={() => {
                      model.setSurface('write');
                      model.setOperation(null);
                    }}
                  >
                    <FileTextIcon className="size-4" />
                    {model.title}
                  </Button>
                </div>
              </WorkbenchNavigationPane>
              <div className={cn('flex min-h-0 min-w-0 flex-1', model.surface !== 'write' && 'hidden')}>
                <WritingWorkspace model={model} />
              </div>
              {model.surface === 'materials' && (
                <MaterialBrowser model={model} onUse={() => model.setSurface('write')} />
              )}
            </div>
          </div>
        </div>
        {model.notice && (
          <div role="status" className="shrink-0 border-t px-4 py-2 text-xs">
            {model.notice}
          </div>
        )}
      </main>
    </TooltipProvider>
  );
}

function Root() {
  const [locale, setLocale] = useState<Locale>(
    new URLSearchParams(location.search).get('locale') === 'en' ? 'en' : 'zh',
  );
  const value = useMemo(
    () => ({ locale, setLocale, messages: catalogs[locale], availableLocales: ['zh', 'en'] as const }),
    [locale],
  );
  document.documentElement.lang = htmlLanguages[locale];
  return (
    <I18nContext.Provider value={value}>
      <CycleLab key={locale} />
    </I18nContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(<Root />);
