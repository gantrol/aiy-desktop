import { FileTextIcon, FolderIcon, ImageIcon, LayersIcon, LoaderCircleIcon, type LucideIcon } from 'lucide-react';
import { useMemo, useRef } from 'react';
import {
  creationFormPreviewAssets,
  creationFormTitle,
  type CreationFormProjection,
  type CreationPreviewAsset,
} from '@/renderer/components/creator/creationLibraryProjection';
import { albumContentKey, type AlbumContentEntry } from '@/renderer/components/creator/albumContentEntries';
import { writeAlbumDrag, writeCreationItemDrag, endCreationTreeDrag } from '@/renderer/components/albums/albumDrag';
import { AlbumCoverStack } from '@/renderer/components/albums/AlbumCoverStack';
import { AlbumPreviewPopover } from '@/renderer/components/albums/AlbumPreviewPopover';
import { albumCoverAssets, type AlbumCoverAsset } from '@/renderer/components/albums/albumCoverAssets';
import { TreeDragHandle } from '@/renderer/components/albums/TreeDragHandle';
import { CollectionMasonry, collectionCoverRatio } from '@/renderer/components/gallery/CollectionMasonry';
import { CollectionPreview } from '@/renderer/components/gallery/CollectionPreview';
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

interface AlbumContentRow {
  entry: AlbumContentEntry;
  title: string;
  kindLabel: string;
  preview?: CreationPreviewAsset | null;
  covers?: readonly AlbumCoverAsset[];
  forms: readonly CreationFormProjection[];
  Icon: LucideIcon;
}

function AlbumContentCard({ row, layout, ...props }: Omit<AlbumContentsProps, 'entries'> & { row: AlbumContentRow }) {
  const { messages } = useI18n();
  const labels = messages.creator.album;
  const { entry, title, kindLabel, preview, forms, covers = [], Icon } = row;
  const grid = layout === 'grid';
  const canDrag = !props.busy && (entry.kind === 'ALBUM' || entry.kind === 'CREATION');
  const hasMenu = forms.length > 1;
  const hasPreview = covers.length > 0;
  function open() {
    switch (entry.kind) {
      case 'ALBUM':
        props.onSelectAlbum(entry.album.id);
        break;
      case 'CREATION':
        if (entry.creation.defaultForm) props.onOpenCreationForm(entry.creation.defaultForm);
        break;
      case 'MATERIAL':
        props.onOpenMaterial(entry.member.targetId);
        break;
      case 'DOCUMENT':
        props.onSelectDocument(entry.document.id, entry.document.albumId);
        break;
    }
  }
  return (
    <article
      data-album-content-id={albumContentKey(entry)}
      className={cn(
        'group relative min-w-0',
        grid ? 'flex h-full flex-col' : 'flex items-center gap-1 rounded-sm hover:bg-hover',
      )}
    >
      <Button
        variant="ghost"
        className={cn(
          'min-w-0 justify-start whitespace-normal rounded-sm text-left',
          grid
            ? 'min-h-0 w-full flex-1 flex-col items-stretch gap-0 p-0 hover:bg-transparent'
            : 'h-auto flex-1 gap-2 p-2',
        )}
        onClick={open}
        title={title}
        aria-label={title}
      >
        {grid ? (
          covers.length || entry.kind === 'ALBUM' ? (
            <AlbumCoverStack assets={covers} title={title} icon={Icon} />
          ) : (
            <CollectionPreview asset={preview} title={title} icon={Icon} />
          )
        ) : covers.length ? (
          <AlbumCoverStack assets={covers} title={title} icon={Icon} compact className="size-12 flex-none" />
        ) : (
          <span className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-sm bg-surface-sunken">
            {preview ? (
              <AssetThumbnail asset={preview} size={96} alt="" className="absolute inset-0 size-full object-contain" />
            ) : (
              <Icon className="size-5 text-muted-foreground" />
            )}
          </span>
        )}
        <span className={cn('min-w-0', grid ? 'flex h-13 shrink-0 flex-col justify-center px-1' : 'flex-1')}>
          <span className={cn('text-sm font-medium', grid ? 'block truncate' : 'line-clamp-2 break-words')}>
            {title}
          </span>
          <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground" title={kindLabel}>
            {kindLabel}
          </span>
        </span>
      </Button>
      {(canDrag || hasMenu || hasPreview) && (
        <div className={cn('flex shrink-0 items-center gap-1', grid && 'flex-wrap justify-end')}>
          {hasPreview && (
            <AlbumPreviewPopover
              assets={covers}
              title={title}
              openLabel={entry.kind === 'CREATION' ? labels.open : messages.gallery.albums.open}
              onOpen={open}
            />
          )}
          {canDrag && (
            <TreeDragHandle
              className="rounded-sm bg-transparent shadow-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
              label={labels.dragContent(title)}
              onDragStart={(event) => {
                event.stopPropagation();
                if (entry.kind === 'ALBUM') writeAlbumDrag(event.dataTransfer, entry.album.id);
                else if (entry.kind === 'CREATION') writeCreationItemDrag(event.dataTransfer, entry.creation.key);
              }}
              onDragEnd={endCreationTreeDrag}
            />
          )}
          {hasMenu && (
            <ActionMenuButton
              label={labels.openForms}
              className="size-7 rounded-sm shadow-none"
              side="bottom"
              align="end"
              actions={forms.map((form) => ({
                id: form.key,
                icon: LayersIcon,
                label: labels.formKinds[form.role] + ' · ' + creationFormTitle(form, labels),
                onSelect: () => props.onOpenCreationForm(form),
              }))}
            />
          )}
        </div>
      )}
    </article>
  );
}

