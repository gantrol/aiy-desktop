import { FileTextIcon, FolderIcon, ImageIcon, LayersIcon, LoaderCircleIcon } from 'lucide-react';
import type { CreationFormProjection } from '@/renderer/components/creator/creationLibraryProjection';
import {
  creationFormPreviewAssetIds,
  creationFormTitle,
} from '@/renderer/components/creator/creationLibraryProjection';
import { albumContentKey, type AlbumContentEntry } from '@/renderer/components/creator/albumContentEntries';
import { writeAlbumDrag, writeCreationItemDrag, endCreationTreeDrag } from '@/renderer/components/albums/albumDrag';
import { TreeDragHandle } from '@/renderer/components/albums/TreeDragHandle';
import { AssetThumbnail } from '@/renderer/components/media/AssetThumbnail';
import { ActionMenuButton } from '@/renderer/components/ui/action-menu';
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

export interface AlbumContentsProps {
  entries: readonly AlbumContentEntry[];
  layout: 'list' | 'grid';
  busy: boolean;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore(): void;
  onSelectAlbum(albumId: string): void;
  onOpenCreationForm(form: CreationFormProjection): void;
  onSelectDocument(documentId: string, albumId: string | null): void;
  onOpenMaterial(materialId: string): void;
}

export function AlbumContents({ entries, layout, ...props }: AlbumContentsProps) {
  const { messages } = useI18n();
  const labels = messages.creator.album;
  const rows = entries.map((entry) => {
    switch (entry.kind) {
      case 'ALBUM':
        return {
          entry,
          title: entry.album.title,
          assetIds: entry.album.previewAssets.map((asset) => asset.id),
          forms: [],
          open: () => props.onSelectAlbum(entry.album.id),
          Icon: FolderIcon,
        };
      case 'CREATION':
        return {
          entry,
          title: entry.creation.title,
          assetIds: [...new Set(entry.creation.orderedForms.flatMap(creationFormPreviewAssetIds))],
          forms: entry.creation.orderedForms,
          open: () => {
            if (entry.creation.defaultForm) props.onOpenCreationForm(entry.creation.defaultForm);
          },
          Icon: LayersIcon,
        };
      case 'MATERIAL':
        return {
          entry,
          title: entry.member.materialText || messages.gallery.card.reference,
          assetIds: entry.member.imageAsset ? [entry.member.imageAsset.id] : [],
          forms: [],
          open: () => props.onOpenMaterial(entry.member.targetId),
          Icon: ImageIcon,
        };
      case 'DOCUMENT':
        return {
          entry,
          title: entry.document.title,
          assetIds: entry.document.thumbnail ? [entry.document.thumbnail.assetId] : [],
          forms: [],
          open: () => props.onSelectDocument(entry.document.id, entry.document.albumId),
          Icon: FileTextIcon,
        };
    }
  });

  return (
    <ScrollArea className="min-h-0 min-w-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
      <ul
        className={cn(
          layout === 'grid'
            ? 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,180px),1fr))] gap-4 p-4'
            : 'space-y-1 p-2',
        )}
      >
        {rows.map(({ entry, title, assetIds, forms, open, Icon }) => (
          <li
            key={albumContentKey(entry)}
            data-album-content-id={albumContentKey(entry)}
            className={cn(
              'group relative min-w-0 rounded-md hover:bg-hover',
              layout === 'list' && 'flex items-center gap-1',
            )}
          >
            <Button
              variant="ghost"
              className={cn(
                'h-auto min-w-0 justify-start whitespace-normal p-2 text-left',
                layout === 'grid' ? 'w-full flex-col items-stretch gap-2' : 'flex-1 gap-2',
              )}
              onClick={open}
              title={title}
            >
              <span
                className={cn(
                  'relative isolate grid shrink-0 place-items-center overflow-hidden rounded-sm bg-muted/30',
                  layout === 'grid' ? 'aspect-[4/3] w-full' : 'size-12',
                )}
              >
                {assetIds.length > 0 ? (
                  <AssetThumbnail
                    asset={{ id: assetIds[0]! }}
                    size={layout === 'grid' ? 320 : 96}
                    ambient
                    alt=""
                    className="absolute inset-0 size-full object-contain"
                  />
                ) : (
                  <Icon className="size-6 text-muted-foreground" />
                )}
                {entry.kind === 'ALBUM' && assetIds.length > 0 && (
                  <FolderIcon className="absolute bottom-1 right-1 z-20 size-5 rounded-sm bg-background p-0.5" />
                )}
              </span>
              <span className="line-clamp-2 min-w-0 flex-1 break-words text-sm font-medium">{title}</span>
            </Button>
            <div className={cn('flex shrink-0 items-center gap-1', layout === 'grid' && 'justify-end px-2 pb-1')}>
              {!props.busy && (entry.kind === 'ALBUM' || entry.kind === 'CREATION') && (
                <TreeDragHandle
                  className="bg-transparent shadow-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                  label={labels.dragContent(title)}
                  onDragStart={(event) => {
                    event.stopPropagation();
                    if (entry.kind === 'ALBUM') writeAlbumDrag(event.dataTransfer, entry.album.id);
                    else writeCreationItemDrag(event.dataTransfer, entry.creation.key);
                  }}
                  onDragEnd={endCreationTreeDrag}
                />
              )}
              {forms.length > 1 && (
                <ActionMenuButton
                  label={labels.openForms}
                  side="bottom"
                  align="end"
                  actions={forms.map((form) => ({
                    id: form.key,
                    icon: LayersIcon,
                    label: `${labels.formKinds[form.role]} · ${creationFormTitle(form, labels)}`,
                    onSelect: () => props.onOpenCreationForm(form),
                  }))}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
      {props.loading && rows.length === 0 ? (
        <div className="grid place-items-center p-6">
          <LoaderCircleIcon className="size-4 animate-spin" aria-label={messages.gallery.screen.loadingMore} />
        </div>
      ) : (
        rows.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">{labels.emptyAlbum}</div>
      )}
      {props.hasMore && (
        <div className="flex justify-center p-3">
          <Button variant="ghost" size="sm" disabled={props.loadingMore} onClick={props.onLoadMore}>
            {props.loadingMore && <LoaderCircleIcon className="size-3.5 animate-spin" />}
            {messages.videoDocuments.loadMore}
          </Button>
        </div>
      )}
    </ScrollArea>
  );
}
