import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ChevronDownIcon,
  FolderIcon,
  LanguagesIcon,
  PanelLeftIcon,
  PlusIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
} from 'lucide-react';
import type { Locale } from '@/shared/contracts';
import { I18nContext } from '@/renderer/i18n/I18nContext';
import { hydrateLanguageCatalog } from '@/renderer/i18n/languageCatalog';
import { enMessages } from '@/renderer/i18n/locales/en';
import { htmlLanguages } from '@/renderer/i18n/catalog';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Dialog, DialogContent, DialogTitle } from '@/renderer/components/ui/dialog';
import { cn } from '@/renderer/lib/utils';
import zhMessages from '../extensions/com.aiy.language.zh-cn/messages.json';
import { useThemeCreationModel, type ThemeModel } from './theme-creation-model';
import { InputProcessing } from './theme-creation-inputs';
import { OutputWorkspace } from './theme-creation-output';
import { IconButton } from './theme-creation-ui';
import './theme-creation.css';

const catalogs = { en: enMessages, zh: hydrateLanguageCatalog(zhMessages, enMessages) };
const neutralTokens = {
  '--button-primary': 'var(--sand-900)',
  '--button-primary-hover': 'var(--sand-950)',
  '--selected': 'var(--sand-200)',
  '--selected-foreground': 'var(--sand-900)',
  '--selected-border': 'var(--sand-500)',
  '--ring': 'var(--sand-700)',
  '--radius': '0.375rem',
} as CSSProperties;