export function AlbumContents({ entries, layout, ...props }: AlbumContentsProps) {
  const { messages } = useI18n();
  const labels = messages.creator.album;
  const viewportRef = useRef<HTMLDivElement>(null);
  const referenceLabel = messages.gallery.card.reference;
  const rows = useMemo<AlbumContentRow[]>(
    () =>
      entries.map((entry) => {
        switch (entry.kind) {
          case 'ALBUM':
            return {
              entry,
              title: entry.album.title,
              kindLabel: labels.albumLabel,
              preview: entry.album.previewAssets[0] ?? entry.album.documentPreviewAssets?.[0],
              covers: albumCoverAssets([...entry.album.previewAssets, ...(entry.album.documentPreviewAssets ?? [])]),
              forms: [],
              Icon: FolderIcon,
            };
          case 'CREATION':
            return {
              entry,
              title: entry.creation.title,
              kindLabel: entry.creation.defaultForm
                ? labels.formKinds[entry.creation.defaultForm.role]
                : labels.creations,
              preview: entry.creation.orderedForms.flatMap(creationFormPreviewAssets)[0],
              covers: albumCoverAssets(entry.creation.orderedForms.flatMap(creationFormPreviewAssets)),
              forms: entry.creation.orderedForms,
              Icon: LayersIcon,
            };
          case 'MATERIAL':
            return {
              entry,
              title: entry.member.materialText || referenceLabel,
              kindLabel: labels.materials,
              preview: entry.member.imageAsset,
              forms: [],
              Icon: ImageIcon,
            };
          case 'DOCUMENT':
            return {
              entry,
              title: entry.document.title,
              kindLabel: labels.formKinds.VIDEO_DOCUMENT,
              preview: entry.document.thumbnail
                ? {
                    id: entry.document.thumbnail.assetId,
                    width: entry.document.thumbnail.width,
                    height: entry.document.thumbnail.height,
                  }
                : null,
              forms: [],
              Icon: FileTextIcon,
            };
        }
      }),
    [entries, labels, referenceLabel],
  );
  const layoutItems = useMemo(
    () => rows.map((row) => ({ id: albumContentKey(row.entry), aspectRatio: collectionCoverRatio(row.preview) })),
    [rows],
  );

  return (
    <ScrollArea
      viewportRef={viewportRef}
      className="min-h-0 min-w-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!w-full"
    >
      {layout === 'grid' ? (
        <div data-slot="album-contents-masonry" className="p-4">
          <CollectionMasonry
            items={layoutItems}
            viewportRef={viewportRef}
            renderItem={(_item, index) => <AlbumContentCard row={rows[index]} layout={layout} {...props} />}
          />
        </div>
      ) : (
        <ul className="space-y-1 p-2">
          {rows.map((row) => (
            <li key={albumContentKey(row.entry)}>
              <AlbumContentCard row={row} layout={layout} {...props} />
            </li>
          ))}
        </ul>
      )}
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
