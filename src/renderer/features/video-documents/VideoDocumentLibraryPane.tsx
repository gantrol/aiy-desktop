import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderPlusIcon,
  LoaderCircleIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react';
import { useState } from 'react';
import type { AlbumDto, VideoDocumentSummaryDto } from '@/shared/contracts';
import type { VideoDocumentsLocation } from '@/renderer/components/app/app-navigation';
import type { AlbumMoveTarget } from '@/renderer/components/albums/AlbumMoveDialog';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import {
  VideoDocumentNavigationTree,
  type VideoDocumentNavigationPageState,
} from '@/renderer/features/video-documents/VideoDocumentNavigationTree';
import {
  formatVideoDuration,
  VideoDocumentPreview,
} from '@/renderer/features/video-documents/VideoDocumentNavigationPreviews';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { useVideoDocumentLibraryTree } from '@/renderer/features/video-documents/useVideoDocumentLibraryTree';

interface Props {
  albums: AlbumDto[];
  location: VideoDocumentsLocation;
  query: string;
  root: VideoDocumentNavigationPageState;
  children: Record<string, VideoDocumentNavigationPageState>;
  searchItems: VideoDocumentSummaryDto[];
  searchLoading: boolean;
  searchLoadingMore: boolean;
  searchHasMore: boolean;
  onQueryChange(query: string): void;
  onExpandAlbum(albumId: string): void;
  onSelectDocument(documentId: string, parentAlbumId: string | null): void;
  onLoadRootMore(): void;
  onLoadChildrenMore(albumId: string): void;
  onLoadSearchMore(): void;
  onMoveDocument(documentId: string, albumId: string | null, copy?: boolean): void | Promise<void>;
  onMoveCreationItem(creationItemId: string, albumId: string | null, copy?: boolean): void | Promise<void>;
  onMoveAlbum(albumId: string, parentAlbumId: string | null, copy?: boolean): void | Promise<void>;
  onOperationError(reason: unknown): void;
  onStartVideoDocument(): void;
  onCreateAlbum(parentAlbumId: string | null): void;
  onRenameAlbum(albumId: string): void;
  onRenameDocument(documentId: string, title: string): void;
  onRequestMove(target: AlbumMoveTarget): void;
  onReorder(
    parentAlbumId: string | null,
    entries: Array<{ kind: 'ALBUM' | 'DOCUMENT'; targetId: string }>,
  ): void | Promise<void>;
}

interface SearchResultsProps {
  items: VideoDocumentSummaryDto[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  selectedDocumentId: string | null;
  onSelect(documentId: string, albumId: string | null): void;
  onLoadMore(): void;
}

function VideoDocumentSearchResults({
  items,
  loading,
  loadingMore,
  hasMore,
  selectedDocumentId,
  onSelect,
  onLoadMore,
}: SearchResultsProps) {
  const { messages } = useI18n();
  const labels = messages.videoDocuments;
  if (loading && items.length === 0) {
    return (
      <div className="grid h-24 place-items-center text-selected-foreground">
        <LoaderCircleIcon className="size-4 animate-spin" />
      </div>
    );
  }
  if (items.length === 0) return <div className="px-5 py-8 text-sm text-muted-foreground">{labels.empty}</div>;
  return (
    <div className="space-y-0.5 px-2 py-2">
      {items.map((document) => (
        <button
          key={document.id}
          type="button"
          className={cn(
            'flex h-[4.25rem] w-full items-center gap-1 rounded-lg px-1 text-left outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            selectedDocumentId === document.id && 'bg-selected text-selected-foreground hover:bg-selected',
          )}
          onClick={() => onSelect(document.id, document.albumId)}
        >
          <VideoDocumentPreview document={document} />
          <span className="min-w-0 flex-1 px-1">
            <strong className="line-clamp-2 block break-words text-base font-medium leading-5">
              {document.displayTitle || messages.desktopPetals.document.empty}
            </strong>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {document.albumTitle || labels.unfiled} · {formatVideoDuration(document.source.asset.durationMs)}
            </span>
          </span>
        </button>
      ))}
      {hasMore && (
        <div className="p-3">
          <Button type="button" variant="outline" className="w-full" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore && <LoaderCircleIcon className="size-4 animate-spin" />}
            {labels.loadMore}
          </Button>
        </div>
      )}
    </div>
  );
}

