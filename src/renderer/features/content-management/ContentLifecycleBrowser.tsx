import { AlertTriangleIcon, ChevronRightIcon, FileTextIcon, FolderIcon, LoaderCircleIcon } from 'lucide-react';
import type { ContentLifecycleItemDto, ContentLifecyclePageDto } from '@/shared/contracts';
import { ActionMenuButton, type ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { Button } from '@/renderer/components/ui/button';
import { MetaText } from '@/renderer/components/ui/meta-text';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import { StateTag } from '@/renderer/components/ui/state-tag';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import {
  lifecycleChangedAt,
  lifecycleExpiryLabel,
  lifecycleSubtypeLabel,
  lifecycleThumbnailUrl,
} from '@/renderer/features/content-management/contentLifecyclePresentation';

interface Props {
  albumStack: ContentLifecycleItemDto[];
  page: ContentLifecyclePageDto | null;
  loading: boolean;
  loadingMore: boolean;
  loadError: boolean;
  planningKey: string | null;
  emptyLabel: string;
  actionsFor(item: ContentLifecycleItemDto): ActionMenuAction[];
  onOpenAlbum(item: ContentLifecycleItemDto): void;
  onReturnToRoot(): void;
  onReturnToAlbum(index: number): void;
  onRetry(): void;
  onLoadMore(): void;
}

function itemKey(item: ContentLifecycleItemDto) {
  return `${item.entityType}:${item.entityId}`;
}

export function ContentLifecycleBrowser({
  albumStack,
  page,
  loading,
  loadingMore,
  loadError,
  planningKey,
  emptyLabel,
  actionsFor,
  onOpenAlbum,
  onReturnToRoot,
  onReturnToAlbum,
  onRetry,
  onLoadMore,
}: Props) {
  const { locale, messages } = useI18n();
  const l = messages.contentManagement;
  const rootAlbum = albumStack[0] ?? null;

  return (
    <>
      {albumStack.length > 0 && (
        <div className="flex h-11 shrink-0 items-center gap-1 border-b px-6">
          <Button type="button" variant="ghost" size="xs" className="px-2" onClick={onReturnToRoot}>
            {l.backToRoot}
          </Button>
          {albumStack.map((album, index) => (
            <div key={`${itemKey(album)}:${index}`} className="flex min-w-0 items-center gap-1">
              <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="min-w-0 px-2"
                disabled={index === albumStack.length - 1}
                onClick={() => onReturnToAlbum(index)}
              >
                <span className="truncate">{album.title}</span>
              </Button>
            </div>
          ))}
          {rootAlbum && (
            <ActionMenuButton actions={actionsFor(rootAlbum)} label={l.actions.label} className="ml-auto" />
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-5xl px-6 py-4">
          {loading && (
            <div className="divide-y border-y" aria-label={l.loading}>
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="flex h-[72px] items-center gap-3 px-3">
                  <Skeleton className="size-11" />
                  <div className="grid flex-1 gap-2">
                    <Skeleton className="h-3.5 w-48" />
                    <Skeleton className="h-3 w-28" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && loadError && !page && (
            <div className="grid justify-items-center gap-3 py-16">
              <strong className="text-sm font-medium">{l.loadFailed}</strong>
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                {l.retry}
              </Button>
            </div>
          )}

          {!loading && page?.items.length === 0 && (
            <div className="grid place-items-center py-16">
              <strong className="text-sm font-medium text-muted-foreground">{emptyLabel}</strong>
            </div>
          )}

          {!loading && page && page.items.length > 0 && (
            <div className="divide-y border-y">
              {page.items.map((item) => {
                const expiry = lifecycleExpiryLabel(item, messages);
                const isAlbum = item.kind === 'ALBUM' && Boolean(item.containerId);
                const showActions = albumStack.length === 0;
                return (
                  <div
                    key={`${itemKey(item)}:${item.expectedChangedAt}`}
                    className="grid min-h-[72px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-3 hover:bg-hover"
                  >
                    <button
                      type="button"
                      className={cn(
                        'flex min-w-0 items-center gap-3 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        !isAlbum && 'cursor-default',
                      )}
                      disabled={!isAlbum}
                      onClick={() => onOpenAlbum(item)}
                    >
                      <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-md bg-surface-sunken text-muted-foreground">
                        {item.previewAssetId ? (
                          <img
                            src={lifecycleThumbnailUrl(item.previewAssetId)}
                            alt=""
                            loading="lazy"
                            className="size-full bg-media-surround-light object-contain"
                          />
                        ) : item.kind === 'ALBUM' ? (
                          <FolderIcon className="size-5" />
                        ) : (
                          <FileTextIcon className="size-5" />
                        )}
                      </span>
                      <span className="grid min-w-0 gap-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <strong className="truncate text-sm font-medium">{item.title}</strong>
                          {isAlbum && <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />}
                        </span>
                        <span className="flex min-w-0 items-center gap-2">
                          <MetaText className="shrink-0">{lifecycleSubtypeLabel(item, messages)}</MetaText>
                          {item.previewText && <MetaText className="truncate">{item.previewText}</MetaText>}
                        </span>
                      </span>
                    </button>

                    <div className="flex items-center gap-3">
                      <div className="hidden min-w-24 justify-items-end gap-1 sm:grid">
                        <MetaText>{lifecycleChangedAt(item, locale)}</MetaText>
                        {item.purgeState === 'FAILED' ? (
                          <StateTag tone="danger" icon={<AlertTriangleIcon />} title={item.purgeError ?? undefined}>
                            {l.cleanupFailed}
                          </StateTag>
                        ) : expiry ? (
                          <MetaText>{expiry}</MetaText>
                        ) : null}
                      </div>
                      {showActions && <ActionMenuButton actions={actionsFor(item)} label={l.actions.label} />}
                      {planningKey?.endsWith(itemKey(item)) && (
                        <LoaderCircleIcon className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {page?.nextCursor && (
            <div className="flex justify-center py-4">
              <Button type="button" variant="outline" size="sm" disabled={loadingMore} onClick={onLoadMore}>
                {loadingMore && <LoaderCircleIcon className="size-3.5 animate-spin" />}
                {loadingMore ? l.loading : l.loadMore}
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
