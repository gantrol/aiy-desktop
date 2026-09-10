import { ImageIcon, ListChecksIcon, LoaderCircleIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AlbumDto,
  BootstrapDto,
  GalleryItemDto,
  GallerySourceFilter,
  ImageRatingDimension,
} from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { buildAlbumTreeIndex } from '@/renderer/components/albums/albumTree';
import { AlbumDetailHeader } from '@/renderer/components/gallery/AlbumDetailHeader';
import { MaterialLibraryToolbar } from '@/renderer/components/gallery/MaterialLibraryToolbar';
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
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import type { CreationLibraryFilter } from '@/renderer/components/creator/creationLibraryFilter';
import { CreatorPaneResizeHandle } from '@/renderer/components/creator/CreatorPaneResizeHandle';
import { CreatorAlbumMaterialViews } from '@/renderer/components/creator/CreatorAlbumMaterialViews';
import { creationAlbumPreviewAssets } from '@/renderer/components/creator/creationAlbumPreviewAssets';
import type { CreationSessionProjection } from '@/renderer/components/creator/creationSessionProjection';
import { useAlbumContentPane } from '@/renderer/components/creator/useAlbumContentPane';
import { useVideoDocumentList } from '@/renderer/features/video-documents/useVideoDocumentList';
import { AlbumContents, type AlbumContentsProps } from '@/renderer/components/creator/AlbumContents';
import { albumContentCount, albumContentEntries } from '@/renderer/components/creator/albumContentEntries';
import {
  buildCreationLibraryProjection,
  type CreationFormProjection,
} from '@/renderer/components/creator/creationLibraryProjection';
import { useCreationAlbumDrop } from '@/renderer/components/creator/useCreationAlbumDrop';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';

interface Props {
  album: AlbumDto;
  data: BootstrapDto;
  creationSessions: readonly CreationSessionProjection[];
  filter: CreationLibraryFilter;
  documentNavigationRevision: number;
  busy: boolean;
  onOpenCreationForm(form: CreationFormProjection): void;
  onMoveAlbum(albumId: string, parentAlbumId: string | null): Promise<void>;
  onMoveCreationItem(creationItemId: string, albumId: string | null): Promise<void>;
  onOpenOutline(albumId: string): void;
  onSelectAlbum(albumId: string): void;
  onSelectSeries(seriesId: string, assetId?: string): void;
  onSelectDocument(documentId: string, albumId: string | null): void;
  onOpenMaterial(materialId: string): void;
  onArchiveMaterial(item: MaterialLibraryItem): void;
  onDeleteMaterial(item: MaterialLibraryItem): void;
  onRename(album: AlbumDto, title: string): Promise<void>;
  onDelete(album: AlbumDto): Promise<void>;
  onTogglePin(album: AlbumDto): Promise<void>;
  onArchive(album: AlbumDto): Promise<void>;
  onCreateCreation(): void;
  onSettings(): void;
  notify(message: string): void;
}

const pageSize = 48;

