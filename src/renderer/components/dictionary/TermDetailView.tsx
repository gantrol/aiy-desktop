import { useState } from 'react';
import { ArrowLeftIcon, CheckIcon, ImageIcon, PencilIcon, PlusIcon } from 'lucide-react';
import type { Locale, TermEditorDto, TermListItem, TermMediaItemDto } from '@/shared/contracts';
import { resolveTermContent } from '@/shared/term-localization';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Separator } from '@/renderer/components/ui/separator';

export interface TermDetailViewProps {
  term: TermEditorDto | TermListItem | null;
  locale: Locale;
  selected: boolean;
  loading?: boolean;
  error?: string;
  onRetry?(): void;
  onBack(): void;
  showBack?: boolean;
  onSelectedChange(selected: boolean, term: TermListItem): void;
  onEdit?(term: TermListItem): void;
  notify?(message: string): void;
  className?: string;
}

function isEditorTerm(term: TermEditorDto | TermListItem): term is TermEditorDto {
  return 'media' in term;
}

function mediaFor(term: TermEditorDto | TermListItem): TermMediaItemDto[] {
  const items = isEditorTerm(term) ? term.media : term.mediaPreview.items;
  return [...items].sort((left, right) => {
    if (left.role === right.role) return left.sortOrder - right.sortOrder;
    return left.role === 'COVER' ? -1 : 1;
  });
}

