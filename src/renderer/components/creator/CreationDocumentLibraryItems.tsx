import { ArchiveIcon, FolderInputIcon, LoaderCircleIcon, NotebookTextIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import type { VideoDocumentNavigationEntry } from '@/shared/contracts';
import {
  CreationLibraryTreeItem,
  type CreationLibraryTreePlacementProps,
} from '@/renderer/components/creator/CreationLibraryTreeItem';
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
  busy: boolean;
  additionalActions?: readonly ActionMenuAction[];
  onSelectDocument(documentId: string, albumId: string | null): void;
  onRenameDocument?(document: DocumentEntry['document']): void;
  onMoveDocument?(document: DocumentEntry['document']): void;
  onArchiveDocument(document: DocumentEntry['document']): void;
  onDeleteDocument(document: DocumentEntry['document']): void;
}

const rowControlsClassName =
  'pointer-events-none absolute inset-y-0 right-1 z-30 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100';
const rowControlClassName = 'pointer-events-auto shrink-0 rounded-md bg-overlay/95 shadow-overlay';
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
  busy,
  branchTopology,
  additionalActions = [],
  onSelectDocument,
  onRenameDocument,
  onMoveDocument,
  onArchiveDocument,
  onDeleteDocument,
}: DocumentItemProps & CreationLibraryTreePlacementProps) {
  const { locale, messages } = useI18n();
  const labels = messages.videoDocuments.sidebar;
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
  actions.push(...additionalActions);
  actions.push(
    {
      id: 'archive-document',
      label: locale === 'zh' ? '归档' : 'Archive',
      icon: ArchiveIcon,
      separatorBefore: true,
      disabled: busy,
      onSelect: () => onArchiveDocument(document),
    },
    {
      id: 'delete-document',
      label: locale === 'zh' ? '删除' : 'Delete',
      icon: Trash2Icon,
      destructive: true,
      disabled: busy,
      onSelect: () => onDeleteDocument(document),
    },
  );
  const row = (
    <CreationLibraryTreeItem
      dataAttributes={{ 'data-document-id': document.id }}
      selected={selected}
      branchTopology={branchTopology}
      ariaLabel={document.title}
      openLabel={`${labels.open}: ${document.title}`}
      title={document.title}
      previewBounds={{ left: 0, top: 12, right: 64, bottom: 48 }}
      preview={<VideoDocumentPreview document={document} />}
      metadata={
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {formatVideoDuration(document.source.asset.durationMs)}
        </span>
      }
      controls={
        <div data-result-library-row-control className={rowControlsClassName}>
          <ActionMenuButton
            actions={actions}
            label={labels.moreActions(document.title)}
            className={cn(rowControlClassName, 'size-6')}
          />
        </div>
      }
      onOpen={openDocument}
    />
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
  busy,
  additionalActions = [],
  onSelectDocument,
  onRenameDocument,
  onMoveDocument,
  onArchiveDocument,
  onDeleteDocument,
}: DocumentItemProps) {
  const { locale, messages } = useI18n();
  const labels = messages.videoDocuments.sidebar;
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
  actions.push(...additionalActions);
  actions.push(
    {
      id: 'archive-document',
      label: locale === 'zh' ? '归档' : 'Archive',
      icon: ArchiveIcon,
      separatorBefore: true,
      disabled: busy,
      onSelect: () => onArchiveDocument(document),
    },
    {
      id: 'delete-document',
      label: locale === 'zh' ? '删除' : 'Delete',
      icon: Trash2Icon,
      destructive: true,
      disabled: busy,
      onSelect: () => onDeleteDocument(document),
    },
  );

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

export function CreationDocumentAlbumLoading({
  expanded,
  includeDocuments,
  visibleChildCount,
  page,
}: {
  expanded: boolean;
  includeDocuments: boolean;
  visibleChildCount: number;
  page: CreationDocumentNavigationPage | undefined;
}) {
  if (!expanded || !includeDocuments) return null;
  if (!page?.loading || visibleChildCount > 0) return null;
  return (
    <div className="grid h-10 place-items-center text-selected-foreground">
      <LoaderCircleIcon className="size-3.5 animate-spin" />
    </div>
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
