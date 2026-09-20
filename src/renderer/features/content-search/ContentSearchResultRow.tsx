import { ChevronRightIcon, FileTextIcon, MessageSquareTextIcon, VideoIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ContentLookupResult } from '@/shared/contracts/content-search';
import { ContentSearchHighlight } from '@/renderer/features/content-search/ContentSearchHighlight';

const contentIcons = { ARTICLE: FileTextIcon, SOCIAL_POST: MessageSquareTextIcon, VIDEO_DOCUMENT: VideoIcon };

export function ContentSearchResultRow({
  item,
  disabled,
  terms,
  onSelect,
}: {
  item: ContentLookupResult['items'][number];
  disabled?: boolean;
  terms: readonly string[];
  onSelect(item: ContentLookupResult['items'][number]): void;
}) {
  const { locale, messages } = useI18n();
  const copy = messages.referenceOutline.lookup;
  const kind = item.source.kind === 'INSPIRATION_STASH' ? 'ARTICLE' : item.source.kind;
  const Icon = contentIcons[kind];
  const timestamp = new Date(item.updatedAt);
  const date = Number.isFinite(timestamp.getTime())
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(timestamp)
    : '';

  return (
    <div role="listitem">
      <Button
        type="button"
        variant="ghost"
        disabled={disabled}
        data-search-result={JSON.stringify([item.source.kind, item.source.id, item.source.branchId])}
        className="group h-auto w-full items-start justify-start gap-3 rounded-md px-3 py-3 text-left font-normal whitespace-normal focus-visible:bg-selected focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-border-strong focus-visible:ring-offset-0"
        onClick={() => onSelect(item)}
      >
        <Icon aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="min-w-0 flex-1 break-words text-sm font-medium">
              <ContentSearchHighlight text={item.title || copy.untitled} terms={terms} />
            </span>
            {date && (
              <time dateTime={item.updatedAt} className="shrink-0 text-2xs text-muted-foreground">
                {date}
              </time>
            )}
          </span>
          {item.preview && (
            <span className="line-clamp-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground-secondary">
              <ContentSearchHighlight text={item.preview} terms={terms} />
            </span>
          )}
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
            <span>{copy[kind]}</span>
            <span aria-hidden="true">·</span>
            <span>{copy[item.match]}</span>
            {!item.bodyIndexed && <span className="text-warning">{copy.titleOnly}</span>}
            {item.source.branchId && (
              <span className="max-w-40 truncate" title={item.source.branchId}>
                {copy.branch} {item.source.branchId}
              </span>
            )}
            <span className="ml-auto max-w-32 truncate font-mono" title={`${copy.identity}: ${item.source.id}`}>
              <ContentSearchHighlight text={item.source.id} terms={terms} />
            </span>
          </span>
        </span>
        <ChevronRightIcon
          aria-hidden="true"
          className="mt-0.5 size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </Button>
    </div>
  );
}
