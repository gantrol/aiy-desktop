import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowUpToLineIcon,
  FolderInputIcon,
  GalleryVerticalEndIcon,
  ImageIcon,
  ImagesIcon,
  LightbulbIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEventHandler,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type {
  AlbumDto,
  AssetDto,
  BootstrapDto,
  CreationDto,
  Locale,
  PromptSeriesDto,
  SidebarRootOrderTargetInput,
  VideoDocumentNavigationEntry,
  VideoDocumentSummaryDto,
} from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import {
  ALBUM_DRAG_TYPE,
  CREATION_DRAG_TYPE,
  readCreationDrag,
  writeAlbumDrag,
  writeCreationDrag,
} from '@/renderer/components/albums/albumDrag';
import { AlbumMoveDialog, type AlbumMoveTarget } from '@/renderer/components/albums/AlbumMoveDialog';
import { AlbumTreePreview } from '@/renderer/components/albums/AlbumTreePreview';
import { buildAlbumTreeIndex, compareSidebarRootSortOrder } from '@/renderer/components/albums/albumTree';
import { createAlbumExpansionAction } from '@/renderer/components/albums/albumTreeMenuActions';
import { TreeDragHandle } from '@/renderer/components/albums/TreeDragHandle';
import {
  TreeBranchCollapseRail,
  TreeBranchCollapseProvider,
  TreeBranchContent,
  TreeBranchTransitRail,
  TreeDisclosureRail,
} from '@/renderer/components/albums/TreeDisclosureRail';
import {
  getTreeBranchItemTopology,
  type TreeBranchItemTopology,
} from '@/renderer/components/albums/treeConnectionGeometry';
import { useAlbumTreeExpansion } from '@/renderer/components/albums/useAlbumTreeExpansion';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { MediaStackPreview } from '@/renderer/components/media/MediaStackPreview';
import { ActionContextMenuItems, ActionMenuButton, type ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/renderer/components/ui/context-menu';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { QuietEmpty } from '@/renderer/components/ui/quiet-empty';
import { CreatorPaneResizeHandle } from '@/renderer/components/creator/CreatorPaneResizeHandle';
import { CreationCoverPickerDialog } from '@/renderer/components/creator/CreationCoverPickerDialog';
import {
  CreationLibraryToolbar,
  type CreationLibraryFilter,
} from '@/renderer/components/creator/CreationLibraryToolbar';
import { creationAlbumPreviewAssets } from '@/renderer/components/creator/creationAlbumPreviewAssets';
import {
  CompactCreationAlbumPreview,
  CreationSessionTreePreview,
  creationAlbumPreviewAssetLabel,
  indexCreationAssetNavigationTargets,
  resolveCreationAlbumPreviewTarget,
} from '@/renderer/components/creator/CreationLibraryMediaPreviews';
import {
  CreationDocumentAlbumPaging,
  CreationDocumentCompactItem,
  CreationDocumentRootPaging,
  CreationDocumentRow,
  creationAlbumCanExpand,
} from '@/renderer/components/creator/CreationDocumentLibraryItems';
import { AssetHoverPreview } from '@/renderer/components/creator/AssetHoverPreview';
import {
  buildCreationSessionProjection,
  type CreationSessionProjection,
} from '@/renderer/components/creator/creationSessionProjection';
import { creationSessionCoverFirstAssets } from '@/renderer/components/creator/creationCoverFirstAssets';
import { transferSourceUrl } from '@/renderer/components/creator/imageImport';
import { useVideoDocumentList } from '@/renderer/features/video-documents/useVideoDocumentList';
import { useVideoDocumentNavigation } from '@/renderer/features/video-documents/useVideoDocumentNavigation';

export type ResultLibraryMode = 'full' | 'images';
export type ResultLibrarySurface = 'new-creation' | 'idea-creation' | 'existing-creation' | 'album-detail';

interface Props {
  active: boolean;
  data: BootstrapDto;
  locale: Locale;
  activeContent: 'images' | 'documents';
  filter: CreationLibraryFilter;
  selectedSeriesId: string | null;
  selectedCreationId: string | null;
  selectedAlbumId: string | null;
  selectedDocumentId: string | null;
  selectedDocumentAlbumId: string | null;
  documentNavigationRevision: number;
  surface: ResultLibrarySurface;
  mode: ResultLibraryMode;
  canExpand: boolean;
  resizeValue: number;
  resizeMin: number;
  resizeMax: number;
  showModeToggle?: boolean;
  lifecycleBusy?: boolean;
  onModeChange(mode: ResultLibraryMode): void;
  onResizeStart(event: ReactPointerEvent<HTMLDivElement>): void;
  onResizeValueChange(value: number): void;
  onFilterChange(filter: CreationLibraryFilter): void;
  onSelectCreation(creationId: string): void;
  onDeleteCreation(creation: CreationDto): void;
  onSelect(seriesId: string, assetId?: string): void;
  onSelectDocument(documentId: string, albumId: string | null): void;
  onRenameDocument(document: VideoDocumentSummaryDto): void;
  onMoveDocument(documentId: string, albumId: string | null): Promise<void>;
  onSelectAlbum(albumId: string): void;
  onMore(seriesId: string): void;
  onNew(): void;
  onNewInAlbum(albumId: string): void;
  onRenameSeries(series: PromptSeriesDto): void;
  onDeleteSeries(series: PromptSeriesDto): void;
  onRenameAlbum(album: AlbumDto): void;
  onDeleteAlbum(album: AlbumDto): void;
  onToggleAlbumPin(album: AlbumDto): void;
  onSetAlbumArchived(album: AlbumDto, archived: boolean): void;
  onCreateAlbum(parent: AlbumDto | null): void;
  onMoveAlbum(albumId: string, parentAlbumId: string | null): Promise<void>;
  onMoveSeries(seriesIds: readonly string[], albumId: string | null): Promise<void>;
  onReorderMembers(albumId: string, memberIds: string[]): Promise<void>;
  onReorderRoot(targets: SidebarRootOrderTargetInput[]): Promise<void>;
  onCreationPresentationChange(): Promise<void>;
  onImportExternalFiles?(albumId: string, files: File[], sourceUrl: string): void;
  notify(message: string): void;
}

type MixedEntry =
  | { kind: 'ALBUM'; album: AlbumDto; activityAt: string; pinned: boolean; archived?: boolean }
  | { kind: 'SERIES'; session: CreationSessionProjection; activityAt: string; pinned: false; archived?: boolean }
  | {
      kind: 'DOCUMENT';
      entry: Extract<VideoDocumentNavigationEntry, { kind: 'DOCUMENT' }>;
      activityAt: string;
      pinned: false;
      archived?: boolean;
    };

type ResultMoveTarget = AlbumMoveTarget & { seriesIds?: string[] };
type DraggedTreeItem = { kind: 'ALBUM'; albumId: string } | { kind: 'CREATION'; seriesIds: string[] };
type DropPlacement = {
  parentAlbumId: string | null;
  targetKey: string;
  edge: 'before' | 'after';
};

function ResultLibraryMoveDialog({
  albums,
  target,
  busy,
  onOpenChange,
  onMoveAlbum,
  onMoveSeries,
  onMoveDocument,
}: {
  albums: readonly AlbumDto[];
  target: ResultMoveTarget | null;
  busy: boolean;
  onOpenChange(open: boolean): void;
  onMoveAlbum(albumId: string, parentAlbumId: string | null): Promise<void>;
  onMoveSeries(seriesIds: readonly string[], albumId: string | null): Promise<void>;
  onMoveDocument(documentId: string, albumId: string | null): Promise<void>;
}) {
  const { messages } = useI18n();
  const albumLabels = messages.creator.album;
  const documentTarget = target?.kind === 'DOCUMENT';
  return (
    <AlbumMoveDialog
      albums={albums}
      target={target}
      labels={{
        title: documentTarget ? messages.videoDocuments.moveTitle : albumLabels.moveTitle,
        topLevel: documentTarget ? messages.videoDocuments.unfiled : albumLabels.moveToRoot,
        operationFailed: documentTarget ? messages.videoDocuments.moveFailed : messages.gallery.albums.operationFailed,
      }}
      busy={busy}
      onOpenChange={onOpenChange}
      onMove={async (albumId) => {
        if (!target) return;
        if (target.kind === 'ALBUM') await onMoveAlbum(target.id, albumId);
        else if (target.kind === 'DOCUMENT') await onMoveDocument(target.id, albumId);
        else await onMoveSeries(target.seriesIds ?? [target.id], albumId);
      }}
    />
  );
}

function sessionActivity(session: CreationSessionProjection) {
  return (
    session.memberSeries
      .flatMap((series) => [
        ...series.versions.flatMap((version) => [version.createdAt, ...version.runs.map((run) => run.createdAt)]),
        ...(series.importedOutputs ?? []).map((output) => output.createdAt),
        ...(series.transformedOutputs ?? []).map((output) => output.createdAt),
      ])
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .at(-1) ?? ''
  );
}

function creationSessionTitle(session: CreationSessionProjection, locale: Locale) {
  if (!session.syntheticExperimentRoot) return session.primarySeries.title;
  return locale === 'zh' ? '方向实验' : 'Direction experiment';
}

function normalizeCreationLibraryQuery(query: string, locale: Locale) {
  return query.trim().toLocaleLowerCase(locale === 'zh' ? 'zh-CN' : 'en');
}

function creationLibraryNavigationFiltered(filter: CreationLibraryFilter, normalizedQuery: string) {
  return filter !== 'all' || Boolean(normalizedQuery);
}

function creationDocumentSearchActive(active: boolean, filter: CreationLibraryFilter, normalizedQuery: string) {
  return active && filter !== 'images' && Boolean(normalizedQuery);
}

function collectSessionAssets(session: CreationSessionProjection) {
  return creationSessionCoverFirstAssets(session);
}

function explicitCreationCoverAssetIds(
  series: Pick<PromptSeriesDto, 'explicitCoverAssetId' | 'explicitCoverAssetIds'> | null | undefined,
) {
  if (!series) return [];
  return series.explicitCoverAssetIds ?? (series.explicitCoverAssetId ? [series.explicitCoverAssetId] : []);
}

function creationCoverPickerView(session: CreationSessionProjection | null, locale: Locale) {
  if (!session) return { title: '', assets: [] as AssetDto[], explicitCoverAssetIds: [] as string[] };
  return {
    title: creationSessionTitle(session, locale),
    assets: collectSessionAssets(session).map(({ asset }) => asset),
    explicitCoverAssetIds: explicitCreationCoverAssetIds(session.primarySeries),
  };
}

function entryId(entry: MixedEntry) {
  if (entry.kind === 'ALBUM') return entry.album.id;
  if (entry.kind === 'SERIES') return entry.session.id;
  return entry.entry.documentId;
}

function compareEntries(left: MixedEntry, right: MixedEntry) {
  return (
    Number(right.pinned) - Number(left.pinned) ||
    right.activityAt.localeCompare(left.activityAt) ||
    entryId(left).localeCompare(entryId(right))
  );
}

function rootSortOrder(entry: MixedEntry) {
  if (entry.kind === 'ALBUM') return entry.album.creatorRootSortOrder ?? null;
  if (entry.kind === 'DOCUMENT') return entry.entry.sortOrder;
  const orders = entry.session.memberSeries.flatMap((series) =>
    series.creatorRootSortOrder == null ? [] : [series.creatorRootSortOrder],
  );
  return orders.length > 0 ? Math.min(...orders) : null;
}

function compareRootEntries(left: MixedEntry, right: MixedEntry) {
  const pinned = Number(right.pinned) - Number(left.pinned);
  if (pinned) return pinned;
  const rootOrder = compareSidebarRootSortOrder(rootSortOrder(left), rootSortOrder(right));
  if (rootOrder) return rootOrder;
  return compareEntries(left, right);
}

function navigationEntryForDocument(
  document: VideoDocumentSummaryDto,
): Extract<VideoDocumentNavigationEntry, { kind: 'DOCUMENT' }> {
  return {
    nodeId: `DOCUMENT:${document.id}`,
    kind: 'DOCUMENT',
    documentId: document.id,
    parentAlbumId: document.albumId,
    sortOrder: null,
    document,
  };
}

const rowControlsClassName =
  'pointer-events-none absolute inset-y-0 right-1 z-30 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100';
const rowControlClassName = 'pointer-events-auto shrink-0 rounded-md bg-overlay/95 shadow-overlay';
const compactItemClassName =
  'relative grid size-16 shrink-0 place-items-center overflow-visible rounded-xl bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring';
const compactSelectedClassName =
  'after:pointer-events-none after:absolute after:top-1/2 after:-left-1 after:h-6 after:w-0.5 after:-translate-y-1/2 after:rounded-full after:bg-selected-foreground';
const rootRenderPageSize = 48;

interface ResultLibraryRowButtonProps {
  label: string;
  current: boolean;
  expanded?: boolean;
  onExpandedChange?(expanded: boolean): void;
  onClick: MouseEventHandler<HTMLButtonElement>;
  onDoubleClick?: MouseEventHandler<HTMLButtonElement>;
}

function ResultLibraryRowButton({
  label,
  current,
  expanded,
  onExpandedChange,
  onClick,
  onDoubleClick,
}: ResultLibraryRowButtonProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!onExpandedChange) return;
    if (event.key === 'ArrowRight' && !expanded) {
      event.preventDefault();
      onExpandedChange(true);
    } else if (event.key === 'ArrowLeft' && expanded) {
      event.preventDefault();
      onExpandedChange(false);
    }
  }

  return (
    <button
      type="button"
      aria-label={label}
      aria-current={current ? 'page' : undefined}
      className="absolute inset-0 z-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={handleKeyDown}
    />
  );
}

