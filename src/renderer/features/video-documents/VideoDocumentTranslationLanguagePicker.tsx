import { CheckIcon, PlusIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

export const VIDEO_DOCUMENT_TRANSLATION_LOCALES = [
  'en',
  'zh-Hans',
  'zh-Hant',
  'ja',
  'ko',
  'es',
  'fr',
  'de',
  'pt-BR',
  'ru',
  'ar',
  'hi',
] as const;

function languageName(language: string, displayLocale: string) {
  try {
    return new Intl.DisplayNames([displayLocale], { type: 'language' }).of(language) ?? language;
  } catch {
    return language;
  }
}

interface Props {
  selected: readonly string[];
  disabled?: boolean;
  excluded?: ReadonlySet<string>;
  maxSelections?: number;
  ariaLabel: string;
  onChange(locales: string[]): void;
}

export function VideoDocumentTranslationLanguagePicker({
  selected,
  disabled = false,
  excluded = new Set(),
  maxSelections = 5,
  ariaLabel,
  onChange,
}: Props) {
  const { locale } = useI18n();
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={ariaLabel}>
      {VIDEO_DOCUMENT_TRANSLATION_LOCALES.filter((candidate) => !excluded.has(candidate)).map((candidate) => {
        const active = selected.includes(candidate);
        const selectionLimitReached = !active && selected.length >= maxSelections;
        return (
          <Button
            key={candidate}
            type="button"
            size="sm"
            variant={active ? 'secondary' : 'outline'}
            disabled={disabled || selectionLimitReached}
            aria-pressed={active}
            className={cn('rounded-full', active && 'border-selected-border bg-selected')}
            onClick={() =>
              onChange(
                active
                  ? selected.filter((item) => item !== candidate)
                  : [...selected, candidate].slice(0, maxSelections),
              )
            }
          >
            {active ? <CheckIcon className="size-3.5" /> : <PlusIcon className="size-3.5" />}
            {languageName(candidate, locale)}
          </Button>
        );
      })}
    </div>
  );
}