export function VideoDocumentLibraryPane({
  albums,
  location,
  query,
  root,
  children,
  searchItems,
  searchLoading,
  searchLoadingMore,
  searchHasMore,
  onQueryChange,
  onExpandAlbum,
  onSelectDocument,
  onLoadRootMore,
  onLoadChildrenMore,
  onLoadSearchMore,
  onMoveDocument,
  onMoveCreationItem,
  onMoveAlbum,
  onOperationError,
  onStartVideoDocument,
  onCreateAlbum,
  onRenameAlbum,
  onRenameDocument,
  onRequestMove,
  onReorder,
}: Props) {
  const { messages } = useI18n();
  const labels = messages.videoDocuments;
  const [showEmptyAlbums, setShowEmptyAlbums] = useState(false);
  const [searchOpen, setSearchOpen] = useState(() => Boolean(query.trim()));
  const searchMode = Boolean(query.trim());
  const treeState = useVideoDocumentLibraryTree({
    albums,
    location,
    root,
    children,
    showEmptyAlbums,
    onExpandAlbum,
  });

  function requestCreateAlbum(parentAlbumId: string | null) {
    setShowEmptyAlbums(true);
    onCreateAlbum(parentAlbumId);
  }

  function navigationTree(compact = false) {
    return (
      <VideoDocumentNavigationTree
        root={root}
        children={children}
        visibleEntries={treeState.visibleEntries}
        selectedDocumentId={location.documentId}
        expandedAlbumIds={treeState.expandedAlbumIds}
        compact={compact}
        onToggleAlbum={treeState.toggleAlbum}
        onGestureExpand={treeState.gestureExpand}
        onPointerTrackStart={treeState.beginPointerTrack}
        onPointerTrack={treeState.trackPointer}
        onSelectDocument={onSelectDocument}
        onLoadRootMore={onLoadRootMore}
        onLoadChildrenMore={onLoadChildrenMore}
        onMoveDocument={onMoveDocument}
        onMoveCreationItem={onMoveCreationItem}
        onMoveAlbum={onMoveAlbum}
        onOperationError={onOperationError}
        onCreateAlbum={requestCreateAlbum}
        onRenameAlbum={onRenameAlbum}
        onRenameDocument={onRenameDocument}
        onRequestMove={onRequestMove}
        onReorder={onReorder}
      />
    );
  }

  return (
    <div className="relative flex size-full min-h-0 min-w-0 flex-col bg-surface-sunken">
      <header className="flex h-14 shrink-0 items-center border-b border-border/60 px-3">
        <h1 className="truncate text-lg font-semibold tracking-tight">{labels.title}</h1>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title={labels.search}
            aria-label={labels.search}
            aria-expanded={searchOpen}
            onClick={() => {
              if (searchOpen) onQueryChange('');
              setSearchOpen((open) => !open);
            }}
          >
            <SearchIcon className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title={labels.sidebar.newAlbum}
            aria-label={labels.sidebar.newAlbum}
            onClick={() => requestCreateAlbum(null)}
          >
            <FolderPlusIcon className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            title={labels.sidebar.newDocument}
            aria-label={labels.sidebar.newDocument}
            onClick={onStartVideoDocument}
          >
            <PlusIcon className="size-4" />
          </Button>
        </div>
      </header>
      {searchOpen && (
        <div className="border-b border-border/60 px-3 py-2">
          <label className="relative block">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              className="h-9 pl-9 pr-9 focus-visible:border-ring"
              placeholder={labels.search}
              aria-label={labels.search}
              onChange={(event) => onQueryChange(event.target.value)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute right-0.5 top-1/2 -translate-y-1/2"
              title={messages.common.close}
              aria-label={messages.common.close}
              onClick={() => {
                onQueryChange('');
                setSearchOpen(false);
              }}
            >
              <XIcon className="size-3.5" />
            </Button>
          </label>
        </div>
      )}
      <ScrollArea type="always" className="min-h-0 flex-1" viewportRef={treeState.navigationViewportRef}>
        {searchMode ? (
          <VideoDocumentSearchResults
            items={searchItems}
            loading={searchLoading}
            loadingMore={searchLoadingMore}
            hasMore={searchHasMore}
            selectedDocumentId={location.documentId}
            onSelect={onSelectDocument}
            onLoadMore={onLoadSearchMore}
          />
        ) : root.loading && root.items.length === 0 ? (
          <div className="grid h-24 place-items-center text-selected-foreground">
            <LoaderCircleIcon className="size-4 animate-spin" />
          </div>
        ) : treeState.visibleEntries.length === 0 && treeState.emptyAlbumCount === 0 ? (
          <div className="px-5 py-8 text-sm text-muted-foreground">{labels.empty}</div>
        ) : treeState.visibleEntries.length > 0 ? (
          navigationTree()
        ) : null}
        {!searchMode && treeState.emptyAlbumCount > 0 && (
          <div className="mx-2 mt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-start px-2 text-xs font-normal text-muted-foreground hover:bg-selected/45 hover:text-selected-foreground"
              aria-expanded={showEmptyAlbums}
              onClick={() => setShowEmptyAlbums((value) => !value)}
            >
              {showEmptyAlbums ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
              {showEmptyAlbums
                ? labels.sidebar.hideEmptyAlbums(treeState.emptyAlbumCount)
                : labels.sidebar.showEmptyAlbums(treeState.emptyAlbumCount)}
            </Button>
          </div>
        )}
        <div className="h-14" aria-hidden="true" />
      </ScrollArea>
    </div>
  );
}