function CreationLibraryEmptyState({
  empty,
  filtered,
  includeDocuments,
  queryActive,
  searchLoading,
  rootLoading,
  title,
  filteredTitle,
  actionLabel,
  actionDisabled,
  onAction,
}: {
  empty: boolean;
  filtered: boolean;
  includeDocuments: boolean;
  queryActive: boolean;
  searchLoading: boolean;
  rootLoading: boolean;
  title: string;
  filteredTitle: string;
  actionLabel: string;
  actionDisabled: boolean;
  onAction(): void;
}) {
  if (!empty || searchLoading || (includeDocuments && !queryActive && rootLoading)) return null;
  if (filtered) {
    return (
      <div className="grid justify-items-center px-6 py-10 text-center">
        <strong className="text-sm font-medium">{filteredTitle}</strong>
      </div>
    );
  }
  return <QuietEmpty title={title} actionLabel={actionLabel} actionDisabled={actionDisabled} onAction={onAction} />;
}

export function ResultLibrary({
  active,
  data,
  locale,
  activeContent,
  filter,
  selectedSeriesId,
  selectedCreationId,
  selectedAlbumId,
  selectedDocumentId,
  selectedDocumentAlbumId,
  documentNavigationRevision,
  surface,
  mode,
  canExpand,
  resizeValue,
  resizeMin,
  resizeMax,
  showModeToggle = true,
  lifecycleBusy = false,
  onModeChange,
  onResizeStart,
  onResizeValueChange,
  onFilterChange,
  onSelectCreation,
  onSelect,
  onSelectDocument,
  onRenameDocument,
  onMoveDocument,
  onSelectAlbum,
  onMore,
  onNew,
  onNewInAlbum,
  onRenameSeries,
  onDeleteSeries,
  onRenameAlbum,
  onDeleteAlbum,
  onToggleAlbumPin,
  onSetAlbumArchived,
  onCreateAlbum,
  onMoveAlbum,
  onMoveSeries,
  onReorderMembers,
  onReorderRoot,
  onCreationPresentationChange,
  onImportExternalFiles,
  notify,
}: Props) {
  const { messages } = useI18n();
  const l = messages.creator.results;
  const a = messages.creator.album;
  const presentation = messages.creator.outputPresentation;
  const [query, setQuery] = useState('');
  const [coverPickerSessionId, setCoverPickerSessionId] = useState<string | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const normalizedQuery = normalizeCreationLibraryQuery(query, locale);
  const navigationFiltered = creationLibraryNavigationFiltered(filter, normalizedQuery);
  const includeDocuments = filter !== 'images';
  const documentNavigation = useVideoDocumentNavigation({
    active,
    refreshKey: documentNavigationRevision,
    notify,
  });
  const ensureDocumentChildren = documentNavigation.ensureChildren;
  const documentSearch = useVideoDocumentList({
    active: creationDocumentSearchActive(active, filter, normalizedQuery),
    refreshKey: documentNavigationRevision,
    query: normalizedQuery,
    albumId: null,
    unfiledOnly: false,
    notify,
  });
  const [pendingAlbumParents, setPendingAlbumParents] = useState<ReadonlyMap<string, string | null>>(() => new Map());
  const [pendingSeriesAlbums, setPendingSeriesAlbums] = useState<ReadonlyMap<string, string | null>>(() => new Map());
  const [pendingMemberOrders, setPendingMemberOrders] = useState<ReadonlyMap<string, readonly string[]>>(
    () => new Map(),
  );
  const [pendingRootTargets, setPendingRootTargets] = useState<readonly SidebarRootOrderTargetInput[] | null>(null);
  const displayedAlbums = useMemo(
    () =>
      data.albums.map((album) => {
        const pendingOrder = pendingMemberOrders.get(album.id);
        if (!pendingOrder) return album;
        const orderByMemberId = new Map(pendingOrder.map((memberId, index) => [memberId, index] as const));
        return {
          ...album,
          members: album.members.map((member) => ({
            ...member,
            sortOrder: orderByMemberId.get(member.id) ?? member.sortOrder,
          })),
        };
      }),
    [data.albums, pendingMemberOrders],
  );
  const tree = useMemo(
    () => buildAlbumTreeIndex(displayedAlbums, pendingAlbumParents),
    [displayedAlbums, pendingAlbumParents],
  );
  const sessions = useMemo(
    () => buildCreationSessionProjection(data.series, data.styleExplorationBatches),
    [data.series, data.styleExplorationBatches],
  );
  const sessionActivityById = useMemo(
    () => new Map(sessions.map((session) => [session.id, sessionActivity(session)])),
    [sessions],
  );
  const sessionAssetsById = useMemo(
    () => new Map(sessions.map((session) => [session.id, collectSessionAssets(session)])),
    [sessions],
  );
  const creationTargetsByAssetId = useMemo(
    () => indexCreationAssetNavigationTargets(sessionAssetsById),
    [sessionAssetsById],
  );
  const coverPickerSession = sessions.find((session) => session.id === coverPickerSessionId) ?? null;
  const coverPickerView = creationCoverPickerView(coverPickerSession, locale);
  const albumBySeriesId = useMemo(() => {
    const result = new Map<string, string>();
    for (const album of data.albums) {
      for (const member of album.members) {
        if (member.targetType === 'SERIES') result.set(member.targetId, album.id);
      }
    }
    for (const [seriesId, albumId] of pendingSeriesAlbums) {
      if (albumId) result.set(seriesId, albumId);
      else result.delete(seriesId);
    }
    return result;
  }, [data.albums, pendingSeriesAlbums]);
  const albumBySessionId = useMemo(() => {
    const result = new Map<string, string>();
    for (const session of sessions) {
      const albumId =
        albumBySeriesId.get(session.primarySeries.id) ??
        session.memberSeries.map((series) => albumBySeriesId.get(series.id)).find(Boolean);
      if (albumId) result.set(session.id, albumId);
    }
    return result;
  }, [albumBySeriesId, sessions]);
  const sessionsByAlbumId = useMemo(() => {
    const result = new Map<string, CreationSessionProjection[]>();
    for (const session of sessions) {
      const albumId = albumBySessionId.get(session.id);
      if (!albumId) continue;
      const current = result.get(albumId) ?? [];
      current.push(session);
      result.set(albumId, current);
    }
    for (const current of result.values())
      current.sort(
        (left, right) =>
          (sessionActivityById.get(right.id) ?? '').localeCompare(sessionActivityById.get(left.id) ?? '') ||
          left.id.localeCompare(right.id),
      );
    return result;
  }, [albumBySessionId, sessionActivityById, sessions]);
  const activeIdeaCreations = useMemo(
    () => (data.creations ?? []).filter((creation) => creation.status !== 'ARCHIVED'),
    [data.creations],
  );
  const ideaCreationBySessionId = useMemo(() => {
    const sessionIdBySeriesId = new Map(
      sessions.flatMap((session) => session.memberSeries.map((series) => [series.id, session.id] as const)),
    );
    const result = new Map<string, CreationDto>();
    for (const creation of activeIdeaCreations) {
      if (creation.sourceScope.kind !== 'SERIES') continue;
      const sessionId = sessionIdBySeriesId.get(creation.sourceScope.id);
      if (!sessionId) continue;
      const current = result.get(sessionId);
      if (!current || creation.updatedAt.localeCompare(current.updatedAt) > 0) result.set(sessionId, creation);
    }
    return result;
  }, [activeIdeaCreations, sessions]);
  const unassignedSessions = useMemo(
    () => sessions.filter((session) => !albumBySessionId.has(session.id)),
    [albumBySessionId, sessions],
  );
  const rootDocumentEntries = useMemo(
    () =>
      documentNavigation.root.items.flatMap((entry): MixedEntry[] =>
        entry.kind === 'DOCUMENT'
          ? [{ kind: 'DOCUMENT', entry, activityAt: entry.document.updatedAt, pinned: false }]
          : [],
      ),
    [documentNavigation.root.items],
  );
  const documentAlbumEntryById = useMemo(() => {
    const result = new Map<string, Extract<VideoDocumentNavigationEntry, { kind: 'ALBUM' }>>();
    const pages = [documentNavigation.root, ...Object.values(documentNavigation.children)];
    for (const page of pages) {
      for (const entry of page.items) {
        if (entry.kind === 'ALBUM') result.set(entry.albumId, entry);
      }
    }
    return result;
  }, [documentNavigation.children, documentNavigation.root]);
  const rootEntries = useMemo<MixedEntry[]>(() => {
    const entries: MixedEntry[] = [
      ...tree.activeRoots.map((album) => ({
        kind: 'ALBUM' as const,
        album,
        activityAt: album.activityAt,
        pinned: album.pinned,
      })),
      ...unassignedSessions.map((session) => ({
        kind: 'SERIES' as const,
        session,
        activityAt: sessionActivityById.get(session.id) ?? '',
        pinned: false as const,
      })),
      ...rootDocumentEntries,
    ];
    if (!pendingRootTargets) return entries.sort(compareRootEntries);
    const orderByTarget = new Map(
      pendingRootTargets.map((target, index) => [`${target.targetType}:${target.targetId}`, index] as const),
    );
    const pendingOrder = (entry: MixedEntry) => {
      if (entry.kind === 'ALBUM') return orderByTarget.get(`ALBUM:${entry.album.id}`) ?? null;
      if (entry.kind === 'DOCUMENT') return entry.entry.sortOrder;
      const orders = entry.session.memberSeries.flatMap((series) => {
        const order = orderByTarget.get(`SERIES:${series.id}`);
        return order == null ? [] : [order];
      });
      return orders.length ? Math.min(...orders) : null;
    };
    return entries.sort((left, right) => {
      const pinned = Number(right.pinned) - Number(left.pinned);
      if (pinned) return pinned;
      const rootOrder = compareSidebarRootSortOrder(pendingOrder(left), pendingOrder(right));
      if (rootOrder) return rootOrder;
      return compareEntries(left, right);
    });
  }, [pendingRootTargets, rootDocumentEntries, sessionActivityById, tree.activeRoots, unassignedSessions]);
  const displayedRootEntries = useMemo<MixedEntry[]>(() => {
    if (!normalizedQuery) {
      return rootEntries.filter(
        (entry) =>
          entry.kind === 'ALBUM' ||
          filter === 'all' ||
          (filter === 'images' && entry.kind === 'SERIES') ||
          (filter === 'documents' && entry.kind === 'DOCUMENT'),
      );
    }

    const albumEntries = displayedAlbums.flatMap((album): MixedEntry[] =>
      !tree.effectivelyArchived.has(album.id) &&
      album.title.toLocaleLowerCase(locale === 'zh' ? 'zh-CN' : 'en').includes(normalizedQuery)
        ? [{ kind: 'ALBUM', album, activityAt: album.activityAt, pinned: album.pinned }]
        : [],
    );
    const sessionEntries =
      filter === 'documents'
        ? []
        : sessions.flatMap((session): MixedEntry[] => {
            const albumId = albumBySessionId.get(session.id);
            if (albumId && tree.effectivelyArchived.has(albumId)) return [];
            return creationSessionTitle(session, locale)
              .toLocaleLowerCase(locale === 'zh' ? 'zh-CN' : 'en')
              .includes(normalizedQuery)
              ? [
                  {
                    kind: 'SERIES',
                    session,
                    activityAt: sessionActivityById.get(session.id) ?? '',
                    pinned: false,
                  },
                ]
              : [];
          });
    const documentEntries =
      filter === 'images'
        ? []
        : documentSearch.items.flatMap((document): MixedEntry[] =>
            document.albumId && tree.effectivelyArchived.has(document.albumId)
              ? []
              : [
                  {
                    kind: 'DOCUMENT',
                    entry: navigationEntryForDocument(document),
                    activityAt: document.updatedAt,
                    pinned: false,
                  },
                ],
          );
    return [...albumEntries, ...sessionEntries, ...documentEntries].sort(compareEntries);
  }, [
    displayedAlbums,
    albumBySessionId,
    documentSearch.items,
    filter,
    locale,
    normalizedQuery,
    rootEntries,
    sessionActivityById,
    sessions,
    tree.effectivelyArchived,
  ]);
  const albumViewportRef = useRef<HTMLDivElement>(null);
  const compactViewportRef = useRef<HTMLDivElement>(null);
  const rootPageEndRef = useRef<HTMLDivElement>(null);
  const albumExpansion = useAlbumTreeExpansion(albumViewportRef);
  const expandedAlbumIds = albumExpansion.openIds;
  const setPersistentAlbumExpansion = albumExpansion.setPersistent;
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [dropAlbumId, setDropAlbumId] = useState<string | null>(null);
  const [rootDropActive, setRootDropActive] = useState(false);
  const [rootDropEligible, setRootDropEligible] = useState(false);
  const [draggedTreeItem, setDraggedTreeItem] = useState<DraggedTreeItem | null>(null);
  const [dropPlacement, setDropPlacement] = useState<DropPlacement | null>(null);
  const [moveTarget, setMoveTarget] = useState<ResultMoveTarget | null>(null);
  const [compactPreview, setCompactPreview] = useState<{ entryKey: string; asset: AssetDto } | null>(null);
  const selectedAlbumArchived = Boolean(selectedAlbumId && tree.effectivelyArchived.has(selectedAlbumId));
  const selectedRootIndex = useMemo(() => {
    const rootAlbumId = (albumId: string | null | undefined) => {
      let current = albumId ?? undefined;
      const visited = new Set<string>();
      while (current && !visited.has(current)) {
        visited.add(current);
        const parent = tree.parentById.get(current);
        if (!parent) return current;
        current = parent;
      }
      return current ?? null;
    };
    const selectedSession = selectedSeriesId
      ? sessions.find((session) => session.memberSeries.some((series) => series.id === selectedSeriesId))
      : selectedCreationId
        ? sessions.find((session) => ideaCreationBySessionId.get(session.id)?.id === selectedCreationId)
        : null;
    const targetAlbumId = rootAlbumId(
      activeContent === 'documents'
        ? selectedDocumentAlbumId
        : (selectedAlbumId ?? (selectedSession ? albumBySessionId.get(selectedSession.id) : null)),
    );
    return displayedRootEntries.findIndex((entry) =>
      entry.kind === 'ALBUM'
        ? entry.album.id === targetAlbumId
        : entry.kind === 'SERIES'
          ? Boolean(selectedSession && entry.session.id === selectedSession.id && !targetAlbumId)
          : entry.entry.documentId === selectedDocumentId,
    );
  }, [
    albumBySessionId,
    activeContent,
    ideaCreationBySessionId,
    displayedRootEntries,
    selectedAlbumId,
    selectedCreationId,
    selectedDocumentId,
    selectedDocumentAlbumId,
    selectedSeriesId,
    sessions,
    tree.parentById,
  ]);
  const [renderedRootCount, setRenderedRootCount] = useState(rootRenderPageSize);
  useEffect(() => {
    setRenderedRootCount((current) =>
      Math.min(displayedRootEntries.length, Math.max(rootRenderPageSize, selectedRootIndex + 1, current)),
    );
  }, [displayedRootEntries.length, selectedRootIndex]);
  const renderedRootEntries = useMemo(
    () => displayedRootEntries.slice(0, renderedRootCount),
    [displayedRootEntries, renderedRootCount],
  );
  const compactEntries = useMemo(() => (mode === 'images' ? renderedRootEntries : []), [mode, renderedRootEntries]);

  useEffect(() => {
    const target = rootPageEndRef.current;
    const viewport = mode === 'images' ? compactViewportRef.current : albumViewportRef.current;
    if (!target || !viewport || renderedRootCount >= displayedRootEntries.length) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setRenderedRootCount((current) => Math.min(displayedRootEntries.length, current + rootRenderPageSize));
      },
      { root: viewport, rootMargin: '240px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [displayedRootEntries.length, mode, renderedRootCount]);

  useEffect(() => {
    if (!active) return;
    const selectedSession =
      surface === 'existing-creation' && selectedSeriesId
        ? sessions.find((session) => session.memberSeries.some((series) => series.id === selectedSeriesId))
        : null;
    const targetAlbumId =
      activeContent === 'documents'
        ? selectedDocumentAlbumId
        : surface === 'album-detail'
          ? selectedAlbumId
          : selectedSession
            ? (albumBySessionId.get(selectedSession.id) ?? null)
            : null;
    if (!targetAlbumId || !tree.byId.has(targetAlbumId)) return;
    if (tree.effectivelyArchived.has(targetAlbumId)) setArchivedOpen(true);

    const ancestors: string[] = [];
    const visited = new Set<string>();
    let currentId =
      activeContent === 'images' && surface === 'album-detail' ? tree.parentById.get(targetAlbumId) : targetAlbumId;
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      ancestors.push(currentId);
      currentId = tree.parentById.get(currentId);
    }
    ancestors.reverse().forEach((albumId) => {
      setPersistentAlbumExpansion(albumId, true);
      if (includeDocuments && !tree.effectivelyArchived.has(albumId)) ensureDocumentChildren(albumId);
    });
  }, [
    active,
    activeContent,
    albumBySessionId,
    ensureDocumentChildren,
    includeDocuments,
    selectedAlbumId,
    selectedSeriesId,
    selectedDocumentAlbumId,
    sessions,
    setPersistentAlbumExpansion,
    surface,
    tree.byId,
    tree.effectivelyArchived,
    tree.parentById,
  ]);

  useEffect(() => {
    if (!active || !includeDocuments) return;
    for (const albumId of expandedAlbumIds) {
      if (tree.byId.has(albumId) && !tree.effectivelyArchived.has(albumId)) ensureDocumentChildren(albumId);
    }
  }, [
    active,
    documentNavigationRevision,
    ensureDocumentChildren,
    expandedAlbumIds,
    includeDocuments,
    tree.byId,
    tree.effectivelyArchived,
  ]);

  useEffect(() => {
    if (surface === 'new-creation') return undefined;
    let revealFrame = 0;
    const layoutFrame = window.requestAnimationFrame(() => {
      revealFrame = window.requestAnimationFrame(() => {
        const viewport = mode === 'images' ? compactViewportRef.current : albumViewportRef.current;
        const selected = viewport?.querySelector<HTMLElement>('[data-result-library-selected="true"]');
        if (!viewport || !selected) return;
        const viewportRect = viewport.getBoundingClientRect();
        const selectedRect = selected.getBoundingClientRect();
        const inset = 8;
        if (selectedRect.top < viewportRect.top + inset) {
          viewport.scrollBy({ top: selectedRect.top - viewportRect.top - inset });
        } else if (selectedRect.bottom > viewportRect.bottom - inset) {
          viewport.scrollBy({ top: selectedRect.bottom - viewportRect.bottom + inset });
        }
      });
    });
    return () => {
      window.cancelAnimationFrame(layoutFrame);
      if (revealFrame) window.cancelAnimationFrame(revealFrame);
    };
  }, [
    activeContent,
    compactEntries,
    mode,
    selectedAlbumId,
    selectedCreationId,
    selectedDocumentId,
    selectedSeriesId,
    surface,
  ]);

  function sessionAssets(session: CreationSessionProjection) {
    return sessionAssetsById.get(session.id) ?? [];
  }

  function sessionTitle(session: CreationSessionProjection) {
    return creationSessionTitle(session, locale);
  }

  function sessionSelected(session: CreationSessionProjection) {
    return (
      activeContent === 'images' &&
      surface === 'existing-creation' &&
      session.memberSeries.some((series) => series.id === selectedSeriesId)
    );
  }

  async function updateCreationCovers(imageAssetIds: readonly string[]) {
    const target = coverPickerSession;
    if (!target || coverBusy) return;
    setCoverBusy(true);
    try {
      await window.desktopApi.promptSeriesCoverSet({
        seriesId: target.primarySeries.id,
        imageAssetIds: [...imageAssetIds],
      });
      await onCreationPresentationChange();
      setCoverPickerSessionId(null);
      notify(imageAssetIds.length > 0 ? presentation.coverSet : presentation.automaticCoverSet);
    } catch (reason) {
      notify(`${presentation.actionFailed}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setCoverBusy(false);
    }
  }

  function setAlbumExpanded(albumId: string, open: boolean) {
    setPersistentAlbumExpansion(albumId, open);
    if (open && includeDocuments && tree.byId.has(albumId) && !tree.effectivelyArchived.has(albumId)) {
      ensureDocumentChildren(albumId);
    }
  }

  function setAlbumHoverExpanded(albumId: string, open: boolean) {
    albumExpansion.setHover(albumId, open);
    if (open && includeDocuments && tree.byId.has(albumId) && !tree.effectivelyArchived.has(albumId)) {
      ensureDocumentChildren(albumId);
    }
  }

  function wouldCreateAlbumCycle(albumId: string, parentAlbumId: string | null) {
    const visited = new Set<string>();
    let currentId = parentAlbumId ?? undefined;
    while (currentId && !visited.has(currentId)) {
      if (currentId === albumId) return true;
      visited.add(currentId);
      currentId = tree.parentById.get(currentId);
    }
    return false;
  }

  async function requestAlbumMove(albumId: string, parentAlbumId: string | null) {
    const currentParentId = tree.parentById.get(albumId) ?? null;
    if (currentParentId === parentAlbumId || wouldCreateAlbumCycle(albumId, parentAlbumId)) return;
    setPendingAlbumParents((current) => {
      const next = new Map(current);
      next.set(albumId, parentAlbumId);
      return next;
    });
    try {
      await onMoveAlbum(albumId, parentAlbumId);
    } finally {
      setPendingAlbumParents((current) => {
        if (!current.has(albumId) || current.get(albumId) !== parentAlbumId) return current;
        const next = new Map(current);
        next.delete(albumId);
        return next;
      });
    }
  }

  async function requestSeriesMove(seriesIds: readonly string[], albumId: string | null) {
    const uniqueSeriesIds = [...new Set(seriesIds)];
    if (
      !uniqueSeriesIds.length ||
      uniqueSeriesIds.every((seriesId) => (albumBySeriesId.get(seriesId) ?? null) === albumId)
    )
      return;
    setPendingSeriesAlbums((current) => {
      const next = new Map(current);
      uniqueSeriesIds.forEach((seriesId) => next.set(seriesId, albumId));
      return next;
    });
    try {
      await onMoveSeries(uniqueSeriesIds, albumId);
    } finally {
      setPendingSeriesAlbums((current) => {
        const next = new Map(current);
        let changed = false;
        uniqueSeriesIds.forEach((seriesId) => {
          if (!next.has(seriesId) || next.get(seriesId) !== albumId) return;
          next.delete(seriesId);
          changed = true;
        });
        return changed ? next : current;
      });
    }
  }

  async function requestMemberReorder(albumId: string, memberIds: readonly string[]) {
    const nextOrder = [...memberIds];
    setPendingMemberOrders((current) => {
      const next = new Map(current);
      next.set(albumId, nextOrder);
      return next;
    });
    try {
      await onReorderMembers(albumId, nextOrder);
    } finally {
      setPendingMemberOrders((current) => {
        const pending = current.get(albumId);
        if (!pending || pending.length !== nextOrder.length || pending.some((id, index) => id !== nextOrder[index])) {
          return current;
        }
        const next = new Map(current);
        next.delete(albumId);
        return next;
      });
    }
  }

  async function requestRootReorder(targets: readonly SidebarRootOrderTargetInput[]) {
    const nextTargets = [...targets];
    setPendingRootTargets(nextTargets);
    try {
      await onReorderRoot(nextTargets);
    } finally {
      setPendingRootTargets((current) => {
        if (
          !current ||
          current.length !== nextTargets.length ||
          current.some(
            (target, index) =>
              target.targetType !== nextTargets[index]?.targetType || target.targetId !== nextTargets[index]?.targetId,
          )
        ) {
          return current;
        }
        return null;
      });
    }
  }

  function orderedAlbumMembers(album: AlbumDto) {
    return [...album.members].sort(
      (left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
    );
  }

  function childEntryKey(entry: MixedEntry) {
    if (entry.kind === 'ALBUM') return `ALBUM:${entry.album.id}`;
    if (entry.kind === 'SERIES') return `SERIES:${entry.session.id}`;
    return `DOCUMENT:${entry.entry.documentId}`;
  }

  function memberIdsForEntry(album: AlbumDto, entry: MixedEntry) {
    if (entry.kind === 'ALBUM') {
      return orderedAlbumMembers(album)
        .filter((member) => member.targetType === 'ALBUM' && member.targetId === entry.album.id)
        .map((member) => member.id);
    }
    if (entry.kind === 'DOCUMENT') return [];
    const seriesIds = new Set(entry.session.memberSeries.map((series) => series.id));
    return orderedAlbumMembers(album)
      .filter((member) => member.targetType === 'SERIES' && seriesIds.has(member.targetId))
      .map((member) => member.id);
  }

  function memberIdsForDraggedItem(album: AlbumDto, dragged: DraggedTreeItem | null) {
    if (!dragged) return [];
    if (dragged.kind === 'ALBUM') {
      if (tree.parentById.get(dragged.albumId) !== album.id) return [];
      return orderedAlbumMembers(album)
        .filter((member) => member.targetType === 'ALBUM' && member.targetId === dragged.albumId)
        .map((member) => member.id);
    }
    if (!dragged.seriesIds.every((seriesId) => albumBySeriesId.get(seriesId) === album.id)) return [];
    const seriesIds = new Set(dragged.seriesIds);
    return orderedAlbumMembers(album)
      .filter((member) => member.targetType === 'SERIES' && seriesIds.has(member.targetId))
      .map((member) => member.id);
  }

  function rootTargetsForEntry(entry: MixedEntry): SidebarRootOrderTargetInput[] {
    if (entry.kind === 'ALBUM') return [{ targetType: 'ALBUM', targetId: entry.album.id }];
    if (entry.kind === 'SERIES')
      return entry.session.memberSeries.map((series) => ({ targetType: 'SERIES', targetId: series.id }));
    return [];
  }

  function rootTargetKey(target: SidebarRootOrderTargetInput) {
    return `${target.targetType}:${target.targetId}`;
  }

  function rootTargetsForDraggedItem(dragged: DraggedTreeItem | null) {
    if (!dragged) return [];
    if (dragged.kind === 'ALBUM') {
      return tree.parentById.has(dragged.albumId) ? [] : [{ targetType: 'ALBUM' as const, targetId: dragged.albumId }];
    }
    if (dragged.seriesIds.some((seriesId) => albumBySeriesId.has(seriesId))) return [];
    return dragged.seriesIds.map((seriesId) => ({ targetType: 'SERIES' as const, targetId: seriesId }));
  }

  function orderedRootTargets() {
    return rootEntries.flatMap(rootTargetsForEntry);
  }

  async function requestRootPlacement(
    movingTargets: readonly SidebarRootOrderTargetInput[],
    targetTargets: readonly SidebarRootOrderTargetInput[],
    edge: 'before' | 'after',
  ) {
    const movingKeys = new Set(movingTargets.map(rootTargetKey));
    const targetKeys = new Set(targetTargets.map(rootTargetKey));
    if (!movingKeys.size || [...targetKeys].some((key) => movingKeys.has(key))) return;
    const current = orderedRootTargets();
    const movingInOrder = current.filter((target) => movingKeys.has(rootTargetKey(target)));
    const next = current.filter((target) => !movingKeys.has(rootTargetKey(target)));
    const targetIndexes = next
      .map((target, index) => (targetKeys.has(rootTargetKey(target)) ? index : -1))
      .filter((index) => index >= 0);
    if (!movingInOrder.length || !targetIndexes.length) return;
    const insertionIndex = edge === 'before' ? Math.min(...targetIndexes) : Math.max(...targetIndexes) + 1;
    next.splice(insertionIndex, 0, ...movingInOrder);
    if (next.every((target, index) => rootTargetKey(target) === rootTargetKey(current[index]))) return;
    await requestRootReorder(next);
  }

  async function requestMemberPlacement(
    album: AlbumDto,
    movingMemberIds: readonly string[],
    targetMemberIds: readonly string[],
    edge: 'before' | 'after',
  ) {
    const moving = new Set(movingMemberIds);
    if (!moving.size || targetMemberIds.some((memberId) => moving.has(memberId))) return;
    const currentOrder = orderedAlbumMembers(album).map((member) => member.id);
    const movingInOrder = currentOrder.filter((memberId) => moving.has(memberId));
    const nextOrder = currentOrder.filter((memberId) => !moving.has(memberId));
    const targetIndexes = targetMemberIds.map((memberId) => nextOrder.indexOf(memberId)).filter((index) => index >= 0);
    if (!movingInOrder.length || !targetIndexes.length) return;
    const insertionIndex = edge === 'before' ? Math.min(...targetIndexes) : Math.max(...targetIndexes) + 1;
    nextOrder.splice(insertionIndex, 0, ...movingInOrder);
    if (nextOrder.every((memberId, index) => memberId === currentOrder[index])) return;
    await requestMemberReorder(album.id, nextOrder);
  }

  async function reorderEntryByStep(album: AlbumDto, entry: MixedEntry, archivedBranch: boolean, direction: -1 | 1) {
    if (entry.kind === 'DOCUMENT') return;
    const entries = childEntries(album, archivedBranch).filter(
      (candidate) => candidate.kind !== 'DOCUMENT' && candidate.pinned === entry.pinned,
    );
    const index = entries.findIndex((candidate) => childEntryKey(candidate) === childEntryKey(entry));
    const target = entries[index + direction];
    if (!target) return;
    await requestMemberPlacement(
      album,
      memberIdsForEntry(album, entry),
      memberIdsForEntry(album, target),
      direction < 0 ? 'before' : 'after',
    );
  }

  async function reorderRootEntryByStep(entry: MixedEntry, direction: -1 | 1) {
    if (entry.kind === 'DOCUMENT') return;
    const entries = rootEntries.filter(
      (candidate) => candidate.kind !== 'DOCUMENT' && candidate.pinned === entry.pinned,
    );
    const index = entries.findIndex((candidate) => childEntryKey(candidate) === childEntryKey(entry));
    const target = entries[index + direction];
    if (!target) return;
    await requestRootPlacement(
      rootTargetsForEntry(entry),
      rootTargetsForEntry(target),
      direction < 0 ? 'before' : 'after',
    );
  }

  function reorderEdge(
    event: DragEvent,
    album: AlbumDto | null,
    targetMemberIds: readonly string[],
    centerOpensAlbum: boolean,
  ) {
    if (!album || targetMemberIds.length === 0) return null;
    const movingMemberIds = memberIdsForDraggedItem(album, currentDraggedTreeItem(event));
    if (!movingMemberIds.length || targetMemberIds.some((memberId) => movingMemberIds.includes(memberId))) return null;
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = bounds.height > 0 ? (event.clientY - bounds.top) / bounds.height : 0.5;
    const upperThreshold = centerOpensAlbum ? 0.3 : 0.5;
    const lowerThreshold = centerOpensAlbum ? 0.7 : 0.5;
    if (position < upperThreshold) return { edge: 'before' as const, movingMemberIds };
    if (position > lowerThreshold) return { edge: 'after' as const, movingMemberIds };
    return null;
  }

  function rootReorderEdge(event: DragEvent, target: MixedEntry, centerOpensAlbum: boolean) {
    if (target.kind === 'DOCUMENT') return null;
    const dragged = currentDraggedTreeItem(event);
    if (dragged?.kind === 'ALBUM' && tree.byId.get(dragged.albumId)?.pinned !== target.pinned) return null;
    if (dragged?.kind === 'CREATION' && target.pinned) return null;
    const movingTargets = rootTargetsForDraggedItem(dragged);
    const targetTargets = rootTargetsForEntry(target);
    const movingKeys = new Set(movingTargets.map(rootTargetKey));
    if (!movingKeys.size || targetTargets.some((item) => movingKeys.has(rootTargetKey(item)))) return null;
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = bounds.height > 0 ? (event.clientY - bounds.top) / bounds.height : 0.5;
    const upperThreshold = centerOpensAlbum ? 0.3 : 0.5;
    const lowerThreshold = centerOpensAlbum ? 0.7 : 0.5;
    if (position < upperThreshold) return { edge: 'before' as const, movingTargets, targetTargets };
    if (position > lowerThreshold) return { edge: 'after' as const, movingTargets, targetTargets };
    return null;
  }

  function clearTreeDragState() {
    setDropAlbumId(null);
    setDropPlacement(null);
    setRootDropActive(false);
    setRootDropEligible(false);
    setDraggedTreeItem(null);
  }

  function startCreationDrag(event: DragEvent, seriesIds: readonly string[]) {
    event.stopPropagation();
    const uniqueSeriesIds = [...new Set(seriesIds)];
    writeCreationDrag(event.dataTransfer, uniqueSeriesIds);
    setDraggedTreeItem({ kind: 'CREATION', seriesIds: uniqueSeriesIds });
    setRootDropEligible(uniqueSeriesIds.some((seriesId) => albumBySeriesId.has(seriesId)));
  }

  function startAlbumDrag(event: DragEvent, albumId: string) {
    event.stopPropagation();
    writeAlbumDrag(event.dataTransfer, albumId);
    setDraggedTreeItem({ kind: 'ALBUM', albumId });
    setRootDropEligible(tree.parentById.has(albumId));
  }

  function seriesActions(
    session: CreationSessionProjection,
    title: string,
    imageAssetIds: string[],
    memberSeriesIds: readonly string[],
    archivedBranch = false,
  ): ActionMenuAction[] {
    const series = session.primarySeries;
    const parentIds = new Set(memberSeriesIds.map((seriesId) => albumBySeriesId.get(seriesId) ?? null));
    const parentId = parentIds.size === 1 ? ([...parentIds][0] ?? null) : null;
    const parent = parentId ? (tree.byId.get(parentId) ?? null) : null;
    const entry = { kind: 'SERIES' as const, session, activityAt: sessionActivity(session), pinned: false as const };
    const siblings = parent
      ? childEntries(parent, archivedBranch).filter(
          (candidate) => candidate.kind !== 'DOCUMENT' && candidate.pinned === entry.pinned,
        )
      : rootEntries.filter((candidate) => candidate.kind !== 'DOCUMENT' && candidate.pinned === entry.pinned);
    const siblingIndex = siblings.findIndex((candidate) => childEntryKey(candidate) === childEntryKey(entry));
    return [
      { id: 'open', label: a.open, icon: ImageIcon, onSelect: () => onSelect(series.id) },
      ...(imageAssetIds.length > 3
        ? [
            {
              id: 'more-results',
              label: l.more,
              icon: ImagesIcon,
              onSelect: () => onMore(series.id),
            } satisfies ActionMenuAction,
          ]
        : []),
      {
        id: 'choose-creation-cover',
        label: explicitCreationCoverAssetIds(series).length > 0 ? presentation.changeCover : presentation.chooseCover,
        icon: ImageIcon,
        disabled: lifecycleBusy || archivedBranch || coverBusy || imageAssetIds.length === 0,
        onSelect: () => setCoverPickerSessionId(session.id),
      },
      {
        id: 'move',
        label: a.move,
        icon: FolderInputIcon,
        disabled: lifecycleBusy || archivedBranch,
        onSelect: () => {
          const currentAlbumIds = new Set(memberSeriesIds.map((seriesId) => albumBySeriesId.get(seriesId) ?? null));
          setMoveTarget({
            kind: 'CREATION',
            id: series.id,
            title,
            currentAlbumId: currentAlbumIds.size === 1 ? ([...currentAlbumIds][0] ?? null) : null,
            seriesIds: [...memberSeriesIds],
          });
        },
      },
      ...(siblings.length > 1
        ? ([
            {
              id: 'move-up',
              label: a.moveUp,
              icon: ArrowUpIcon,
              disabled: lifecycleBusy || archivedBranch || siblingIndex <= 0,
              onSelect: () =>
                void (
                  parent ? reorderEntryByStep(parent, entry, archivedBranch, -1) : reorderRootEntryByStep(entry, -1)
                ).catch(() => undefined),
            },
            {
              id: 'move-down',
              label: a.moveDown,
              icon: ArrowDownIcon,
              disabled: lifecycleBusy || archivedBranch || siblingIndex < 0 || siblingIndex >= siblings.length - 1,
              onSelect: () =>
                void (
                  parent ? reorderEntryByStep(parent, entry, archivedBranch, 1) : reorderRootEntryByStep(entry, 1)
                ).catch(() => undefined),
            },
          ] satisfies ActionMenuAction[])
        : []),
      {
        id: 'rename',
        label: a.rename,
        icon: PencilIcon,
        disabled: lifecycleBusy,
        onSelect: () => onRenameSeries(series),
      },
      {
        id: 'delete',
        label: a.delete,
        icon: Trash2Icon,
        destructive: true,
        separatorBefore: true,
        disabled: lifecycleBusy,
        onSelect: () => onDeleteSeries(series),
      },
    ];
  }

  function albumActions(
    album: AlbumDto,
    archivedBranch: boolean,
    expanded: boolean,
    hasChildren: boolean,
  ): ActionMenuAction[] {
    const ownArchived = Boolean(album.archivedAt);
    const parentId = tree.parentById.get(album.id);
    const parent = parentId ? (tree.byId.get(parentId) ?? null) : null;
    const entry = { kind: 'ALBUM' as const, album, activityAt: album.activityAt, pinned: album.pinned };
    const siblings = parent
      ? childEntries(parent, archivedBranch).filter(
          (candidate) => candidate.kind !== 'DOCUMENT' && candidate.pinned === entry.pinned,
        )
      : rootEntries.filter((candidate) => candidate.kind !== 'DOCUMENT' && candidate.pinned === entry.pinned);
    const siblingIndex = siblings.findIndex((candidate) => childEntryKey(candidate) === childEntryKey(entry));
    return [
      { id: 'open', label: a.openAlbum, icon: GalleryVerticalEndIcon, onSelect: () => onSelectAlbum(album.id) },
      ...(hasChildren
        ? [
            createAlbumExpansionAction({
              expanded,
              expandLabel: l.expand,
              collapseLabel: l.collapse,
              onExpandedChange: (open) => setAlbumExpanded(album.id, open),
            }),
          ]
        : []),
      {
        id: 'new-creation',
        label: l.newCreation,
        icon: PlusIcon,
        disabled: lifecycleBusy || archivedBranch,
        onSelect: () => onNewInAlbum(album.id),
      },
      {
        id: 'create-child',
        label: a.newSubAlbum,
        icon: PlusIcon,
        disabled: lifecycleBusy || archivedBranch,
        onSelect: () => onCreateAlbum(album),
      },
      {
        id: 'move',
        label: a.move,
        icon: FolderInputIcon,
        disabled: lifecycleBusy || archivedBranch,
        onSelect: () =>
          setMoveTarget({
            kind: 'ALBUM',
            id: album.id,
            title: album.title,
            currentAlbumId: tree.parentById.get(album.id) ?? null,
          }),
      },
      ...(siblings.length > 1
        ? ([
            {
              id: 'move-up',
              label: a.moveUp,
              icon: ArrowUpIcon,
              disabled: lifecycleBusy || archivedBranch || siblingIndex <= 0,
              onSelect: () =>
                void (
                  parent ? reorderEntryByStep(parent, entry, archivedBranch, -1) : reorderRootEntryByStep(entry, -1)
                ).catch(() => undefined),
            },
            {
              id: 'move-down',
              label: a.moveDown,
              icon: ArrowDownIcon,
              disabled: lifecycleBusy || archivedBranch || siblingIndex < 0 || siblingIndex >= siblings.length - 1,
              onSelect: () =>
                void (
                  parent ? reorderEntryByStep(parent, entry, archivedBranch, 1) : reorderRootEntryByStep(entry, 1)
                ).catch(() => undefined),
            },
          ] satisfies ActionMenuAction[])
        : []),
      {
        id: 'pin',
        label: album.pinned ? a.unpin : a.pin,
        icon: album.pinned ? PinOffIcon : PinIcon,
        disabled: lifecycleBusy,
        onSelect: () => onToggleAlbumPin(album),
      },
      ...(ownArchived
        ? [
            {
              id: 'archive',
              label: a.restore,
              icon: ArchiveRestoreIcon,
              disabled: lifecycleBusy,
              onSelect: () => onSetAlbumArchived(album, false),
            } satisfies ActionMenuAction,
          ]
        : archivedBranch
          ? []
          : [
              {
                id: 'archive',
                label: a.archive,
                icon: ArchiveIcon,
                disabled: lifecycleBusy,
                onSelect: () => onSetAlbumArchived(album, true),
              } satisfies ActionMenuAction,
            ]),
      {
        id: 'rename',
        label: a.rename,
        icon: PencilIcon,
        disabled: lifecycleBusy,
        onSelect: () => onRenameAlbum(album),
      },
      {
        id: 'delete',
        label: a.delete,
        icon: Trash2Icon,
        destructive: true,
        separatorBefore: true,
        disabled: lifecycleBusy,
        onSelect: () => onDeleteAlbum(album),
      },
    ];
  }

  function hasTreeDrag(event: DragEvent) {
    return event.dataTransfer.types.includes(ALBUM_DRAG_TYPE) || event.dataTransfer.types.includes(CREATION_DRAG_TYPE);
  }

  function currentDraggedTreeItem(event: DragEvent): DraggedTreeItem | null {
    if (draggedTreeItem) return draggedTreeItem;
    const albumId = event.dataTransfer.getData(ALBUM_DRAG_TYPE);
    if (albumId) return { kind: 'ALBUM', albumId };
    const seriesIds = readCreationDrag(event.dataTransfer);
    return seriesIds.length > 0 ? { kind: 'CREATION', seriesIds } : null;
  }

  function canDropIntoAlbum(event: DragEvent, albumId: string) {
    if (navigationFiltered) return false;
    const dragged = currentDraggedTreeItem(event);
    if (!dragged) return false;
    if (dragged.kind === 'ALBUM') {
      return dragged.albumId !== albumId && !wouldCreateAlbumCycle(dragged.albumId, albumId);
    }
    return dragged.seriesIds.some((seriesId) => albumBySeriesId.get(seriesId) !== albumId);
  }

  function canDropAtRoot(event: DragEvent) {
    if (navigationFiltered) return false;
    const dragged = currentDraggedTreeItem(event);
    if (!dragged) return false;
    if (dragged.kind === 'ALBUM') return tree.parentById.has(dragged.albumId);
    return dragged.seriesIds.some((seriesId) => albumBySeriesId.has(seriesId));
  }

  async function dropIntoAlbum(event: DragEvent, albumId: string) {
    event.preventDefault();
    event.stopPropagation();
    if (!canDropIntoAlbum(event, albumId)) {
      clearTreeDragState();
      return;
    }
    clearTreeDragState();
    const draggedAlbumId = event.dataTransfer.getData(ALBUM_DRAG_TYPE);
    if (draggedAlbumId) {
      const currentParentId = tree.parentById.get(draggedAlbumId) ?? null;
      if (draggedAlbumId !== albumId && currentParentId !== albumId) await requestAlbumMove(draggedAlbumId, albumId);
      return;
    }
    const seriesIds = readCreationDrag(event.dataTransfer);
    if (seriesIds.length > 0 && !seriesIds.every((seriesId) => albumBySeriesId.get(seriesId) === albumId)) {
      await requestSeriesMove(seriesIds, albumId);
    }
  }

  async function dropAtRoot(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!canDropAtRoot(event)) {
      clearTreeDragState();
      return;
    }
    clearTreeDragState();
    const albumId = event.dataTransfer.getData(ALBUM_DRAG_TYPE);
    if (albumId) {
      if (tree.parentById.has(albumId)) await requestAlbumMove(albumId, null);
      return;
    }
    const seriesIds = readCreationDrag(event.dataTransfer);
    if (seriesIds.length > 0 && !seriesIds.every((seriesId) => !albumBySeriesId.has(seriesId))) {
      await requestSeriesMove(seriesIds, null);
    }
  }

  function albumPreviewAssets(album: AlbumDto) {
    return creationAlbumPreviewAssets(album, filter);
  }

  function creationTargetForAlbumPreview(albumId: string, assetId: string) {
    return resolveCreationAlbumPreviewTarget(
      albumId,
      assetId,
      creationTargetsByAssetId,
      albumBySessionId,
      tree.parentById,
    );
  }

  function selectAlbumPreviewAsset(album: AlbumDto, asset: AssetDto) {
    const target = creationTargetForAlbumPreview(album.id, asset.id);
    if (target) onSelect(target.seriesId, asset.id);
    else onSelectAlbum(album.id);
  }

  function albumPreviewAssetLabel(album: AlbumDto, asset: AssetDto, index: number) {
    const target = creationTargetForAlbumPreview(album.id, asset.id);
    return creationAlbumPreviewAssetLabel(album, index, locale, target, a.open);
  }

  function updateCompactPreview(entryKey: string, asset: AssetDto | null) {
    setCompactPreview((current) => (asset ? { entryKey, asset } : current?.entryKey === entryKey ? null : current));
  }

  function renderSessionRow(
    session: CreationSessionProjection,
    archivedBranch = false,
    branchTopology?: TreeBranchItemTopology,
    parentAlbum: AlbumDto | null = null,
  ) {
    const primary = session.primarySeries;
    const assets = sessionAssets(session);
    const first = assets[0] ?? null;
    const ideaCreation = ideaCreationBySessionId.get(session.id) ?? null;
    const ideaSelected = Boolean(
      activeContent === 'images' &&
      ideaCreation &&
      surface === 'idea-creation' &&
      selectedCreationId === ideaCreation.id,
    );
    const selected = (sessionSelected(session) && !selectedAlbumId) || ideaSelected;
    const title = sessionTitle(session);
    const memberSeriesIds = session.memberSeries.map((series) => series.id);
    const entry = { kind: 'SERIES' as const, session, activityAt: sessionActivity(session), pinned: false as const };
    const targetKey = childEntryKey(entry);
    const targetMemberIds = parentAlbum ? memberIdsForEntry(parentAlbum, entry) : [];
    const targetRootTargets = parentAlbum ? [] : rootTargetsForEntry(entry);
    const actions = seriesActions(
      session,
      title,
      assets.map((item) => item.asset.id),
      memberSeriesIds,
      archivedBranch,
    );
    const previewItems = assets.map(({ asset, seriesId }) => ({
      asset,
      revealContext: { kind: 'CREATION' as const, seriesId },
    }));
    const selectAsset = (asset: (typeof assets)[number]['asset']) => {
      const owner = assets.find((record) => record.asset.id === asset.id)?.seriesId ?? primary.id;
      onSelect(owner, asset.id);
    };
    const selectSession = () => onSelect(first?.seriesId ?? primary.id, first?.asset.id);
    const row = (
      <div
        data-series-id={primary.id}
        data-result-library-selected={selected ? 'true' : undefined}
        role="group"
        aria-label={title}
        onDragEnter={(event) => {
          if (!hasTreeDrag(event)) return;
          event.stopPropagation();
          setRootDropActive(false);
          setDropAlbumId(null);
          const placement = reorderEdge(event, parentAlbum, targetMemberIds, false);
          const rootPlacement = parentAlbum ? null : rootReorderEdge(event, entry, false);
          if (!archivedBranch && !lifecycleBusy && (placement || rootPlacement)) {
            event.preventDefault();
            setDropPlacement({
              parentAlbumId: parentAlbum?.id ?? null,
              targetKey,
              edge: (placement ?? rootPlacement)!.edge,
            });
          } else {
            setDropPlacement(null);
          }
        }}
        onDragOver={(event) => {
          if (!hasTreeDrag(event)) return;
          event.stopPropagation();
          const placement = reorderEdge(event, parentAlbum, targetMemberIds, false);
          const rootPlacement = parentAlbum ? null : rootReorderEdge(event, entry, false);
          if (!archivedBranch && !lifecycleBusy && (placement || rootPlacement)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setDropPlacement({
              parentAlbumId: parentAlbum?.id ?? null,
              targetKey,
              edge: (placement ?? rootPlacement)!.edge,
            });
          } else {
            event.dataTransfer.dropEffect = 'none';
            setDropPlacement(null);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDropPlacement((current) => (current?.targetKey === targetKey ? null : current));
        }}
        onDrop={(event) => {
          if (!hasTreeDrag(event)) return;
          event.preventDefault();
          event.stopPropagation();
          const placement = reorderEdge(event, parentAlbum, targetMemberIds, false);
          const rootPlacement = parentAlbum ? null : rootReorderEdge(event, entry, false);
          if (!archivedBranch && !lifecycleBusy && placement && parentAlbum) {
            clearTreeDragState();
            void requestMemberPlacement(parentAlbum, placement.movingMemberIds, targetMemberIds, placement.edge).catch(
              () => undefined,
            );
          } else if (!archivedBranch && !lifecycleBusy && rootPlacement) {
            clearTreeDragState();
            void requestRootPlacement(rootPlacement.movingTargets, targetRootTargets, rootPlacement.edge).catch(
              () => undefined,
            );
          } else {
            clearTreeDragState();
          }
        }}
        className={cn(
          'group relative flex h-[4.25rem] min-w-0 cursor-pointer items-center gap-1 rounded-lg px-1 transition-colors hover:bg-hover',
          selected &&
            'text-selected-foreground before:pointer-events-none before:absolute before:inset-y-0.5 before:left-3 before:right-0 before:rounded-xl before:bg-selected hover:bg-transparent',
        )}
      >
        {dropPlacement?.targetKey === targetKey && (
          <span
            aria-hidden="true"
            data-result-reorder-indicator={dropPlacement.edge}
            className={cn(
              'pointer-events-none absolute inset-x-2 z-40 h-0.5 rounded-full bg-ring',
              dropPlacement.edge === 'before' ? '-top-px' : '-bottom-px',
            )}
          />
        )}
        <ResultLibraryRowButton label={`${a.open}: ${title}`} current={selected} onClick={selectSession} />
        <span className="relative z-20 flex shrink-0">
          <CreationSessionTreePreview
            items={previewItems}
            branchTopology={branchTopology}
            onAssetSelect={selectAsset}
            actions={actions}
            notify={notify}
          />
          {ideaCreation && (
            <button
              type="button"
              title={locale === 'zh' ? `打开灵感：${ideaCreation.title}` : `Open ideas: ${ideaCreation.title}`}
              aria-label={locale === 'zh' ? '打开灵感' : 'Open ideas'}
              aria-current={ideaSelected ? 'page' : undefined}
              className={cn(
                'absolute right-0 top-1 z-30 grid size-5 place-items-center rounded-full border bg-background text-foreground-secondary outline-none transition-colors hover:bg-hover-strong focus-visible:ring-2 focus-visible:ring-ring',
                ideaSelected && 'border-selected-foreground/30 text-selected-foreground',
              )}
              onClick={() => onSelectCreation(ideaCreation.id)}
            >
              <LightbulbIcon className="size-3" />
            </button>
          )}
        </span>
        <span className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center rounded-md px-1 text-left">
          <span
            className="line-clamp-2 min-w-0 flex-1 whitespace-normal break-words text-base font-medium leading-5"
            title={title}
          >
            {title}
          </span>
        </span>
        <div data-result-library-row-control className={rowControlsClassName}>
          {!lifecycleBusy && !navigationFiltered && !archivedBranch && (
            <TreeDragHandle
              label={locale === 'zh' ? '拖动创作' : 'Drag creation'}
              className={rowControlClassName}
              onDragStart={(event) => startCreationDrag(event, memberSeriesIds)}
              onDragEnd={clearTreeDragState}
            />
          )}
          <ActionMenuButton
            actions={actions}
            label={`${a.moreActions}: ${title}`}
            className={cn(rowControlClassName, 'size-6')}
          />
        </div>
      </div>
    );
    return (
      <ContextMenu key={session.id}>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <ContextMenuContent>
          <ActionContextMenuItems actions={actions} />
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  function renderDocumentRow(
    entry: Extract<VideoDocumentNavigationEntry, { kind: 'DOCUMENT' }>,
    branchTopology?: TreeBranchItemTopology,
  ) {
    return (
      <CreationDocumentRow
        key={entry.documentId}
        entry={entry}
        selected={activeContent === 'documents' && selectedDocumentId === entry.documentId}
        branchTopology={branchTopology}
        onSelectDocument={onSelectDocument}
        onRenameDocument={onRenameDocument}
        onMoveDocument={(document) =>
          setMoveTarget({
            kind: 'DOCUMENT',
            id: document.id,
            title: document.title,
            currentAlbumId: document.albumId,
          })
        }
      />
    );
  }

  function childEntries(album: AlbumDto, archivedBranch: boolean): MixedEntry[] {
    const entries: MixedEntry[] = [
      ...(tree.childrenByParentId.get(album.id) ?? [])
        .filter((child) => tree.effectivelyArchived.has(child.id) === archivedBranch)
        .map((child) => ({ kind: 'ALBUM' as const, album: child, activityAt: child.activityAt, pinned: child.pinned })),
      ...(filter === 'documents'
        ? []
        : (sessionsByAlbumId.get(album.id) ?? []).map((session) => ({
            kind: 'SERIES' as const,
            session,
            activityAt: sessionActivityById.get(session.id) ?? '',
            pinned: false as const,
          }))),
      ...(filter === 'images' || archivedBranch
        ? []
        : (documentNavigation.children[album.id]?.items ?? []).flatMap((entry): MixedEntry[] =>
            entry.kind === 'DOCUMENT'
              ? [{ kind: 'DOCUMENT', entry, activityAt: entry.document.updatedAt, pinned: false }]
              : [],
          )),
    ];
    const memberOrder = new Map(orderedAlbumMembers(album).map((member) => [member.id, member.sortOrder]));
    const entryRank = (entry: MixedEntry) =>
      entry.kind === 'DOCUMENT'
        ? (entry.entry.sortOrder ?? Number.MAX_SAFE_INTEGER)
        : Math.min(
            ...memberIdsForEntry(album, entry).map((memberId) => memberOrder.get(memberId) ?? Number.MAX_SAFE_INTEGER),
          );
    return entries.sort((left, right) => {
      const leftRank = entryRank(left);
      const rightRank = entryRank(right);
      return Number(right.pinned) - Number(left.pinned) || leftRank - rightRank || compareEntries(left, right);
    });
  }

  function renderAlbumDocumentPaging(
    albumId: string,
    expanded: boolean,
    includeAlbumDocuments: boolean,
    visibleChildCount: number,
  ) {
    return (
      <CreationDocumentAlbumPaging
        expanded={expanded}
        includeDocuments={includeAlbumDocuments}
        visibleChildCount={visibleChildCount}
        page={documentNavigation.children[albumId]}
        onLoadMore={() => documentNavigation.loadChildrenMore(albumId)}
      />
    );
  }

  function renderAlbumBranch(
    album: AlbumDto,
    archivedBranch: boolean,
    branchTopology?: TreeBranchItemTopology,
    parentAlbum: AlbumDto | null = null,
  ): ReactNode {
    const children = childEntries(album, archivedBranch);
    const documentChildPage = documentNavigation.children[album.id];
    const includeAlbumDocuments = includeDocuments && !archivedBranch;
    const documentCount = documentAlbumEntryById.get(album.id)?.descendantDocumentCount;
    const expandable = creationAlbumCanExpand(children.length, includeAlbumDocuments, documentChildPage, documentCount);
    const expanded = albumExpansion.isOpen(album.id);
    const selected = activeContent === 'images' && selectedAlbumId === album.id;
    const actions = albumActions(album, archivedBranch, expanded, expandable);
    const entry = { kind: 'ALBUM' as const, album, activityAt: album.activityAt, pinned: album.pinned };
    const targetKey = childEntryKey(entry);
    const targetMemberIds = parentAlbum ? memberIdsForEntry(parentAlbum, entry) : [];
    const targetRootTargets = parentAlbum ? [] : rootTargetsForEntry(entry);
    const handleAlbumClick: MouseEventHandler<HTMLButtonElement> = (event) => {
      // The first click opens immediately. Ignore the second click event so a
      // double click does not push the same navigation location twice.
      if (event.detail <= 1) onSelectAlbum(album.id);
    };
    const handleAlbumDoubleClick: MouseEventHandler<HTMLButtonElement> = () =>
      expandable && setAlbumExpanded(album.id, !expanded);
    const row = (
      <div
        data-album-id={album.id}
        data-result-library-selected={selected ? 'true' : undefined}
        role="group"
        aria-label={album.title}
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            if (archivedBranch || lifecycleBusy || !onImportExternalFiles) return;
            event.preventDefault();
            event.stopPropagation();
            setDropPlacement(null);
            setDropAlbumId(album.id);
            return;
          }
          if (!hasTreeDrag(event)) return;
          const placement = reorderEdge(event, parentAlbum, targetMemberIds, true);
          const rootPlacement = parentAlbum ? null : rootReorderEdge(event, entry, true);
          if (archivedBranch || lifecycleBusy || (!placement && !rootPlacement && !canDropIntoAlbum(event, album.id))) {
            event.stopPropagation();
            setRootDropActive(false);
            setDropAlbumId(null);
            setDropPlacement(null);
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          setRootDropActive(false);
          if (placement || rootPlacement) {
            setDropAlbumId(null);
            setDropPlacement({
              parentAlbumId: parentAlbum?.id ?? null,
              targetKey,
              edge: (placement ?? rootPlacement)!.edge,
            });
          } else {
            setDropPlacement(null);
            setDropAlbumId(album.id);
          }
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            if (archivedBranch || lifecycleBusy || !onImportExternalFiles) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'copy';
            setDropPlacement(null);
            setDropAlbumId(album.id);
            return;
          }
          if (!hasTreeDrag(event)) return;
          const placement = reorderEdge(event, parentAlbum, targetMemberIds, true);
          const rootPlacement = parentAlbum ? null : rootReorderEdge(event, entry, true);
          if (archivedBranch || lifecycleBusy || (!placement && !rootPlacement && !canDropIntoAlbum(event, album.id))) {
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'none';
            setDropPlacement(null);
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'move';
          if (placement || rootPlacement) {
            setDropAlbumId(null);
            setDropPlacement({
              parentAlbumId: parentAlbum?.id ?? null,
              targetKey,
              edge: (placement ?? rootPlacement)!.edge,
            });
          } else {
            setDropPlacement(null);
            setDropAlbumId(album.id);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDropAlbumId((current) => (current === album.id ? null : current));
            setDropPlacement((current) => (current?.targetKey === targetKey ? null : current));
          }
        }}
        onDrop={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            event.stopPropagation();
            clearTreeDragState();
            if (!archivedBranch && !lifecycleBusy && onImportExternalFiles) {
              const files = [...event.dataTransfer.files];
              if (files.length) onImportExternalFiles(album.id, files, transferSourceUrl(event.dataTransfer));
            }
            return;
          }
          if (!hasTreeDrag(event)) return;
          const placement = reorderEdge(event, parentAlbum, targetMemberIds, true);
          const rootPlacement = parentAlbum ? null : rootReorderEdge(event, entry, true);
          if (!archivedBranch && !lifecycleBusy && placement && parentAlbum) {
            event.preventDefault();
            event.stopPropagation();
            clearTreeDragState();
            void requestMemberPlacement(parentAlbum, placement.movingMemberIds, targetMemberIds, placement.edge).catch(
              () => undefined,
            );
            return;
          }
          if (!archivedBranch && !lifecycleBusy && rootPlacement) {
            event.preventDefault();
            event.stopPropagation();
            clearTreeDragState();
            void requestRootPlacement(rootPlacement.movingTargets, targetRootTargets, rootPlacement.edge).catch(
              () => undefined,
            );
            return;
          }
          if (archivedBranch || lifecycleBusy || !canDropIntoAlbum(event, album.id)) {
            event.preventDefault();
            event.stopPropagation();
            clearTreeDragState();
            return;
          }
          void dropIntoAlbum(event, album.id).catch(() => undefined);
        }}
        className={cn(
          'group relative flex h-[4.25rem] min-w-0 cursor-pointer items-center gap-1 rounded-lg px-1 transition-colors hover:bg-hover',
          selected &&
            'text-selected-foreground before:pointer-events-none before:absolute before:inset-y-0.5 before:left-3 before:right-0 before:rounded-xl before:bg-selected hover:bg-transparent',
          dropAlbumId === album.id && 'bg-accent ring-1 ring-inset ring-ring',
        )}
      >
        {dropPlacement?.targetKey === targetKey && (
          <span
            aria-hidden="true"
            data-result-reorder-indicator={dropPlacement.edge}
            className={cn(
              'pointer-events-none absolute inset-x-2 z-40 h-0.5 rounded-full bg-ring',
              dropPlacement.edge === 'before' ? '-top-px' : '-bottom-px',
            )}
          />
        )}
        <ResultLibraryRowButton
          label={`${a.open}: ${album.title}`}
          current={selected}
          onClick={handleAlbumClick}
          onDoubleClick={handleAlbumDoubleClick}
          expanded={expanded}
          onExpandedChange={expandable ? (open) => setAlbumExpanded(album.id, open) : undefined}
        />
        <AlbumTreePreview
          assets={albumPreviewAssets(album)}
          title={album.title}
          open={expanded}
          expandable={expandable}
          expandLabel={expanded ? l.collapse : l.expand}
          overlayStyle="solid"
          onAssetSelect={(asset) => selectAlbumPreviewAsset(album, asset)}
          assetLabel={(asset, index) => albumPreviewAssetLabel(album, asset, index)}
          disclosureInteractive
          branchTopology={branchTopology}
          onPullDownExpand={() => setAlbumHoverExpanded(album.id, true)}
          onPointerTrackStart={(clientY) => albumExpansion.beginPointerTrack(album.id, clientY)}
          onPointerTrack={(clientY) => albumExpansion.trackPointer(album.id, clientY)}
          onClick={handleAlbumClick}
          onDoubleClick={handleAlbumDoubleClick}
        />
        <span className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center rounded-md px-1 text-left">
          <span
            className="line-clamp-2 min-w-0 flex-1 whitespace-normal break-words text-base font-medium leading-5"
            title={album.title}
          >
            {album.title}
          </span>
        </span>
        {album.pinned && (
          <PinIcon
            className="pointer-events-none relative z-10 size-3.5 shrink-0 text-muted-foreground"
            aria-label={a.pin}
          />
        )}
        <div data-result-library-row-control className={rowControlsClassName}>
          {!lifecycleBusy && !navigationFiltered && !archivedBranch && (
            <TreeDragHandle
              label={locale === 'zh' ? '拖动图集' : 'Drag album'}
              className={rowControlClassName}
              onDragStart={(event) => startAlbumDrag(event, album.id)}
              onDragEnd={clearTreeDragState}
            />
          )}
          <ActionMenuButton
            actions={actions}
            label={`${a.moreActions}: ${album.title}`}
            className={cn(rowControlClassName, 'size-6')}
          />
        </div>
      </div>
    );

    return (
      <Collapsible
        key={album.id}
        open={expanded}
        onOpenChange={(open) => setAlbumExpanded(album.id, open)}
        className="relative"
        data-album-branch-id={album.id}
      >
        {branchTopology && <TreeBranchTransitRail topology={branchTopology} />}
        <ContextMenu>
          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
          <ContextMenuContent>
            <ActionContextMenuItems actions={actions} />
          </ContextMenuContent>
        </ContextMenu>
        {expandable && expanded && (
          <TreeBranchCollapseRail label={l.collapse} onCollapse={() => albumExpansion.collapse(album.id)} />
        )}
        {children.length > 0 && expanded && (
          <TreeBranchContent>
            <TreeBranchCollapseProvider onCollapse={() => albumExpansion.collapse(album.id)}>
              {children.map((entry, index) => {
                const topology = getTreeBranchItemTopology(index, children.length);
                if (entry.kind === 'ALBUM') return renderAlbumBranch(entry.album, archivedBranch, topology, album);
                if (entry.kind === 'SERIES') return renderSessionRow(entry.session, archivedBranch, topology, album);
                return renderDocumentRow(entry.entry, topology);
              })}
            </TreeBranchCollapseProvider>
          </TreeBranchContent>
        )}
        {renderAlbumDocumentPaging(album.id, expanded, includeAlbumDocuments, children.length)}
      </Collapsible>
    );
  }

  function renderCompactDocument(entry: Extract<VideoDocumentNavigationEntry, { kind: 'DOCUMENT' }>) {
    return (
      <CreationDocumentCompactItem
        key={`compact:${entry.documentId}`}
        entry={entry}
        selected={activeContent === 'documents' && selectedDocumentId === entry.documentId}
        onSelectDocument={onSelectDocument}
        onRenameDocument={onRenameDocument}
        onMoveDocument={(document) =>
          setMoveTarget({
            kind: 'DOCUMENT',
            id: document.id,
            title: document.title,
            currentAlbumId: document.albumId,
          })
        }
      />
    );
  }

  function renderCompactEntry(entry: MixedEntry) {
    if (entry.kind === 'ALBUM') {
      const album = entry.album;
      const selected = activeContent === 'images' && surface === 'album-detail' && selectedAlbumId === album.id;
      const archived = Boolean(entry.archived || tree.effectivelyArchived.has(album.id));
      const previewAssets = albumPreviewAssets(album);
      const actions = albumActions(album, archived, false, false);
      const activePreviewAsset =
        compactPreview?.entryKey === `album:${album.id}` ? compactPreview.asset : previewAssets[0];
      const trigger = (
        <div
          title={album.title}
          data-result-library-selected={selected ? 'true' : undefined}
          className={cn(compactItemClassName, selected && compactSelectedClassName, archived && 'opacity-60')}
        >
          <button
            type="button"
            className="absolute inset-0 z-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`${a.open}: ${album.title}`}
            aria-current={selected ? 'page' : undefined}
            onClick={() => onSelectAlbum(album.id)}
          />
          <CompactCreationAlbumPreview
            album={album}
            assets={previewAssets}
            assetLabel={(asset, index) => albumPreviewAssetLabel(album, asset, index)}
            onAlbumSelect={() => onSelectAlbum(album.id)}
            onAssetSelect={(asset) => selectAlbumPreviewAsset(album, asset)}
            onAssetPreviewChange={(asset) => updateCompactPreview(`album:${album.id}`, asset)}
          />
        </div>
      );
      const content = (
        <div
          data-album-id={album.id}
          role="group"
          aria-label={album.title}
          draggable={!lifecycleBusy && !navigationFiltered && !archived}
          onDragStart={(event) => startAlbumDrag(event, album.id)}
          onDragEnd={clearTreeDragState}
          onDragEnter={(event) => {
            if (event.dataTransfer.types.includes('Files')) {
              if (archived || lifecycleBusy || !onImportExternalFiles) return;
              event.preventDefault();
              event.stopPropagation();
              setDropAlbumId(album.id);
              return;
            }
            if (!hasTreeDrag(event)) return;
            if (archived || lifecycleBusy || !canDropIntoAlbum(event, album.id)) {
              event.stopPropagation();
              setDropAlbumId(null);
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            setDropAlbumId(album.id);
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('Files')) {
              if (archived || lifecycleBusy || !onImportExternalFiles) return;
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = 'copy';
              setDropAlbumId(album.id);
              return;
            }
            if (!hasTreeDrag(event)) return;
            if (archived || lifecycleBusy || !canDropIntoAlbum(event, album.id)) {
              event.stopPropagation();
              event.dataTransfer.dropEffect = 'none';
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setDropAlbumId((current) => (current === album.id ? null : current));
          }}
          onDrop={(event) => {
            if (event.dataTransfer.types.includes('Files')) {
              event.preventDefault();
              event.stopPropagation();
              clearTreeDragState();
              if (!archived && !lifecycleBusy && onImportExternalFiles) {
                const files = [...event.dataTransfer.files];
                if (files.length) onImportExternalFiles(album.id, files, transferSourceUrl(event.dataTransfer));
              }
              return;
            }
            if (!hasTreeDrag(event)) return;
            if (archived || lifecycleBusy || !canDropIntoAlbum(event, album.id)) {
              event.preventDefault();
              event.stopPropagation();
              clearTreeDragState();
              return;
            }
            void dropIntoAlbum(event, album.id).catch(() => undefined);
          }}
          className={cn(
            'group relative flex h-16 w-full items-center justify-center rounded-xl',
            dropAlbumId === album.id && 'bg-accent ring-1 ring-inset ring-ring',
          )}
        >
          {previewAssets[0] ? (
            <AssetHoverPreview asset={activePreviewAsset} side="right">
              {trigger}
            </AssetHoverPreview>
          ) : (
            trigger
          )}
        </div>
      );
      return previewAssets[0] ? (
        <AssetFileContextMenu
          key={`compact:${album.id}`}
          assetId={previewAssets[0].id}
          notify={notify}
          actions={actions}
          revealContext={{ kind: 'ALBUM', albumId: album.id }}
        >
          {content}
        </AssetFileContextMenu>
      ) : (
        <ContextMenu key={`compact:${album.id}`}>
          <ContextMenuTrigger asChild>{content}</ContextMenuTrigger>
          <ContextMenuContent>
            <ActionContextMenuItems actions={actions} />
          </ContextMenuContent>
        </ContextMenu>
      );
    }
    if (entry.kind === 'DOCUMENT') return renderCompactDocument(entry.entry);
    const assets = sessionAssets(entry.session);
    const first = assets[0] ?? null;
    const ideaCreation = ideaCreationBySessionId.get(entry.session.id) ?? null;
    const ideaSelected = Boolean(
      activeContent === 'images' &&
      ideaCreation &&
      surface === 'idea-creation' &&
      selectedCreationId === ideaCreation.id,
    );
    const selected = (sessionSelected(entry.session) && !selectedAlbumId) || ideaSelected;
    const title = sessionTitle(entry.session);
    const memberSeriesIds = entry.session.memberSeries.map((series) => series.id);
    const archived = Boolean(entry.archived);
    const actions = seriesActions(
      entry.session,
      title,
      assets.map((item) => item.asset.id),
      memberSeriesIds,
      archived,
    );
    const selectAsset = (asset: (typeof assets)[number]['asset']) => {
      const owner = assets.find((record) => record.asset.id === asset.id)?.seriesId ?? entry.session.primarySeries.id;
      onSelect(owner, asset.id);
    };
    const previewKey = `session:${entry.session.id}`;
    const activePreviewAsset = compactPreview?.entryKey === previewKey ? compactPreview.asset : first?.asset;
    const trigger =
      assets.length > 0 ? (
        <div
          role="group"
          title={title}
          aria-label={title}
          data-result-library-selected={selected ? 'true' : undefined}
          className={cn(compactItemClassName, selected && compactSelectedClassName, archived && 'opacity-60')}
        >
          <button
            type="button"
            className="absolute inset-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`${a.open}: ${title}`}
            aria-current={selected ? 'page' : undefined}
            onClick={() => onSelect(first?.seriesId ?? entry.session.primarySeries.id, first?.asset.id)}
          />
          <MediaStackPreview
            className="relative z-10"
            size="rail"
            singleItemAlign="center"
            items={assets.map(({ asset, seriesId }) => ({
              asset,
              revealContext: { kind: 'CREATION' as const, seriesId },
            }))}
            onAssetSelect={selectAsset}
            onAssetPreviewChange={(asset) => updateCompactPreview(previewKey, asset)}
            assetLabel={(_asset, index) => `${title}: ${locale === 'zh' ? `图片 ${index + 1}` : `Image ${index + 1}`}`}
            notify={notify}
            contextActions={actions}
          />
        </div>
      ) : (
        <button
          type="button"
          title={title}
          aria-label={title}
          aria-current={selected ? 'page' : undefined}
          data-result-library-selected={selected ? 'true' : undefined}
          className={cn(compactItemClassName, selected && compactSelectedClassName, archived && 'opacity-60')}
          onClick={() => onSelect(entry.session.primarySeries.id)}
        >
          <MediaStackPreview size="rail" items={[]} />
        </button>
      );
    const content = (
      <div
        data-series-id={entry.session.primarySeries.id}
        data-result-library-selected={selected ? 'true' : undefined}
        role="group"
        aria-label={title}
        draggable={!lifecycleBusy && !navigationFiltered && !archived}
        onDragStart={(event) => startCreationDrag(event, memberSeriesIds)}
        onDragEnd={clearTreeDragState}
        className="group relative flex h-16 w-full items-center justify-center"
      >
        {first ? (
          <AssetHoverPreview asset={activePreviewAsset} side="right">
            {trigger}
          </AssetHoverPreview>
        ) : (
          trigger
        )}
        {ideaCreation && (
          <button
            type="button"
            title={locale === 'zh' ? `打开灵感：${ideaCreation.title}` : `Open ideas: ${ideaCreation.title}`}
            aria-label={locale === 'zh' ? '打开灵感' : 'Open ideas'}
            aria-current={ideaSelected ? 'page' : undefined}
            className={cn(
              'absolute right-1 top-1 z-30 grid size-5 place-items-center rounded-full border bg-background text-foreground-secondary outline-none transition-colors hover:bg-hover-strong focus-visible:ring-2 focus-visible:ring-ring',
              ideaSelected && 'border-selected-foreground/30 text-selected-foreground',
            )}
            onClick={() => onSelectCreation(ideaCreation.id)}
          >
            <LightbulbIcon className="size-3" />
          </button>
        )}
      </div>
    );
    return (
      <ContextMenu key={`compact:${entry.session.id}`}>
        <ContextMenuTrigger asChild>{content}</ContextMenuTrigger>
        <ContextMenuContent>
          <ActionContextMenuItems actions={actions} />
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  const moveDialog = (
    <ResultLibraryMoveDialog
      albums={data.albums}
      target={moveTarget}
      busy={lifecycleBusy}
      onOpenChange={(open) => {
        if (!open) setMoveTarget(null);
      }}
      onMoveAlbum={requestAlbumMove}
      onMoveSeries={requestSeriesMove}
      onMoveDocument={onMoveDocument}
    />
  );
  const coverPickerDialog = (
    <CreationCoverPickerDialog
      open={Boolean(coverPickerSession)}
      seriesTitle={coverPickerView.title}
      assets={coverPickerView.assets}
      explicitCoverAssetIds={coverPickerView.explicitCoverAssetIds}
      busy={coverBusy}
      onOpenChange={(open) => {
        if (!open) setCoverPickerSessionId(null);
      }}
      onApply={(imageAssetIds) => void updateCreationCovers(imageAssetIds)}
    />
  );

  if (mode === 'images')
    return (
      <aside aria-label={l.library} className="relative flex size-full min-h-0 flex-col border-r bg-surface-sunken">
        {showModeToggle && (
          <CreatorPaneResizeHandle
            edge="right"
            label={l.resize}
            value={resizeValue}
            min={resizeMin}
            max={resizeMax}
            disabled={!canExpand}
            onValueChange={onResizeValueChange}
            onPointerDown={onResizeStart}
          />
        )}
        <header className="grid h-14 shrink-0 place-items-center border-b border-border/60">
          {surface === 'new-creation' ? (
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={lifecycleBusy}
              title={a.newAlbum}
              aria-label={a.newAlbum}
              onClick={() => onCreateAlbum(null)}
            >
              <GalleryVerticalEndIcon className="size-4" />
            </Button>
          ) : (
            <Button
              data-action="new-creation"
              variant="ghost"
              size="icon-sm"
              disabled={lifecycleBusy || selectedAlbumArchived}
              title={l.newCreation}
              aria-label={l.newCreation}
              onClick={() => (surface === 'album-detail' && selectedAlbumId ? onNewInAlbum(selectedAlbumId) : onNew())}
            >
              <PlusIcon className="size-4" />
            </Button>
          )}
        </header>
        <ScrollArea type="always" className="min-h-0 flex-1" viewportRef={compactViewportRef}>
          <div
            className="flex flex-col items-stretch gap-2 pt-3 pr-3 pb-14 pl-2"
            data-rendered-root-count={renderedRootEntries.length}
            data-total-root-count={displayedRootEntries.length}
          >
            {compactEntries.map(renderCompactEntry)}
            {renderedRootEntries.length < displayedRootEntries.length && (
              <div ref={rootPageEndRef} data-slot="result-library-page-end" className="h-px" aria-hidden="true" />
            )}
          </div>
        </ScrollArea>
        {showModeToggle && (
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="absolute bottom-2 left-1/2 z-20 -translate-x-1/2 shadow-overlay"
            title={l.full}
            aria-label={l.full}
            disabled={!canExpand}
            onClick={() => onModeChange('full')}
          >
            <PanelLeftOpenIcon className="size-4" />
          </Button>
        )}
        {moveDialog}
        {coverPickerDialog}
      </aside>
    );

  return (
    <aside aria-label={l.library} className="relative flex min-h-0 min-w-0 flex-col border-r bg-surface-sunken">
      {showModeToggle && (
        <CreatorPaneResizeHandle
          edge="right"
          label={l.resize}
          value={resizeValue}
          min={resizeMin}
          max={resizeMax}
          onValueChange={onResizeValueChange}
          onPointerDown={onResizeStart}
        />
      )}
      <header
        className={cn(
          'flex h-14 shrink-0 items-center justify-between gap-1 border-b border-border/60 px-3',
          rootDropActive && 'bg-accent',
        )}
        onDragEnter={(event) => {
          if (!lifecycleBusy && hasTreeDrag(event) && canDropAtRoot(event)) {
            event.preventDefault();
            setRootDropActive(true);
          } else if (hasTreeDrag(event)) {
            setRootDropActive(false);
          }
        }}
        onDragOver={(event) => {
          if (!lifecycleBusy && hasTreeDrag(event) && canDropAtRoot(event)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          } else if (hasTreeDrag(event)) {
            event.dataTransfer.dropEffect = 'none';
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setRootDropActive(false);
        }}
        onDrop={(event) => {
          if (!lifecycleBusy && canDropAtRoot(event)) void dropAtRoot(event).catch(() => undefined);
          else if (hasTreeDrag(event)) clearTreeDragState();
        }}
      >
        <h1 className="truncate text-lg font-semibold tracking-tight">{l.library}</h1>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={lifecycleBusy}
            title={a.newAlbum}
            aria-label={a.newAlbum}
            onClick={() => onCreateAlbum(null)}
          >
            <GalleryVerticalEndIcon className="size-4" />
          </Button>
          <Button
            type="button"
            data-action="new-creation"
            variant={surface === 'new-creation' ? 'secondary' : 'outline'}
            size="icon-sm"
            disabled={lifecycleBusy || selectedAlbumArchived}
            title={l.newCreation}
            aria-label={l.newCreation}
            onClick={() => (surface === 'album-detail' && selectedAlbumId ? onNewInAlbum(selectedAlbumId) : onNew())}
          >
            <PlusIcon className="size-4" />
          </Button>
        </div>
      </header>
      <CreationLibraryToolbar query={query} filter={filter} onQueryChange={setQuery} onFilterChange={onFilterChange} />
      <ScrollArea
        type="always"
        className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:min-h-full"
        viewportRef={albumViewportRef}
      >
        <div
          data-result-library-root-drop-zone
          data-rendered-root-count={renderedRootEntries.length}
          data-total-root-count={displayedRootEntries.length}
          className={cn('min-h-full space-y-0.5 px-2 py-2 pb-14 transition-colors', rootDropActive && 'bg-accent/40')}
          onDragEnter={(event) => {
            if (!lifecycleBusy && hasTreeDrag(event) && canDropAtRoot(event)) {
              event.preventDefault();
              setRootDropActive(true);
            } else if (hasTreeDrag(event)) {
              setRootDropActive(false);
            }
          }}
          onDragOver={(event) => {
            if (!lifecycleBusy && hasTreeDrag(event) && canDropAtRoot(event)) {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            } else if (hasTreeDrag(event)) {
              event.dataTransfer.dropEffect = 'none';
            }
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setRootDropActive(false);
          }}
          onDrop={(event) => {
            if (!lifecycleBusy && canDropAtRoot(event)) void dropAtRoot(event).catch(() => undefined);
            else if (hasTreeDrag(event)) clearTreeDragState();
          }}
        >
          {renderedRootEntries.map((entry) => {
            if (entry.kind === 'ALBUM') return renderAlbumBranch(entry.album, false);
            if (entry.kind === 'SERIES') return renderSessionRow(entry.session);
            return renderDocumentRow(entry.entry);
          })}
          <CreationDocumentRootPaging
            includeDocuments={includeDocuments}
            queryActive={Boolean(normalizedQuery)}
            searchLoading={documentSearch.loading}
            searchHasMore={documentSearch.hasMore}
            searchLoadingMore={documentSearch.loadingMore}
            rootLoading={documentNavigation.root.loading}
            rootHasMore={Boolean(documentNavigation.root.nextCursor)}
            rootLoadingMore={documentNavigation.root.loadingMore}
            onLoadSearchMore={() => void documentSearch.loadMore()}
            onLoadRootMore={documentNavigation.loadRootMore}
          />
          {renderedRootEntries.length < displayedRootEntries.length && (
            <div ref={rootPageEndRef} data-slot="result-library-page-end" className="h-px" aria-hidden="true" />
          )}
          <CreationLibraryEmptyState
            empty={displayedRootEntries.length === 0}
            filtered={navigationFiltered}
            includeDocuments={includeDocuments}
            queryActive={Boolean(normalizedQuery)}
            searchLoading={documentSearch.loading}
            rootLoading={documentNavigation.root.loading}
            title={l.empty}
            filteredTitle={l.emptyFiltered}
            actionLabel={surface === 'new-creation' ? a.newAlbum : l.newCreation}
            actionDisabled={lifecycleBusy || (surface !== 'new-creation' && selectedAlbumArchived)}
            onAction={() => {
              if (surface === 'new-creation') onCreateAlbum(null);
              else if (surface === 'album-detail' && selectedAlbumId) onNewInAlbum(selectedAlbumId);
              else onNew();
            }}
          />
          {!normalizedQuery && tree.archivedRoots.length > 0 && (
            <Collapsible open={archivedOpen} onOpenChange={setArchivedOpen} className="pt-2">
              <CollapsibleTrigger asChild>
                <TreeDisclosureRail
                  open={archivedOpen}
                  label={archivedOpen ? l.collapse : l.expand}
                  className="h-8 w-full justify-start px-2 text-xs font-normal text-muted-foreground"
                >
                  <ArchiveIcon className="size-3.5" />
                  <span>{a.archivedAlbums}</span>
                </TreeDisclosureRail>
              </CollapsibleTrigger>
              <TreeBranchContent className="space-y-0.5 pt-1">
                {tree.archivedRoots.map((album) => renderAlbumBranch(album, true))}
              </TreeBranchContent>
            </Collapsible>
          )}
        </div>
      </ScrollArea>
      {rootDropEligible && (
        <div
          data-result-library-move-to-root
          role="status"
          className={cn(
            'absolute inset-x-3 bottom-12 z-40 flex h-11 items-center justify-center gap-2 rounded-lg border border-dashed bg-popover text-xs font-medium shadow-overlay',
            rootDropActive && 'border-ring bg-accent text-accent-foreground',
          )}
          onDragEnter={(event) => {
            if (!lifecycleBusy && hasTreeDrag(event) && canDropAtRoot(event)) {
              event.preventDefault();
              event.stopPropagation();
              setRootDropActive(true);
            }
          }}
          onDragOver={(event) => {
            if (!lifecycleBusy && hasTreeDrag(event) && canDropAtRoot(event)) {
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = 'move';
            }
          }}
          onDrop={(event) => {
            if (!lifecycleBusy && canDropAtRoot(event)) void dropAtRoot(event).catch(() => undefined);
            else if (hasTreeDrag(event)) clearTreeDragState();
          }}
        >
          <ArrowUpToLineIcon className="size-4" />
          {a.moveToRoot}
        </div>
      )}
      {showModeToggle && (
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          className="absolute bottom-2 left-2 z-20 shadow-overlay"
          title={l.imagesOnly}
          aria-label={l.imagesOnly}
          onClick={() => onModeChange('images')}
        >
          <PanelLeftCloseIcon className="size-4" />
        </Button>
      )}
      {moveDialog}
      {coverPickerDialog}
    </aside>
  );
}
