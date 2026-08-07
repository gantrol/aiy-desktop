import { CheckIcon, SquareArrowOutUpRightIcon } from 'lucide-react';
import { useMemo } from 'react';
import type { CodexGeneratedImageDto } from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

export interface CodexImageTaskGroupData {
  threadId: string;
  threadName: string;
  threadTitleAvailable: boolean;
  images: CodexGeneratedImageDto[];
}

interface Props {
  group: CodexImageTaskGroupData;
  selectedIds: ReadonlySet<string>;
  busy: boolean;
  onToggleImage(image: CodexGeneratedImageDto): void;
  onSelectTask(images: readonly CodexGeneratedImageDto[]): void;
  onOpenCodex(threadId: string): void;
  onOpenCreation(seriesId: string, assetId: string | null): void;
}

const CODEX_THREAD_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function CodexImageTaskGroup({
  group,
  selectedIds,
  busy,
  onToggleImage,
  onSelectTask,
  onOpenCodex,
  onOpenCreation,
}: Props) {
  const { locale, messages } = useI18n();
  const l = messages.extensions.codexImageDiscovery;
  const selectableImages = group.images.filter((image) => image.importable && !image.imported);
  const selectionBatch = selectableImages.slice(0, 8);
  const batchSelected = selectionBatch.length > 0 && selectionBatch.every((image) => selectedIds.has(image.id));
  const selectedCount = group.images.filter((image) => selectedIds.has(image.id)).length;
  const canOpenCodex = group.threadTitleAvailable && CODEX_THREAD_ID_PATTERN.test(group.threadId);
  const displayName = group.threadTitleAvailable ? group.threadName : l.untitledTask;
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [locale],
  );

  return (
    <section data-codex-task-id={group.threadId} className="overflow-hidden rounded-lg border">
      <header className="flex min-w-0 flex-wrap items-center gap-2 border-b bg-surface-sunken/40 px-3 py-2">
        <div className="min-w-40 flex-1">
          <strong className="block truncate text-sm" title={displayName}>
            {displayName}
          </strong>
          {!group.threadTitleAvailable && (
            <span className="mt-0.5 block truncate font-mono text-2xs text-muted-foreground" title={group.threadId}>
              {group.threadId.slice(0, 8)}
            </span>
          )}
        </div>
        <Badge variant="secondary">{l.taskImages(group.images.length)}</Badge>
        {selectedCount > 0 && <Badge>{l.selected(selectedCount)}</Badge>}
        {canOpenCodex && (
          <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={() => onOpenCodex(group.threadId)}>
            <SquareArrowOutUpRightIcon className="size-3.5" />
            {l.actions.openCodex}
          </Button>
        )}
        {selectionBatch.length > 0 && (
          <Button
            type="button"
            variant={batchSelected ? 'secondary' : 'outline'}
            size="xs"
            disabled={busy}
            onClick={() => onSelectTask(selectionBatch)}
          >
            <CheckIcon className="size-3.5" />
            {batchSelected ? l.actions.clearTask : l.actions.selectTask(selectionBatch.length)}
          </Button>
        )}
      </header>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,20rem))] gap-3 p-3">
        {group.images.map((image) => {
          const selected = selectedIds.has(image.id);
          const selectable = image.importable && !image.imported;
          const opensCreation = image.imported && Boolean(image.importedSeriesId);
          const disabled = !selectable && !opensCreation;
          return (
            <button
              key={image.id}
              type="button"
              data-codex-discovery-id={image.id}
              aria-pressed={selectable ? selected : undefined}
              aria-label={
                opensCreation
                  ? `${l.actions.openCreation}: ${displayName} · SHA-256 ${image.sha256}`
                  : `${displayName} · SHA-256 ${image.sha256}`
              }
              disabled={disabled || busy}
              className={cn(
                'group overflow-hidden rounded-lg border bg-background text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                selected && 'border-selected-border bg-selected ring-1 ring-selected-border',
                disabled && 'opacity-65',
              )}
              onClick={() => {
                if (opensCreation) {
                  onOpenCreation(image.importedSeriesId!, image.importedAssetId);
                  return;
                }
                onToggleImage(image);
              }}
            >
              <span className="relative block aspect-square overflow-hidden bg-media-surround-light">
                <img
                  src={image.mediaUrl}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  className="size-full object-contain"
                />
                {selectable && (
                  <span
                    className={cn(
                      'absolute top-2 right-2 grid size-5 place-items-center rounded-full border bg-background/90 text-transparent shadow-overlay',
                      selected && 'border-selected-foreground bg-selected-foreground text-primary-foreground',
                    )}
                  >
                    <CheckIcon className="size-3.5" />
                  </span>
                )}
                {opensCreation && (
                  <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full border bg-background/90 shadow-overlay">
                    <SquareArrowOutUpRightIcon className="size-3.5" />
                  </span>
                )}
                {image.imported && (
                  <Badge className="absolute bottom-2 left-2" variant="secondary">
                    {l.imported}
                  </Badge>
                )}
              </span>
              <span className="flex min-w-0 items-center gap-2 p-3 text-xs text-muted-foreground">
                <span className="min-w-0 flex-1 truncate" title={`${image.fileName} · SHA-256 ${image.sha256}`}>
                  {image.fileName}
                </span>
                <time className="shrink-0" dateTime={image.modifiedAt}>
                  {dateFormatter.format(new Date(image.modifiedAt))}
                </time>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
