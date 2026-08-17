import { FolderInputIcon, LoaderCircleIcon, NotebookTextIcon, PencilIcon } from 'lucide-react';
import type { VideoDocumentNavigationEntry } from '@/shared/contracts';
import { TreeBranchNodeConnector, TreeBranchTransitRail } from '@/renderer/components/albums/TreeDisclosureRail';
import { getTreeNodeAnchor, type TreeBranchItemTopology } from '@/renderer/components/albums/treeConnectionGeometry';
import { ActionContextMenuItems, ActionMenuButton, type ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { Button } from '@/renderer/components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/renderer/components/ui/context-menu';
import {
  formatVideoDuration,
  VideoDocumentPreview,
} from '@/renderer/features/video-documents/VideoDocumentNavigationPreviews';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

type DocumentEntry = Extract<VideoDocumentNavigationEntry, { kind: 'DOCUMENT' }>;

export interface CreationDocumentNavigationPage {
  items: VideoDocumentNavigationEntry[];
  nextCursor: string | null;
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
}

interface DocumentItemProps {
  entry: DocumentEntry;
  selected: boolean;
  onSelectDocument(documentId: string, albumId: string | null): void;
  onRenameDocument?(document: DocumentEntry['document']): void;
  onMoveDocument?(document: DocumentEntry['document']): void;
}

const rowControlsClassName =
  'pointer-events-none absolute inset-y-0 right-1 z-30 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100';
const rowControlClassName = 'pointer-events-auto shrink-0 rounded-md bg-overlay/95 shadow-overlay backdrop-blur-sm';
const compactItemClassName =
  'relative grid size-16 shrink-0 place-items-center overflow-visible rounded-xl bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring';
const compactSelectedClassName =
  'after:pointer-events-none after:absolute after:top-1/2 after:-left-1 after:h-6 after:w-0.5 after:-translate-y-1/2 after:rounded-full after:bg-selected-foreground';

export function creationAlbumCanExpand(
  visibleChildCount: number,
  includeDocuments: boolean,
  page: CreationDocumentNavigationPage | undefined,
  descendantDocumentCount?: number,
) {
  if (visibleChildCount > 0) return true;
  if (!includeDocuments) return false;
  if (descendantDocumentCount !== undefined) return descendantDocumentCount > 0;
  if (page?.loaded !== true) return true;
  return Boolean(page.loading || page.items.length || page.nextCursor);
}

export function CreationDocumentRow({
  entry,
  selected,
  branchTopology,
  onSelectDocument,
  onRenameDocument,
  onMoveDocument,
}: DocumentItemProps & { branchTopology?: TreeBranchItemTopology }) {
  const labels = useI18n().messages.videoDocuments.sidebar;
  const document = entry.document;
  const openDocument = () => onSelectDocument(document.id, entry.parentAlbumId);
  const actions: ActionMenuAction[] = [
    { id: 'open-document', label: labels.open, icon: NotebookTextIcon, onSelect: openDocument },
  ];
  if (onRenameDocument) {
    actions.push({
      id: 'rename-document',
      label: labels.rename,
      icon: PencilIcon,
      onSelect: () => onRenameDocument(document),
    });
  }
  if (onMoveDocument) {
    actions.push({
      id: 'move-document',
      label: labels.move,
      icon: FolderInputIcon,
      onSelect: () => onMoveDocument(document),
    });
  }
  const previewAnchor = getTreeNodeAnchor({ left: 0, top: 12, right: 64, bottom: 48 });
  const row = (
    <div
      data-document-id={document.id}
      data-result-library-selected={selected ? 'true' : undefined}
      role="group"
      aria-label={document.title}
      className={cn(
        'group relative flex h-[4.25rem] min-w-0 cursor-pointer items-center gap-1 rounded-lg px-1 transition-colors hover:bg-hover',
        selected &&
          'text-selected-foreground before:pointer-events-none before:absolute before:inset-y-0.5 before:left-3 before:right-0 before:rounded-xl before:bg-selected hover:bg-transparent',
      )}
    >
      <button
        type="button"
        className="absolute inset-0 z-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${labels.open}: ${document.title}`}
        aria-current={selected ? 'page' : undefined}
        onClick={openDocument}
      />
      <span
        data-tree-branch-media-preview
        className="pointer-events-none relative z-10 -ml-1 flex h-[4.25rem] w-16 shrink-0 items-center overflow-visible"
      >
        {branchTopology && <TreeBranchTransitRail topology={branchTopology} />}
        {branchTopology && <TreeBranchNodeConnector topology={branchTopology} anchor={previewAnchor} />}
        <VideoDocumentPreview document={document} />
      </span>
      <span className="pointer-events-none relative z-10 min-w-0 flex-1 px-1 text-left">
        <strong className="line-clamp-2 break-words text-base font-medium leading-5" title={document.title}>
          {document.title}
        </strong>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {formatVideoDuration(document.source.asset.durationMs)}
        </span>
      </span>
      <div data-result-library-row-control className={rowControlsClassName}>
        <ActionMenuButton
          actions={actions}
          label={labels.moreActions(document.title)}
          className={cn(rowControlClassName, 'size-6')}
        />
      </div>
    </div>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent>
        <ActionContextMenuItems actions={actions} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function CreationDocumentCompactItem({
  entry,
  selected,
  onSelectDocument,
  onRenameDocument,
  onMoveDocument,
}: DocumentItemProps) {
  const labels = useI18n().messages.videoDocuments.sidebar;
  const document = entry.document;
  const openDocument = () => onSelectDocument(document.id, entry.parentAlbumId);
  const actions: ActionMenuAction[] = [
    { id: 'open-document', label: labels.open, icon: NotebookTextIcon, onSelect: openDocument },
  ];
  if (onRenameDocument) {
    actions.push({
      id: 'rename-document',
      label: labels.rename,
      icon: PencilIcon,
      onSelect: () => onRenameDocument(document),
    });
  }
  if (onMoveDocument) {
    actions.push({
      id: 'move-document',
      label: labels.move,
      icon: FolderInputIcon,
      onSelect: () => onMoveDocument(document),
    });
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group relative flex h-16 w-full items-center justify-center">
          <button
            type="button"
            title={document.title}
            aria-label={document.title}
            aria-current={selected ? 'page' : undefined}
            data-result-library-selected={selected ? 'true' : undefined}
            className={cn(compactItemClassName, selected && compactSelectedClassName)}
            onClick={openDocument}
          >
            <span className="scale-[0.88]">
              <VideoDocumentPreview document={document} />
            </span>
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ActionContextMenuItems actions={actions} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function CreationDocumentAlbumPaging({
  expanded,
  includeDocuments,
  visibleChildCount,
  page,
  onLoadMore,
}: {
  expanded: boolean;
  includeDocuments: boolean;
  visibleChildCount: number;
  page: CreationDocumentNavigationPage | undefined;
  onLoadMore(): void;
}) {
  const loadMoreLabel = useI18n().messages.videoDocuments.loadMore;
  if (!expanded || !includeDocuments) return null;
  return (
    <>
      {page?.loading && visibleChildCount === 0 && (
        <div className="grid h-10 place-items-center text-selected-foreground">
          <LoaderCircleIcon className="size-3.5 animate-spin" />
        </div>
      )}
      {page?.nextCursor && (
        <div className="px-3 py-1 pl-12">
          <Button type="button" variant="ghost" size="sm" disabled={page.loadingMore} onClick={onLoadMore}>
            {page.loadingMore && <LoaderCircleIcon className="size-3.5 animate-spin" />}
            {loadMoreLabel}
          </Button>
        </div>
      )}
    </>
  );
}

export function CreationDocumentRootPaging({
  includeDocuments,
  queryActive,
  searchLoading,
  searchHasMore,
  searchLoadingMore,
  rootLoading,
  rootHasMore,
  rootLoadingMore,
  onLoadSearchMore,
  onLoadRootMore,
}: {
  includeDocuments: boolean;
  queryActive: boolean;
  searchLoading: boolean;
  searchHasMore: boolean;
  searchLoadingMore: boolean;
  rootLoading: boolean;
  rootHasMore: boolean;
  rootLoadingMore: boolean;
  onLoadSearchMore(): void;
  onLoadRootMore(): void;
}) {
  const loadMoreLabel = useI18n().messages.videoDocuments.loadMore;
  if (!includeDocuments) return null;
  return (
    <>
      {((queryActive && searchLoading) || (!queryActive && rootLoading)) && (
        <div className="grid h-12 place-items-center text-selected-foreground">
          <LoaderCircleIcon className="size-3.5 animate-spin" />
        </div>
      )}
      {queryActive && searchHasMore && (
        <div className="p-3">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={searchLoadingMore}
            onClick={onLoadSearchMore}
          >
            {searchLoadingMore && <LoaderCircleIcon className="size-3.5 animate-spin" />}
            {loadMoreLabel}
          </Button>
        </div>
      )}
      {!queryActive && rootHasMore && (
        <div className="p-3">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={rootLoadingMore}
            onClick={onLoadRootMore}
          >
            {rootLoadingMore && <LoaderCircleIcon className="size-3.5 animate-spin" />}
            {loadMoreLabel}
          </Button>
        </div>
      )}
    </>
  );
}