export function CreatorAlbumDetail({
  album,
  data,
  creationSessions,
  filter,
  documentNavigationRevision,
  busy,
  onOpenCreationForm,
  onMoveAlbum,
  onMoveCreationItem,
  onOpenOutline,
  onSelectAlbum,
  onSelectSeries,
  onSelectDocument,
  onOpenMaterial,
  onArchiveMaterial,
  onDeleteMaterial,
  onRename,
  onDelete,
  onTogglePin,
  onArchive,
  onCreateCreation,
  onSettings,
  notify,
}: Props) {
  const { locale, messages } = useI18n();
  const { albums, creationItems } = data;
  const [tab, setTab] = useState('contents');
  const l = messages.gallery.screen;
  const contentPane = useAlbumContentPane();
  const documentMembershipKey = useMemo(
    () =>
      creationItems
        .filter((item) => item.albumId === album.id)
        .flatMap((item) => item.forms.flatMap((form) => (form.role === 'VIDEO_DOCUMENT' ? [form.entity.id] : [])))
        .sort()
        .join(':'),
    [album.id, creationItems],
  );
  const documentList = useVideoDocumentList({
    active: filter.documents,
    refreshKey: `${documentNavigationRevision}:${documentMembershipKey}`,
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
  const activeTab = tab === 'images' && !filter.images ? 'contents' : tab;
  const childAlbums = useMemo(
    () =>
      (albumTree.childrenByParentId.get(album.id) ?? []).filter(
        (child) => albumTree.effectivelyArchived.has(child.id) === effectivelyArchived,
      ),
    [album.id, albumTree.childrenByParentId, albumTree.effectivelyArchived, effectivelyArchived],
  );
  const projection = useMemo(
    () =>
      buildCreationLibraryProjection({
        creationItems,
        labels: messages.creator.album,
        animations: data.animations,
        locale,
        series: data.series,
        sessions: creationSessions,
        imageBreakdowns: data.imageBreakdowns ?? [],
        evaluationSuites: data.evaluationSuites ?? [],
        inspirationStashes: data.inspirationStashes ?? [],
        socialPosts: data.socialPosts ?? [],
        articles: data.articles ?? [],
        derivedVisuals: data.derivedVisuals ?? [],
        videoDocuments: documentList.items,
      }),
    [
      creationItems,
      data.animations,
      messages.creator.album,
      creationSessions,
      data.series,
      data.imageBreakdowns,
      data.evaluationSuites,
      data.inspirationStashes,
      data.socialPosts,
      data.articles,
      data.derivedVisuals,
      documentList.items,
      locale,
    ],
  );
  const contentEntries = useMemo(
    () => albumContentEntries(album, childAlbums, projection.items, documentList.items, filter),
    [album, childAlbums, projection.items, documentList.items, filter],
  );
  const contentCount = albumContentCount(contentEntries, filter.documents ? documentList.total : 0);
  const drop = useCreationAlbumDrop({
    albumId: album.id,
    tree: albumTree,
    creationItems,
    busy,
    onMoveAlbum,
    onMoveCreationItem,
  });
  const contentsProps: Omit<AlbumContentsProps, 'layout'> = {
    entries: contentEntries,
    busy: busy || drop.moving || effectivelyArchived,
    loading: filter.documents && documentList.loading,
    loadingMore: documentList.loadingMore,
    hasMore: filter.documents && documentList.hasMore,
    onLoadMore: () => void documentList.loadMore(),
    onSelectAlbum,
    onOpenCreationForm,
    onSelectDocument,
    onOpenMaterial,
  };
  const albumBySeriesId = useMemo(() => {
    const result = new Map<string, string>();
    for (const item of creationItems) {
      if (!item.albumId) continue;
      for (const form of item.forms) {
        if (form.entity.kind === 'PROMPT_SERIES') result.set(form.entity.id, item.albumId);
      }
    }
    return result;
  }, [creationItems]);
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
    if (activeTab !== 'images' || !filter.images) {
      requestId.current += 1;
      setLoading(false);
      setError('');
      setItems([]);
      setTotal(0);
      setNextCursor(null);
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
    return () => {
      requestId.current += 1;
    };
  }, [activeTab, album, albums, debouncedQuery, filter.images, locale, retryKey, source, unratedDimensions]);

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
    settings: messages.creator.album.settings,
  };

  return (
    <section
      {...drop.handlers}
      className={cn(
        'relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-background',
        drop.active && 'ring-2 ring-inset ring-ring',
      )}
      aria-labelledby="album-detail-title"
    >
      {drop.active && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-30 bg-selected px-3 py-2 text-center text-sm text-selected-foreground"
          role="status"
        >
          {messages.creator.album.moveIntoAlbum(album.title)}
        </div>
      )}
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
        onArchive={onArchive}
        onCreateCreation={onCreateCreation}
        onSettings={onSettings}
        notify={notify}
      />
      <div ref={contentPane.layoutRef} className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {activeTab === 'images' && (
          <aside
            className="relative flex min-h-0 shrink-0 flex-col border-r bg-muted/10"
            style={{ width: contentPane.width }}
            aria-labelledby="album-contents-heading"
          >
            <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
              <h2 id="album-contents-heading" className="min-w-0 flex-1 truncate text-xs font-semibold">
                {messages.creator.album.contents}
              </h2>
              <span className="text-[11px] tabular-nums text-muted-foreground">{contentCount}</span>
            </div>
            <AlbumContents {...contentsProps} layout="list" />
            <CreatorPaneResizeHandle
              edge="right"
              label={messages.creator.album.resizeContents}
              value={contentPane.width}
              min={contentPane.minimumWidth}
              max={contentPane.maximumWidth}
              onValueChange={contentPane.setWidth}
              onPointerDown={contentPane.beginResize}
            />
          </aside>
        )}
        <Tabs value={activeTab} onValueChange={setTab} className="min-w-0 flex-1 overflow-hidden">
          <div className="flex shrink-0 items-center justify-between gap-2 pr-3">
            <TabsList className="px-3" aria-label={messages.creator.album.contents}>
              <TabsTrigger value="contents">
                {messages.creator.album.contents}
                <span className="ml-2 tabular-nums text-muted-foreground">{contentCount}</span>
              </TabsTrigger>
              {filter.images && <TabsTrigger value="images">{messages.creator.album.browseImages}</TabsTrigger>}
            </TabsList>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={effectivelyArchived}
              title={messages.creator.outline.title}
              aria-label={messages.creator.outline.title}
              onClick={() => onOpenOutline(album.id)}
            >
              <ListChecksIcon className="size-4" />
            </Button>
          </div>
          <TabsContent value="contents" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            <AlbumContents {...contentsProps} layout="grid" />
          </TabsContent>
          <TabsContent
            value="images"
            className="flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
          >
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
                  <CreatorAlbumMaterialViews
                    albumId={album.id}
                    viewMode={viewMode}
                    materials={materials}
                    materialStacks={materialStacks}
                    busy={busy}
                    onOpen={openMaterial}
                    onOpenStack={openMaterialStack}
                    onArchive={onArchiveMaterial}
                    onDelete={onDeleteMaterial}
                    notify={notify}
                  />
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
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
