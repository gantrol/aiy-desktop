import { ImageIcon, LoaderCircleIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type {
  AlbumDto,
  AlbumMemberDto,
  AssetDto,
  GalleryItemDto,
  GallerySourceFilter,
  ImageRatingDimension,
  VideoDocumentSummaryDto,
} from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { AlbumCoverBadge } from '@/renderer/components/albums/AlbumTreePreview';
import { buildAlbumTreeIndex } from '@/renderer/components/albums/albumTree';
import { AlbumDetailHeader } from '@/renderer/components/gallery/AlbumDetailHeader';
import { MaterialLibraryToolbar } from '@/renderer/components/gallery/MaterialLibraryToolbar';
import { MaterialMasonry } from '@/renderer/components/gallery/MaterialMasonry';
import { MaterialStackView } from '@/renderer/components/gallery/MaterialStackView';
import type {
  GalleryRelationship,
  GalleryScope,
  GalleryViewMode,
} from '@/renderer/components/gallery/galleryPreferences';
import { mediaMaterial, type MaterialLibraryItem } from '@/renderer/components/gallery/materialLibraryTypes';
import {
  collectMaterialStacks,
  immediateDescendantUnder,
  type MaterialStack,
} from '@/renderer/components/gallery/materialStacking';
import {
  getMediaStackHorizontalBounds,
  getMediaStackLayout,
  MediaStackPreview,
} from '@/renderer/components/media/MediaStackPreview';
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import { AlbumDocumentRow, AlbumDocumentView } from '@/renderer/components/creator/AlbumDocumentContent';
import type { CreationLibraryFilter } from '@/renderer/components/creator/CreationLibraryToolbar';
import { CreatorPaneResizeHandle } from '@/renderer/components/creator/CreatorPaneResizeHandle';
import { shouldShowDocumentView } from '@/renderer/components/creator/albumDocumentView';
import { creationSessionCoverFirstAssets } from '@/renderer/components/creator/creationCoverFirstAssets';
import { creationAlbumPreviewAssets } from '@/renderer/components/creator/creationAlbumPreviewAssets';
import type { CreationSessionProjection } from '@/renderer/components/creator/creationSessionProjection';
import { useAlbumContentPane } from '@/renderer/components/creator/useAlbumContentPane';
import { useVideoDocumentList } from '@/renderer/features/video-documents/useVideoDocumentList';

interface Props {
  album: AlbumDto;
  albums: AlbumDto[];
  creationSessions: readonly CreationSessionProjection[];
  filter: CreationLibraryFilter;
  documentNavigationRevision: number;
  busy: boolean;
  onSelectAlbum(albumId: string): void;
  onSelectSeries(seriesId: string, assetId?: string): void;
  onSelectDocument(documentId: string, albumId: string | null): void;
  onOpenMaterial(materialId: string): void;
  onRename(album: AlbumDto, title: string): Promise<void>;
  onDelete(album: AlbumDto): Promise<void>;
  onTogglePin(album: AlbumDto): Promise<void>;
  onSetArchived(album: AlbumDto, archived: boolean): Promise<void>;
  onCreateCreation(): void;
  onSettings(): void;
  notify(message: string): void;
}

const pageSize = 48;

interface AlbumCreationEntry {
  session: CreationSessionProjection;
  assets: Array<{ asset: AssetDto; seriesId: string }>;
}

type AlbumContentEntry =
  | { kind: 'ALBUM'; album: AlbumDto }
  | { kind: 'MATERIAL'; member: AlbumMemberDto }
  | { kind: 'DOCUMENT'; document: VideoDocumentSummaryDto }
  | ({ kind: 'CREATION' } & AlbumCreationEntry);

function sessionAssets(session: CreationSessionProjection) {
  return creationSessionCoverFirstAssets(session);
}

function creationAlbumId(session: CreationSessionProjection, albumBySeriesId: ReadonlyMap<string, string>) {
  return (
    albumBySeriesId.get(session.primarySeries.id) ??
    session.memberSeries.map((series) => albumBySeriesId.get(series.id)).find(Boolean) ??
    null
  );
}

function directCreationEntries(
  album: AlbumDto,
  sessions: readonly CreationSessionProjection[],
  albumBySeriesId: ReadonlyMap<string, string>,
): AlbumCreationEntry[] {
  const sessionBySeriesId = new Map<string, CreationSessionProjection>();
  for (const session of sessions) {
    for (const series of session.memberSeries) sessionBySeriesId.set(series.id, session);
  }

  const seenSessionIds = new Set<string>();
  return album.members.flatMap((member) => {
    if (member.targetType !== 'SERIES') return [];
    const session = sessionBySeriesId.get(member.targetId);
    if (!session || creationAlbumId(session, albumBySeriesId) !== album.id || seenSessionIds.has(session.id)) return [];
    seenSessionIds.add(session.id);
    return [{ session, assets: sessionAssets(session) }];
  });
}

function contentPreviewWidth(assets: readonly AssetDto[]) {
  const bounds = getMediaStackHorizontalBounds(
    'tree',
    assets.map((asset) => ({ asset })),
    'settled',
  );
  return Math.ceil(Math.max(getMediaStackLayout('tree').containerWidth, bounds.right));
}

export function AlbumContentList({
  album,
  childAlbums,
  sessions,
  albumBySeriesId,
  documents = [],
  documentTotal,
  documentsLoading = false,
  documentsLoadingMore = false,
  documentsHasMore = false,
  filter = 'all',
  locale,
  contentsLabel,
  loadMoreDocumentsLabel,
  onSelectAlbum,
  onSelectSeries,
  onSelectDocument,
  onOpenMaterial,
  onLoadMoreDocuments,
  resize,
}: {
  album: AlbumDto;
  childAlbums: readonly AlbumDto[];
  sessions: readonly CreationSessionProjection[];
  albumBySeriesId: ReadonlyMap<string, string>;
  documents?: readonly VideoDocumentSummaryDto[];
  documentTotal?: number;
  documentsLoading?: boolean;
  documentsLoadingMore?: boolean;
  documentsHasMore?: boolean;
  filter?: CreationLibraryFilter;
  locale: 'zh' | 'en';
  contentsLabel: string;
  loadMoreDocumentsLabel?: string;
  onSelectAlbum(albumId: string): void;
  onSelectSeries(seriesId: string, assetId?: string): void;
  onSelectDocument?(documentId: string, albumId: string | null): void;
  onOpenMaterial(materialId: string): void;
  onLoadMoreDocuments?(): void;
  resize?: {
    width: number;
    minimumWidth: number;
    maximumWidth: number;
    label: string;
    onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void;
    onWidthChange(width: number): void;
  };
}) {
  const entries = useMemo<AlbumContentEntry[]>(
    () => [
      ...childAlbums.map((child) => ({ kind: 'ALBUM' as const, album: child })),
      ...(filter === 'documents'
        ? []
        : [
            ...directCreationEntries(album, sessions, albumBySeriesId).map((entry) => ({
              kind: 'CREATION' as const,
              ...entry,
            })),
            ...album.members
              .filter((member) => member.targetType === 'MATERIAL')
              .map((member) => ({ kind: 'MATERIAL' as const, member })),
          ]),
      ...(filter === 'images' ? [] : documents.map((document) => ({ kind: 'DOCUMENT' as const, document }))),
    ],
    [album, albumBySeriesId, childAlbums, documents, filter, sessions],
  );
  const visibleDocumentTotal = filter === 'images' ? 0 : (documentTotal ?? documents.length);
  const contentCount = entries.length + Math.max(0, visibleDocumentTotal - documents.length);

  return (
    <aside
      className={cn('relative flex min-h-0 shrink-0 flex-col border-r bg-muted/10', !resize && 'w-52 lg:w-60')}
      style={resize ? { width: resize.width } : undefined}
      aria-labelledby="album-contents-heading"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <h2 id="album-contents-heading" className="min-w-0 flex-1 truncate text-xs font-semibold">
          {contentsLabel}
        </h2>
        {documentsLoading && filter !== 'images' && documents.length === 0 ? (
          <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{contentCount}</span>
        )}
      </div>
      <ScrollArea type="always" className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
        <ul className="space-y-1 p-2">
          {entries.map((entry) => {
            if (entry.kind === 'ALBUM') {
              const assets = creationAlbumPreviewAssets(entry.album, filter);
              const width = contentPreviewWidth(assets);
              return (
                <li
                  key={entry.album.id}
                  data-album-child
                  className="group flex h-[4.25rem] min-w-0 items-center gap-1 rounded-lg px-1 transition-colors hover:bg-hover focus-within:bg-hover"
                >
                  <button
                    type="button"
                    className="relative flex h-[4.25rem] shrink-0 items-center overflow-visible rounded-md outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    style={{ width }}
                    title={entry.album.title}
                    aria-label={entry.album.title}
                    onClick={() => onSelectAlbum(entry.album.id)}
                  >
                    <MediaStackPreview size="tree" spread="settled" items={assets.map((asset) => ({ asset }))} />
                    <AlbumCoverBadge />
                  </button>
                  <button
                    type="button"
                    className="flex h-12 min-w-0 flex-1 items-center rounded-md px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    title={entry.album.title}
                    aria-label={entry.album.title}
                    onClick={() => onSelectAlbum(entry.album.id)}
                  >
                    <span className="line-clamp-2 min-w-0 flex-1 whitespace-normal break-words text-base font-medium leading-5">
                      {entry.album.title}
                    </span>
                  </button>
                </li>
              );
            }
            if (entry.kind === 'MATERIAL') {
              const { member } = entry;
              const asset = member.imageAsset;
              const title = member.materialText || (locale === 'zh' ? '图片素材' : 'Image material');
              const width = asset ? contentPreviewWidth([asset]) : getMediaStackLayout('tree').containerWidth;
              return (
                <li
                  key={member.id}
                  data-album-direct-material
                  className="group flex h-[4.25rem] min-w-0 items-center gap-1 rounded-lg px-1 transition-colors hover:bg-hover focus-within:bg-hover"
                >
                  <button
                    type="button"
                    className="relative flex h-[4.25rem] shrink-0 items-center justify-center overflow-visible rounded-md outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    style={{ width }}
                    title={title}
                    aria-label={title}
                    onClick={() => onOpenMaterial(member.targetId)}
                  >
                    {asset ? (
                      <MediaStackPreview size="tree" spread="settled" items={[{ asset }]} />
                    ) : (
                      <ImageIcon className="size-5 text-muted-foreground" />
                    )}
                  </button>
                  <button
                    type="button"
                    className="flex h-12 min-w-0 flex-1 items-center rounded-md px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    title={title}
                    aria-label={title}
                    onClick={() => onOpenMaterial(member.targetId)}
                  >
                    <span className="line-clamp-2 min-w-0 flex-1 whitespace-normal break-words text-base font-medium leading-5">
                      {title}
                    </span>
                  </button>
                </li>
              );
            }
            if (entry.kind === 'DOCUMENT') {
              return (
                <AlbumDocumentRow
                  key={entry.document.id}
                  document={entry.document}
                  albumId={album.id}
                  onSelectDocument={onSelectDocument}
                />
              );
            }
            const { session, assets } = entry;
            const first = assets[0] ?? null;
            const title = session.syntheticExperimentRoot
              ? locale === 'zh'
                ? '方向实验'
                : 'Direction experiment'
              : session.primarySeries.title;
            const openFirst = () => onSelectSeries(first?.seriesId ?? session.primarySeries.id, first?.asset.id);
            const width = contentPreviewWidth(assets.map(({ asset }) => asset));
            return (
              <li
                key={session.id}
                data-album-direct-creation
                className="group flex h-[4.25rem] min-w-0 items-center gap-1 rounded-lg px-1 transition-colors hover:bg-hover focus-within:bg-hover"
              >
                <span className="flex h-[4.25rem] shrink-0 items-center overflow-visible" style={{ width }}>
                  <MediaStackPreview
                    size="tree"
                    spread="settled"
                    items={assets.map(({ asset }) => ({ asset }))}
                    onAssetSelect={(asset) => {
                      const owner =
                        assets.find((record) => record.asset.id === asset.id)?.seriesId ?? session.primarySeries.id;
                      onSelectSeries(owner, asset.id);
                    }}
                  />
                </span>
                <button
                  type="button"
                  className="flex h-12 min-w-0 flex-1 items-center rounded-md px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  title={title}
                  aria-label={title}
                  onClick={openFirst}
                >
                  <span className="line-clamp-2 min-w-0 flex-1 whitespace-normal break-words text-base font-medium leading-5">
                    {title}
                  </span>
                </button>
              </li>
            );
          })}
          {documentsLoading && filter !== 'images' && entries.length === 0 && (
            <li className="grid h-12 place-items-center">
              <LoaderCircleIcon className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
            </li>
          )}
          {filter !== 'images' && documentsHasMore && onLoadMoreDocuments && loadMoreDocumentsLabel && (
            <li className="px-1 py-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full"
                disabled={documentsLoadingMore}
                onClick={onLoadMoreDocuments}
              >
                {documentsLoadingMore && <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden="true" />}
                {loadMoreDocumentsLabel}
              </Button>
            </li>
          )}
        </ul>
      </ScrollArea>
      {resize && (
        <CreatorPaneResizeHandle
          edge="right"
          label={resize.label}
          value={resize.width}
          min={resize.minimumWidth}
          max={resize.maximumWidth}
          onValueChange={resize.onWidthChange}
          onPointerDown={resize.onPointerDown}
        />
      )}
    </aside>
  );
}

export function CreatorAlbumDetail({
  album,
  albums,
  creationSessions,
  filter,
  documentNavigationRevision,
  busy,
  onSelectAlbum,
  onSelectSeries,
  onSelectDocument,
  onOpenMaterial,
  onRename,
  onDelete,
  onTogglePin,
  onSetArchived,
  onCreateCreation,
  onSettings,
  notify,
}: Props) {
  const { locale, messages } = useI18n();
  const l = messages.gallery.screen;
  const contentPane = useAlbumContentPane();
  const documentList = useVideoDocumentList({
    active: filter !== 'images',
    refreshKey: documentNavigationRevision,
    query: '',
    albumId: album.id,
    includeDescendants: false,
    unfiledOnly: false,
    notify,
  });
  const requestId = useRef(0);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [scope, setScope] = useState<GalleryScope>('ALL');
  const [relationship, setRelationship] = useState<GalleryRelationship>('ANY');
  const [unratedDimensions, setUnratedDimensions] = useState<ImageRatingDimension[]>([]);
  const [viewMode, setViewMode] = useState<GalleryViewMode>('GRID');
  const [items, setItems] = useState<GalleryItemDto[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const albumTree = useMemo(() => buildAlbumTreeIndex(albums), [albums]);
  const parent = useMemo(() => {
    const parentId = albumTree.parentById.get(album.id);
    return parentId ? (albumTree.byId.get(parentId) ?? null) : null;
  }, [album.id, albumTree]);
  const effectivelyArchived = albumTree.effectivelyArchived.has(album.id);
  const childAlbums = useMemo(
    () =>
      (albumTree.childrenByParentId.get(album.id) ?? []).filter(
        (child) => albumTree.effectivelyArchived.has(child.id) === effectivelyArchived,
      ),
    [album.id, albumTree.childrenByParentId, albumTree.effectivelyArchived, effectivelyArchived],
  );
  const descendantDocumentList = useVideoDocumentList({
    active: filter !== 'images' && childAlbums.length > 0,
    refreshKey: documentNavigationRevision,
    query: '',
    albumId: album.id,
    includeDescendants: true,
    unfiledOnly: false,
    notify,
  });
  const mainDocumentList = childAlbums.length > 0 ? descendantDocumentList : documentList;
  const albumBySeriesId = useMemo(() => {
    const result = new Map<string, string>();
    for (const candidate of albums) {
      for (const member of candidate.members) {
        if (member.targetType === 'SERIES') result.set(member.targetId, candidate.id);
      }
    }
    return result;
  }, [albums]);
  const source: GallerySourceFilter = scope === 'FAVORITE' ? 'FAVORITE' : relationship === 'ANY' ? 'ALL' : relationship;
  const materials = useMemo<MaterialLibraryItem[]>(() => items.map(mediaMaterial), [items]);
  const albumIdsByMaterialId = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const candidate of albums) {
      for (const member of candidate.members) {
        if (member.targetType !== 'MATERIAL') continue;
        const ids = result.get(member.targetId) ?? [];
        ids.push(candidate.id);
        result.set(member.targetId, ids);
      }
    }
    return result;
  }, [albums]);
  const materialStacks = useMemo(
    () =>
      collectMaterialStacks(materials, (item) => {
        if (item.kind !== 'TEXT' && item.image.creation) {
          const seriesId = item.image.creation.seriesId;
          const ownerAlbumId = albumBySeriesId.get(seriesId);
          if (ownerAlbumId) {
            const childAlbum = immediateDescendantUnder(ownerAlbumId, album.id, albumTree);
            if (childAlbum) {
              return {
                key: `album:${childAlbum.id}`,
                title: childAlbum.title,
                target: { kind: 'ALBUM' as const, id: childAlbum.id },
              };
            }
            if (ownerAlbumId === album.id) {
              return {
                key: `creation:${seriesId}`,
                title: item.image.creation.seriesTitle,
                target: { kind: 'CREATION' as const, id: seriesId },
              };
            }
          }
        }

        const materialId = item.kind === 'TEXT' ? item.text.id : item.image.materialId;
        for (const ownerAlbumId of materialId ? (albumIdsByMaterialId.get(materialId) ?? []) : []) {
          const childAlbum = immediateDescendantUnder(ownerAlbumId, album.id, albumTree);
          if (!childAlbum) continue;
          return {
            key: `album:${childAlbum.id}`,
            title: childAlbum.title,
            target: { kind: 'ALBUM' as const, id: childAlbum.id },
          };
        }
        return null;
      }),
    [album.id, albumBySeriesId, albumIdsByMaterialId, albumTree, materials],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (filter === 'documents') {
      requestId.current += 1;
      setLoading(false);
      setError('');
      return;
    }
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError('');
    void window.desktopApi
      .galleryList({
        locale,
        source,
        query: debouncedQuery || undefined,
        albumId: album.id,
        unratedDimensions,
        cursor: null,
        limit: pageSize,
      })
      .then((page) => {
        if (requestId.current !== currentRequest) return;
        setItems(page.items);
        setTotal(page.total);
        setNextCursor(page.nextCursor);
      })
      .catch((reason) => {
        if (requestId.current !== currentRequest) return;
        setItems([]);
        setTotal(0);
        setNextCursor(null);
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (requestId.current === currentRequest) setLoading(false);
      });
  }, [album.activityAt, album.id, debouncedQuery, filter, locale, retryKey, source, unratedDimensions]);

  async function loadMore() {
    if (!nextCursor || loading) return;
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const page = await window.desktopApi.galleryList({
        locale,
        source,
        query: debouncedQuery || undefined,
        albumId: album.id,
        unratedDimensions,
        cursor: nextCursor,
        knownTotal: total,
        limit: pageSize,
      });
      if (requestId.current !== currentRequest) return;
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (reason) {
      if (requestId.current === currentRequest) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (requestId.current === currentRequest) setLoading(false);
    }
  }

  function openMaterial(item: MaterialLibraryItem) {
    if (item.kind !== 'IMAGE') return;
    if (item.image.creation) {
      onSelectSeries(item.image.creation.seriesId, item.image.asset.id);
      return;
    }
    if (item.image.materialId) onOpenMaterial(item.image.materialId);
  }

  function openMaterialStack(stack: MaterialStack) {
    if (stack.target?.kind === 'ALBUM') onSelectAlbum(stack.target.id);
    else if (stack.target?.kind === 'CREATION') {
      const firstMedia = stack.items.find((item) => item.kind !== 'TEXT');
      onSelectSeries(stack.target.id, firstMedia?.image.asset.id);
    }
  }

  const albumLabels = {
    allMaterials: messages.gallery.albums.allMaterials,
    albums: messages.gallery.albums.myAlbums,
    archived: messages.gallery.albums.archived,
    expand: messages.gallery.albums.expand,
    collapse: messages.gallery.albums.collapse,
    create: messages.gallery.albums.create,
    createTitle: messages.gallery.albums.createTitle,
    createChild: messages.gallery.albums.createChild,
    open: messages.gallery.albums.open,
    rename: messages.gallery.albums.rename,
    renameTitle: messages.gallery.albums.renameTitle,
    delete: messages.gallery.albums.delete,
    deleteTitle: messages.gallery.albums.deleteTitle,
    deleteDescription: (title: string) => `${messages.gallery.albums.deleteDescription} · ${title}`,
    pin: messages.gallery.albums.pin,
    unpin: messages.gallery.albums.unpin,
    archive: messages.gallery.albums.archive,
    restore: messages.gallery.albums.restore,
    move: messages.gallery.albums.move,
    moveTitle: messages.gallery.albums.moveTitle,
    moveUp: messages.gallery.albums.moveUp,
    moveDown: messages.gallery.albums.moveDown,
    moveToRoot: messages.gallery.albums.moveToRoot,
    moreActions: (title: string) => `${messages.gallery.albums.moreActions}: ${title}`,
    name: messages.gallery.albums.name,
    namePlaceholder: messages.gallery.albums.namePlaceholder,
    cancel: messages.gallery.albums.cancel,
    save: messages.gallery.albums.save,
    confirmDelete: messages.gallery.albums.confirmDelete,
    belongsTo: (title: string) => `${messages.gallery.albums.belongsTo} · ${title}`,
    empty: messages.gallery.albums.empty,
    operationFailed: messages.gallery.albums.operationFailed,
    newCreation: messages.creator.results.newCreation,
    settings: locale === 'zh' ? '图集设置' : 'Album settings',
  };
  const documentView = shouldShowDocumentView({
    filter,
    loading,
    error,
    query: debouncedQuery,
    scope,
    relationship,
    unratedDimensionCount: unratedDimensions.length,
    materialCount: materials.length,
    documentLoading: mainDocumentList.loading,
    documentTotal: mainDocumentList.total,
  });

  return (
    <section
      className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background"
      aria-labelledby="album-detail-title"
    >
      <AlbumDetailHeader
        album={album}
        previewAssets={creationAlbumPreviewAssets(album, filter)}
        parent={parent}
        effectivelyArchived={effectivelyArchived}
        labels={albumLabels}
        busy={busy}
        onRename={onRename}
        onDelete={onDelete}
        onTogglePin={onTogglePin}
        onSetArchived={onSetArchived}
        onCreateCreation={onCreateCreation}
        onSettings={onSettings}
      />
      <div ref={contentPane.layoutRef} className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <AlbumContentList
          album={album}
          childAlbums={childAlbums}
          sessions={creationSessions}
          albumBySeriesId={albumBySeriesId}
          documents={documentList.items}
          documentTotal={documentList.total}
          documentsLoading={documentList.loading}
          documentsLoadingMore={documentList.loadingMore}
          documentsHasMore={documentList.hasMore}
          filter={filter}
          locale={locale}
          contentsLabel={messages.creator.album.contents}
          loadMoreDocumentsLabel={messages.videoDocuments.loadMore}
          onSelectAlbum={onSelectAlbum}
          onSelectSeries={onSelectSeries}
          onSelectDocument={onSelectDocument}
          onOpenMaterial={onOpenMaterial}
          onLoadMoreDocuments={() => void documentList.loadMore()}
          resize={{
            width: contentPane.width,
            minimumWidth: contentPane.minimumWidth,
            maximumWidth: contentPane.maximumWidth,
            label: messages.creator.album.resizeContents,
            onPointerDown: contentPane.beginResize,
            onWidthChange: contentPane.setWidth,
          }}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {!documentView && (
            <MaterialLibraryToolbar
              query={query}
              scope={scope}
              relationship={relationship}
              contentTypes={['IMAGE']}
              availableContentTypes={['IMAGE']}
              unratedDimensions={unratedDimensions}
              viewMode={viewMode}
              selectionMode={false}
              selectionAvailable={false}
              onQueryChange={setQuery}
              onScopeChange={setScope}
              onRelationshipChange={setRelationship}
              onContentTypesChange={() => undefined}
              onUnratedDimensionsChange={setUnratedDimensions}
              onViewModeChange={setViewMode}
              onSelectionModeChange={() => undefined}
            />
          )}
          {documentView ? (
            <AlbumDocumentView
              documents={mainDocumentList.items}
              total={mainDocumentList.total}
              loading={mainDocumentList.loading}
              loadingMore={mainDocumentList.loadingMore}
              hasMore={mainDocumentList.hasMore}
              onSelectDocument={onSelectDocument}
              onLoadMore={() => void mainDocumentList.loadMore()}
            />
          ) : (
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" aria-busy={loading}>
              {loading && materials.length === 0 ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4 overflow-hidden p-4 sm:p-6">
                  {Array.from({ length: 10 }, (_, index) => (
                    <Skeleton key={index} className="aspect-[4/3] rounded-xl" />
                  ))}
                </div>
              ) : error && materials.length === 0 ? (
                <div className="grid min-h-0 flex-1 place-items-center p-6 text-center text-muted-foreground">
                  <div className="grid justify-items-center gap-3">
                    <ImageIcon className="size-8 opacity-40" />
                    <strong className="text-sm text-foreground">{l.loadFailed}</strong>
                    <Button variant="outline" size="sm" onClick={() => setRetryKey((value) => value + 1)}>
                      {l.retry}
                    </Button>
                  </div>
                </div>
              ) : materials.length === 0 ? (
                <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
                  <strong className="text-sm font-medium">{debouncedQuery ? l.emptySearch : l.empty}</strong>
                </div>
              ) : (
                <ScrollArea
                  type="always"
                  className="min-h-0 min-w-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:!w-full"
                >
                  {viewMode === 'GRID' ? (
                    <div data-material-view="GRID" className="w-full min-w-0 p-4 sm:p-6">
                      <MaterialMasonry
                        items={materials}
                        selectedKey={null}
                        checkedKeys={new Set()}
                        selectionMode={false}
                        selectionAvailable={false}
                        onSelect={openMaterial}
                        onEnterSelection={() => undefined}
                        onToggleSelection={() => undefined}
                        onCopyText={() => undefined}
                        notify={notify}
                        revealContext={{ kind: 'ALBUM', albumId: album.id }}
                      />
                    </div>
                  ) : (
                    <div data-material-view="LIST" data-material-layout="STACK" className="w-full min-w-0 p-4 sm:p-6">
                      <MaterialStackView
                        stacks={materialStacks}
                        selectedKey={null}
                        selectionMode={false}
                        selectionAvailable={false}
                        onSelect={openMaterial}
                        onOpenStack={openMaterialStack}
                        onCopyText={() => undefined}
                        notify={notify}
                        revealContextForItem={() => ({ kind: 'ALBUM', albumId: album.id })}
                      />
                    </div>
                  )}
                  <div className="flex min-h-16 items-center justify-center gap-3 px-4 pb-6 text-xs text-muted-foreground">
                    {loading ? (
                      <LoaderCircleIcon className="size-4 animate-spin" aria-label={l.loadingMore} />
                    ) : nextCursor ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => void loadMore()}>
                        {l.loadMore}
                      </Button>
                    ) : (
                      <span>
                        {l.shown} {materials.length} / {total}
                      </span>
                    )}
                  </div>
                </ScrollArea>
              )}
              {loading && materials.length > 0 && (
                <LoaderCircleIcon
                  className="absolute right-4 top-4 size-4 animate-spin text-muted-foreground"
                  aria-label={l.loadingMore}
                />
              )}
              {error && materials.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn('absolute bottom-4 left-1/2 -translate-x-1/2')}
                  onClick={() => void loadMore()}
                >
                  {l.retry}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
