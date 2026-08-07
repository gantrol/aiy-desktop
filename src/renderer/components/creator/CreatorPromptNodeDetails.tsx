import { ExternalLinkIcon, SlidersHorizontalIcon, Trash2Icon } from 'lucide-react';
import type { Locale } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { PopoverContent } from '@/renderer/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';

interface PromptLanguageSelectProps {
  locale: Locale;
  value: Locale;
  onChange(value: Locale): void;
}

function PromptLanguageSelect({ locale, value, onChange }: PromptLanguageSelectProps) {
  const label = locale === 'zh' ? '提示词语言' : 'Prompt language';
  return (
    <div className="flex items-center justify-between gap-3 border-t pt-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={(next) => onChange(next as Locale)}>
        <SelectTrigger className="h-8 w-28 text-xs" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="zh">{locale === 'zh' ? '中文' : 'Chinese'}</SelectItem>
          <SelectItem value="en">{locale === 'zh' ? '英文' : 'English'}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

interface CreatorTermNodeDetailsProps {
  locale: Locale;
  label: string;
  secondaryName: string;
  promptFragment: string;
  promptLocale: Locale;
  onPromptLocaleChange(value: Locale): void;
  onOpen(): void;
  onRemove(): void;
}

export function CreatorTermNodeDetails({
  locale,
  label,
  secondaryName,
  promptFragment,
  promptLocale,
  onPromptLocaleChange,
  onOpen,
  onRemove,
}: CreatorTermNodeDetailsProps) {
  return (
    <PopoverContent
      align="start"
      className="w-80 p-3"
      onOpenAutoFocus={(event) => event.preventDefault()}
      onCloseAutoFocus={(event) => event.preventDefault()}
    >
      <div className="grid gap-3">
        <header className="min-w-0">
          <strong className="block truncate text-sm">{label}</strong>
          {secondaryName && secondaryName !== label && (
            <span className="block truncate text-xs text-muted-foreground">{secondaryName}</span>
          )}
        </header>
        {promptFragment && (
          <p className="max-h-28 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-foreground-secondary">
            {promptFragment}
          </p>
        )}
        <PromptLanguageSelect locale={locale} value={promptLocale} onChange={onPromptLocaleChange} />
        <div className="flex items-center gap-1 border-t pt-2">
          <Button type="button" variant="ghost" size="sm" onClick={onOpen}>
            <ExternalLinkIcon className="size-3.5" />
            {locale === 'zh' ? '查看词条' : 'View term'}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="ml-auto text-destructive" onClick={onRemove}>
            <Trash2Icon className="size-3.5" />
            {locale === 'zh' ? '移除' : 'Remove'}
          </Button>
        </div>
      </div>
    </PopoverContent>
  );
}

interface RecipeParameter {
  id: string;
  name: string;
  value: string;
}

interface CreatorRecipeNodeDetailsProps {
  locale: Locale;
  label: string;
  version: number;
  promptLocale: Locale;
  parameters: RecipeParameter[];
  onPromptLocaleChange(value: Locale): void;
  onConfigure(): void;
  onOpen(): void;
  onRemove(): void;
}

export function CreatorRecipeNodeDetails({
  locale,
  label,
  version,
  promptLocale,
  parameters,
  onPromptLocaleChange,
  onConfigure,
  onOpen,
  onRemove,
}: CreatorRecipeNodeDetailsProps) {
  return (
    <PopoverContent
      align="start"
      className="w-96 p-3"
      onOpenAutoFocus={(event) => event.preventDefault()}
      onCloseAutoFocus={(event) => event.preventDefault()}
    >
      <div className="grid gap-3">
        <header>
          <strong className="text-sm">{label}</strong>
          <span className="ml-2 text-[11px] text-muted-foreground">
            V{version} · {promptLocale.toUpperCase()}
          </span>
        </header>
        {parameters.length > 0 && (
          <div className="grid gap-1.5">
            {parameters.map((parameter) => (
              <div key={parameter.id} className="flex items-baseline justify-between gap-4 text-xs">
                <span className="text-muted-foreground">{parameter.name}</span>
                <span className="text-right">{parameter.value}</span>
              </div>
            ))}
          </div>
        )}
        <PromptLanguageSelect locale={locale} value={promptLocale} onChange={onPromptLocaleChange} />
        <div className="flex items-center gap-1 border-t pt-2">
          <Button type="button" variant="secondary" size="sm" onClick={onConfigure}>
            <SlidersHorizontalIcon className="size-3.5" />
            {locale === 'zh' ? '调整参数' : 'Parameters'}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onOpen}>
            <ExternalLinkIcon className="size-3.5" />
            {locale === 'zh' ? '查看配方' : 'View recipe'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="ml-auto text-destructive"
            aria-label={locale === 'zh' ? '移除配方' : 'Remove recipe'}
            onClick={onRemove}
          >
            <Trash2Icon className="size-3.5" />
          </Button>
        </div>
      </div>
    </PopoverContent>
  );
}