function Topics({ model, afterSelect }: { model: ThemeModel; afterSelect(): void }) {
  const [query, setQuery] = useState('');
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-14 shrink-0 items-center px-3">
        <Button
          className="w-full justify-start"
          onClick={() => {
            model.newTopic();
            afterSelect();
          }}
        >
          <PlusIcon className="size-4" />
          {model.copy.newTopic}
        </Button>
      </div>
      <div className="px-3 py-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={model.copy.searchTopics}
          aria-label={model.copy.searchTopics}
          className="h-8 border-transparent bg-transparent text-xs"
        />
      </div>
      <div className="flex items-center gap-2 px-4 pb-3 pt-4 text-xs text-muted-foreground">
        <ChevronDownIcon className="size-3" />
        <FolderIcon className="size-3.5" />
        {model.copy.readAlbum}
      </div>
      <nav className="min-h-0 flex-1 space-y-1 overflow-auto px-2" aria-label={model.copy.topics}>
        {model.data.topics
          .filter((item) => item.title.toLowerCase().includes(query.toLowerCase()))
          .map((item) => {
            const pending = item.tasks.filter((task) => task.status === 'ready').length;
            return (
              <Button
                key={item.id}
                variant="ghost"
                aria-current={item.id === model.topic.id ? 'page' : undefined}
                className={cn(
                  'h-auto min-h-10 w-full justify-start gap-2 rounded-sm px-4 py-2 text-left font-normal',
                  item.id === model.topic.id && 'bg-surface-sunken font-semibold',
                )}
                onClick={() => {
                  model.selectTopic(item.id);
                  afterSelect();
                }}
              >
                <span className="min-w-0 flex-1 truncate">{item.title || model.copy.untitledTopic}</span>
                {pending > 0 && (
                  <span className="text-xs" aria-label={`${model.copy.ready} ${pending}`}>
                    {pending}
                  </span>
                )}
              </Button>
            );
          })}
      </nav>
      <div className="px-4 py-4 text-xs text-muted-foreground">
        {model.copy.topics} · {model.data.topics.length}
      </div>
    </div>
  );
}
function Prototype() {
  const model = useThemeCreationModel();
  const { locale, setLocale, messages } = useI18n();
  const [sidebar, setSidebar] = useState(false);
  const [inputOpen, setInputOpen] = useState(false);
  const [reset, setReset] = useState(false);
  function focusInputs() {
    setInputOpen(true);
    requestAnimationFrame(() => document.getElementById('prototype-requirement')?.focus());
  }
  return (
    <main
      className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background font-sans text-foreground"
      style={neutralTokens}
    >
      <header className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b px-4 py-1 text-xs">
        <span className="font-semibold">AIY</span>
        <span className="text-muted-foreground">/ {model.copy.prototype}</span>
        <span className="ml-auto hidden text-muted-foreground sm:inline">{model.copy.simulation}</span>
        <Button variant="ghost" size="xs" onClick={() => setReset(true)}>
          <RotateCcwIcon className="size-3" />
          {model.copy.reset}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          aria-label={messages.designLab.language}
          onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
        >
          <LanguagesIcon className="size-3.5" />
          {locale.toUpperCase()}
        </Button>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-52 shrink-0 border-r lg:block">
          <Topics model={model} afterSelect={() => undefined} />
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <div className="lg:hidden">
              <IconButton label={model.copy.topicToggle} onClick={() => setSidebar(true)}>
                <PanelLeftIcon className="size-4" />
              </IconButton>
            </div>
            <Input
              value={model.topic.title}
              aria-label={model.copy.topicName}
              onChange={(event) => model.renameTopic(event.target.value)}
              className="h-9 min-w-0 max-w-lg flex-1 border-0 bg-transparent px-1 text-base font-semibold shadow-none"
            />
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto xl:hidden"
              onClick={() => setInputOpen(!inputOpen)}
              aria-expanded={inputOpen}
            >
              <SlidersHorizontalIcon className="size-4" />
              {model.copy.inputToggle} {model.topic.preparation.inputs.length}
            </Button>
          </div>
          <div className="relative flex min-h-0 flex-1">
            <aside
              className={cn(
                'w-[310px] shrink-0 border-r xl:block',
                inputOpen
                  ? 'absolute inset-y-0 left-0 z-20 max-w-[90%] shadow-overlay xl:static xl:shadow-none'
                  : 'hidden',
              )}
            >
              <InputProcessing key={model.topic.id} model={model} />
            </aside>
            <OutputWorkspace model={model} showInputs={focusInputs} />
          </div>
        </div>
      </div>
      <footer className="flex h-7 shrink-0 items-center gap-3 border-t px-4 text-2xs text-muted-foreground">
        <span className="truncate" role="status">
          {model.notice || model.copy.simulation}
        </span>
        <span className="ml-auto hidden shrink-0 sm:inline">
          {model.topic.title} / {model.output.title}
        </span>
      </footer>
      <Dialog open={sidebar} onOpenChange={setSidebar}>
        <DialogContent className="flex h-[80dvh] max-w-xs flex-col gap-0 rounded-md p-0" aria-describedby={undefined}>
          <DialogTitle className="px-5 py-4 text-base">{model.copy.topics}</DialogTitle>
          <Topics model={model} afterSelect={() => setSidebar(false)} />
        </DialogContent>
      </Dialog>
      <Dialog open={reset} onOpenChange={setReset}>
        <DialogContent className="rounded-md" aria-describedby={undefined}>
          <DialogTitle>{model.copy.resetConfirm}</DialogTitle>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setReset(false)}>
              {model.copy.cancel}
            </Button>
            <Button
              onClick={() => {
                model.reset();
                setReset(false);
              }}
            >
              {model.copy.resetAction}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
function Root() {
  const [locale, setLocale] = useState<Locale>('zh');
  useEffect(() => {
    document.documentElement.lang = htmlLanguages[locale];
    document.title = catalogs[locale].designLab.themeCreation.title;
    Object.entries(neutralTokens).forEach(([key, value]) =>
      document.documentElement.style.setProperty(key, String(value)),
    );
  }, [locale]);
  const value = useMemo(
    () => ({ locale, setLocale, messages: catalogs[locale], availableLocales: ['zh', 'en'] as const }),
    [locale],
  );
  return (
    <I18nContext.Provider value={value}>
      <Prototype />
    </I18nContext.Provider>
  );
}
createRoot(document.getElementById('root')!).render(<Root />);
