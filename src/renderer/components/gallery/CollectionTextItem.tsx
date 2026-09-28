import type { LucideIcon } from 'lucide-react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { formatDateTime } from '@/renderer/lib/dateFormat';
import { cn } from '@/renderer/lib/utils';

type TextItemLayout = 'grid' | 'list';
export type CollectionTextTone = 'pinned' | 'outline';

export function collectionTextItemClassName(layout: TextItemLayout = 'grid', tone?: CollectionTextTone) {
  return cn(
    'h-auto w-full min-w-0 items-stretch justify-start whitespace-normal text-left',
    layout === 'grid'
      ? 'rounded-none border-b border-border/65 px-0 pb-5 pt-1 hover:border-foreground/25 hover:bg-transparent'
      : 'min-h-24 rounded-none border-b border-border/60 px-3 py-4 hover:bg-hover/60',
    layout === 'grid' && tone === 'pinned' && 'rounded-sm border-0 bg-warning-surface/65 p-5 hover:bg-warning-surface',
    layout === 'grid' && tone === 'outline' && 'rounded-sm border-0 bg-success-surface/55 p-5 hover:bg-success-surface',
  );
}

/** The content is the preview: no cover rectangle or duplicate caption. */
export function CollectionTextItem({
  title,
  excerpt,
  outlineLines,
  detail,
  updatedAt,
  icon: Icon,
  layout = 'grid',
  tone,
}: {
  title: string;
  excerpt?: string;
  outlineLines?: readonly string[];
  detail: string;
  updatedAt?: string;
  icon: LucideIcon;
  layout?: TextItemLayout;
  tone?: CollectionTextTone;
}) {
  const { locale, messages } = useI18n();
  const grid = layout === 'grid';
  const date = updatedAt
    ? formatDateTime(updatedAt, locale, { ...(grid ? {} : { year: 'numeric' }), month: 'short', day: 'numeric' })
    : '';
  return (
    <span className={cn('flex min-w-0 flex-col gap-3', !grid && 'max-w-3xl gap-2 pr-8')}>
      <span
        className={cn(
          'flex min-w-0 items-center gap-1.5 pr-8 text-xs font-normal leading-4 text-muted-foreground',
          tone === 'pinned' && 'text-warning',
        )}
      >
        {tone === 'pinned' ? (
          <>
            <span className="shrink-0">{messages.creator.results.pinnedLabel}</span>
            <span aria-hidden="true">·</span>
          </>
        ) : (
          <Icon className="size-3.5" aria-hidden="true" />
        )}
        <span className="truncate">{detail}</span>
        {date && (
          <>
            <span aria-hidden="true">·</span>
            <time className="shrink-0 tabular-nums" dateTime={updatedAt} title={updatedAt}>
              {date}
            </time>
          </>
        )}
      </span>
      <span
        className={cn(
          'break-words font-semibold tracking-normal',
          grid ? 'line-clamp-4 text-[22px] leading-[1.45]' : 'line-clamp-2 text-lg leading-[26px]',
          grid && tone === 'pinned' && 'text-[28px] leading-[1.4]',
        )}
      >
        {title}
      </span>
      {grid && outlineLines?.length ? (
        <span className="flex flex-col gap-2 border-l border-success/25 pl-3 text-sm font-normal leading-6 text-foreground-secondary">
          {outlineLines.map((line, index) => (
            <span key={index} className="line-clamp-2 break-words">
              {line}
            </span>
          ))}
        </span>
      ) : (
        excerpt && (
          <span
            className={cn(
              'break-words text-sm font-normal leading-[1.8] text-foreground-secondary',
              grid ? 'line-clamp-4' : 'line-clamp-2',
            )}
          >
            {excerpt}
          </span>
        )
      )}
    </span>
  );
}
