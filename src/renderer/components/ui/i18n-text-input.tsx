import { ChevronDownIcon, LanguagesIcon, PlusIcon, XIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { Input } from '@/renderer/components/ui/input';
import { cn } from '@/renderer/lib/utils';

export interface I18nTextTranslation {
  locale: string;
  value: string;
}

interface I18nTextInputLabels {
  language: string;
  value: string;
  addLanguage: string;
  removeLanguage: string;
  expandLanguages: string;
  collapseLanguages: string;
}

interface I18nTextInputProps {
  value: string;
  locale: string;
  translations: readonly I18nTextTranslation[];
  labels: I18nTextInputLabels;
  placeholder?: string;
  localeOptions?: readonly string[];
  valueInputId?: string;
  localeInputId?: string;
  valueMaxLength?: number;
  autoFocus?: boolean;
  className?: string;
  onValueChange(value: string): void;
  onLocaleChange(locale: string): void;
  onTranslationsChange(translations: I18nTextTranslation[]): void;
}

const defaultLocaleOptions = ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'ru', 'ar'] as const;

const localeKey = (locale: string) => locale.trim().toLocaleLowerCase();

function showLocalePicker(input: HTMLInputElement) {
  try {
    input.showPicker();
  } catch {
    input.focus();
  }
}

export function isI18nTextValueValid(value: string, locale: string, translations: readonly I18nTextTranslation[]) {
  if (!value.trim() || !locale.trim()) return false;
  const locales = new Set([localeKey(locale)]);
  for (const translation of translations) {
    const key = localeKey(translation.locale);
    if (!key || !translation.value.trim() || locales.has(key)) return false;
    locales.add(key);
  }
  return true;
}

export function I18nTextInput({
  value,
  locale,
  translations,
  labels,
  placeholder,
  localeOptions = defaultLocaleOptions,
  valueInputId,
  localeInputId,
  valueMaxLength,
  autoFocus,
  className,
  onValueChange,
  onLocaleChange,
  onTranslationsChange,
}: I18nTextInputProps) {
  const listId = `i18n-text-locales-${useId().replaceAll(':', '')}`;
  const [open, setOpen] = useState(translations.length === 0);
  const localeInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const valueInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const pendingFocusRef = useRef<{ kind: 'locale'; index: number } | { kind: 'add' } | null>(null);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    if (pending.kind === 'locale') localeInputRefs.current[pending.index]?.focus();
    else addButtonRef.current?.focus();
  }, [open, translations.length]);

  const updateTranslation = (index: number, patch: Partial<I18nTextTranslation>) => {
    onTranslationsChange(
      translations.map((translation, translationIndex) =>
        translationIndex === index ? { ...translation, ...patch } : translation,
      ),
    );
  };

  const addTranslation = () => {
    const index = translations.length;
    pendingFocusRef.current = { kind: 'locale', index };
    setOpen(true);
    onTranslationsChange([...translations, { locale: '', value: '' }]);
  };

  const removeTranslation = (index: number) => {
    pendingFocusRef.current = { kind: 'add' };
    onTranslationsChange(translations.filter((_, translationIndex) => translationIndex !== index));
  };

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-i18n-text-input
      className={cn(
        'overflow-hidden rounded-md border border-input bg-background transition-colors duration-fast hover:border-border-strong focus-within:border-ring',
        className,
      )}
    >
      <div className="grid min-h-9 grid-cols-[4.5rem_minmax(0,1fr)_2.25rem] items-stretch">
        <div className="relative min-w-0 border-r">
          {!locale && (
            <>
              <LanguagesIcon
                aria-hidden="true"
                className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-foreground"
              />
              <ChevronDownIcon
                aria-hidden="true"
                className="pointer-events-none absolute right-1.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground"
              />
            </>
          )}
          <Input
            id={localeInputId}
            value={locale}
            list={listId}
            maxLength={64}
            aria-label={labels.language}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className={cn(
              'h-9 rounded-none border-0 bg-transparent py-0 font-mono text-xs text-muted-foreground hover:border-transparent focus-visible:z-10 focus-visible:border-transparent focus-visible:ring-offset-0',
              locale ? 'px-2' : 'pl-7 pr-6',
            )}
            onClick={(event) => showLocalePicker(event.currentTarget)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown') return;
              event.preventDefault();
              showLocalePicker(event.currentTarget);
            }}
            onChange={(event) => onLocaleChange(event.target.value)}
          />
        </div>
        <Input
          id={valueInputId}
          value={value}
          maxLength={valueMaxLength}
          autoFocus={autoFocus}
          aria-label={labels.value}
          placeholder={placeholder}
          className="h-9 rounded-none border-0 bg-transparent px-3 hover:border-transparent focus-visible:z-10 focus-visible:border-transparent focus-visible:ring-offset-0"
          onChange={(event) => onValueChange(event.target.value)}
        />
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={open ? labels.collapseLanguages : labels.expandLanguages}
            className="size-9 rounded-none border-l text-muted-foreground"
          >
            <ChevronDownIcon className={cn('size-3.5 transition-transform duration-fast', !open && '-rotate-90')} />
          </Button>
        </CollapsibleTrigger>
      </div>

      <datalist id={listId}>
        {localeOptions.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>

      <CollapsibleContent>
        {translations.map((translation, index) => (
          <div
            key={index}
            data-i18n-translation={index}
            className="grid min-h-9 grid-cols-[4.5rem_minmax(0,1fr)_2.25rem] items-stretch border-t"
          >
            <div className="relative min-w-0 border-r">
              {!translation.locale && (
                <>
                  <LanguagesIcon
                    aria-hidden="true"
                    className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-foreground"
                  />
                  <ChevronDownIcon
                    aria-hidden="true"
                    className="pointer-events-none absolute right-1.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground"
                  />
                </>
              )}
              <Input
                ref={(element) => {
                  localeInputRefs.current[index] = element;
                }}
                value={translation.locale}
                list={listId}
                maxLength={64}
                aria-label={labels.language}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className={cn(
                  'h-9 rounded-none border-0 bg-transparent py-0 font-mono text-xs text-muted-foreground hover:border-transparent focus-visible:z-10 focus-visible:border-transparent focus-visible:ring-offset-0',
                  translation.locale ? 'px-2' : 'pl-7 pr-6',
                )}
                onClick={(event) => showLocalePicker(event.currentTarget)}
                onChange={(event) => updateTranslation(index, { locale: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    showLocalePicker(event.currentTarget);
                    return;
                  }
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  valueInputRefs.current[index]?.focus();
                }}
              />
            </div>
            <Input
              ref={(element) => {
                valueInputRefs.current[index] = element;
              }}
              value={translation.value}
              maxLength={valueMaxLength}
              aria-label={labels.value}
              placeholder={placeholder}
              className="h-9 rounded-none border-0 bg-transparent px-3 hover:border-transparent focus-visible:z-10 focus-visible:border-transparent focus-visible:ring-offset-0"
              onChange={(event) => updateTranslation(index, { value: event.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={labels.removeLanguage}
              className="size-9 rounded-none border-l text-muted-foreground hover:text-foreground"
              onClick={() => removeTranslation(index)}
            >
              <XIcon className="size-3.5" />
            </Button>
          </div>
        ))}
        <Button
          ref={addButtonRef}
          type="button"
          variant="ghost"
          size="sm"
          aria-label={labels.addLanguage}
          className="h-8 w-full justify-start rounded-none border-t px-[1.75rem] text-muted-foreground hover:text-foreground"
          onClick={addTranslation}
        >
          <PlusIcon className="size-3.5" />
        </Button>
      </CollapsibleContent>
    </Collapsible>
  );
}