export function TermDetailView({
  term,
  locale,
  selected,
  loading = false,
  error = '',
  onRetry,
  onBack,
  showBack = true,
  onSelectedChange,
  onEdit,
  notify = () => undefined,
  className,
}: TermDetailViewProps) {
  const { messages } = useI18n();
  const copy = messages.dictionary.detail;
  const [mediaSelection, setMediaSelection] = useState<{ termId: string; mediaId: string } | null>(null);

  if (!term) {
    return (
      <section className={cn('flex min-h-0 flex-col bg-background', className)} data-term-detail>
        <header className="flex min-h-16 shrink-0 items-center border-b px-4 sm:px-6">
          {showBack && (
            <Button data-action="term-detail-back" type="button" variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeftIcon className="size-4" />
              {copy.back}
            </Button>
          )}
        </header>
        <div className="grid min-h-0 flex-1 place-items-center px-6 text-sm text-muted-foreground">
          <div className="grid justify-items-center gap-3 text-center">
            <p>{loading ? copy.opening : error || copy.selectTerm}</p>
            {error && onRetry && (
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                {copy.retry}
              </Button>
            )}
          </div>
        </div>
      </section>
    );
  }

  const content = resolveTermContent(term, locale);
  const media = mediaFor(term);
  const activeMediaId = mediaSelection?.termId === term.id ? mediaSelection.mediaId : media[0]?.id;
  const activeMedia = media.find((item) => item.id === activeMediaId) ?? media[0];
  const totalMediaCount = isEditorTerm(term) ? term.media.length : term.mediaPreview.totalCount;
  const alternateContent = [
    ...(content.locale === term.titleLocale
      ? []
      : [{ locale: term.titleLocale, title: term.title, definition: term.definition, aliases: term.aliases }]),
    ...term.localizations.filter((item) => item.locale !== content.locale),
  ];

  return (
    <section
      className={cn('flex min-h-0 flex-col overflow-hidden bg-background', className)}
      data-term-detail
      data-term-id={term.id}
    >
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b px-4 sm:px-6">
        {showBack ? (
          <Button data-action="term-detail-back" type="button" variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeftIcon className="size-4" />
            {copy.back}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {onEdit && (
            <Button
              data-action="term-detail-edit"
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onEdit(term)}
            >
              <PencilIcon className="size-3.5" />
              {copy.edit}
            </Button>
          )}
          <Button
            data-action="term-detail-select"
            type="button"
            variant={selected ? 'secondary' : 'default'}
            size="sm"
            aria-pressed={selected}
            onClick={() => onSelectedChange(!selected, term)}
          >
            {selected ? <CheckIcon className="size-4" /> : <PlusIcon className="size-4" />}
            {selected ? copy.selected : copy.select}
          </Button>
        </div>
      </header>

      <ScrollArea type="always" className="min-h-0 flex-1 [&_[data-slot=scroll-area-scrollbar]]:opacity-100">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-6 lg:grid-cols-[minmax(280px,0.9fr)_minmax(340px,1.1fr)] lg:px-8 lg:py-8">
          <div className="min-w-0">
            {activeMedia ? (
              <AssetFileContextMenu
                assetId={activeMedia.asset.id}
                notify={notify}
                revealContext={{ kind: 'TERM', termId: term.id }}
              >
                <div className="relative mx-auto w-fit max-w-full overflow-hidden rounded-2xl border bg-media-surround-light">
                  <img
                    data-term-detail-media
                    className="block h-auto max-h-[680px] w-auto max-w-full"
                    src={activeMedia.asset.mediaUrl}
                    alt={`${content.title} · ${copy.referenceImage}`}
                    draggable={false}
                    width={activeMedia.asset.width}
                    height={activeMedia.asset.height}
                  />
                  {totalMediaCount > 1 && (
                    <Badge variant="secondary" className="absolute right-3 bottom-3 bg-overlay shadow-overlay">
                      {media.findIndex((item) => item.id === activeMedia.id) + 1} / {totalMediaCount}
                    </Badge>
                  )}
                </div>
              </AssetFileContextMenu>
            ) : (
              <div className="grid min-h-72 place-items-center rounded-2xl border bg-media-surround-light">
                <div className="grid justify-items-center gap-3 text-sm text-muted-foreground">
                  <ImageIcon className="size-7" />
                  {copy.noReferenceImage}
                </div>
              </div>
            )}
            {media.length > 1 && (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {media.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    className={cn(
                      'h-20 w-16 shrink-0 overflow-hidden rounded-lg border bg-media-surround-light',
                      item.id === activeMedia?.id && 'border-selected-border ring-2 ring-ring',
                    )}
                    aria-label={`${copy.referenceImage} ${index + 1}`}
                    onClick={() => setMediaSelection({ termId: term.id, mediaId: item.id })}
                  >
                    <img className="size-full object-contain" src={item.asset.mediaUrl} alt="" draggable={false} />
                  </button>
                ))}
              </div>
            )}
          </div>

          <article className="min-w-0 self-start">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-semibold tracking-tight text-balance">{content.title}</h1>
              <Badge variant="outline">{content.locale}</Badge>
            </div>
            <p
              className={cn(
                'mt-4 whitespace-pre-wrap text-base leading-7',
                !content.definition && 'text-muted-foreground',
              )}
            >
              {content.definition || copy.noDefinition}
            </p>
            {term.classifications.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {term.classifications.map((classification) => (
                  <Badge key={classification.id} variant="secondary">
                    {classification.name}
                  </Badge>
                ))}
              </div>
            )}

            <Separator className="my-6" />

            <section>
              <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                {copy.modelExpressions}
              </h2>
              <div className="mt-3 grid gap-3">
                {term.modelExpressions.map((expression) => (
                  <div key={expression.id} className="rounded-xl border bg-muted/35 p-4">
                    <div className="mb-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                      <span>{expression.contextKey}</span>
                      <span>·</span>
                      <span>{expression.modelKey}</span>
                      <span>·</span>
                      <span>{expression.locale}</span>
                    </div>
                    <p className="whitespace-pre-wrap break-words font-mono text-xs leading-6">
                      {expression.positive || copy.noPositiveExpression}
                    </p>
                    {expression.negative && (
                      <p className="mt-3 whitespace-pre-wrap break-words border-t pt-3 font-mono text-xs leading-6 text-muted-foreground">
                        {expression.negative}
                      </p>
                    )}
                  </div>
                ))}
                {!term.modelExpressions.length && (
                  <p className="text-sm text-muted-foreground">{copy.noModelExpression}</p>
                )}
              </div>
            </section>

            {(content.aliases.length > 0 || alternateContent.length > 0) && (
              <section className="mt-7 rounded-xl border p-4">
                {content.aliases.length > 0 && (
                  <div>
                    <h2 className="text-xs font-medium text-muted-foreground">{copy.aliases}</h2>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {content.aliases.map((alias) => (
                        <Badge key={alias} variant="secondary">
                          {alias}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {alternateContent.map((item) => (
                  <div key={item.locale} className="mt-4 border-t pt-4">
                    <div className="flex items-center gap-2">
                      <h2 className="font-medium">{item.title}</h2>
                      <Badge variant="outline">{item.locale}</Badge>
                    </div>
                    {item.definition && (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.definition}</p>
                    )}
                  </div>
                ))}
              </section>
            )}
          </article>
        </div>
      </ScrollArea>
    </section>
  );
}
