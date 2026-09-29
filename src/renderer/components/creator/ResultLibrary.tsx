import { CreationLibraryPaneToggle } from '@/renderer/components/creator/CreationLibraryPaneToggle';
import {
  allCreationLibraryFilters,
  formMatchesFilter,
  isAllCreationLibraryFilter,
} from '@/renderer/components/creator/creationLibraryFilter';
import { creationLibraryAuthorOptions } from '@/renderer/components/creator/creationLibraryAuthorFilter';
import {
  ArchiveIcon,
  BookmarkIcon,
  FileTextIcon,
  FolderInputIcon,
  GalleryVerticalEndIcon,
  ImageIcon,
  ImagesIcon,
  Layers3Icon,
  ListChecksIcon,
  ListTreeIcon,
  NotebookTextIcon,
  PanelsTopLeftIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  ScanSearchIcon,
  Trash2Icon,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEventHandler,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type {
  AlbumDto,
  ArticleDto,
  AssetDto,
  BootstrapDto,
  CreationDto,
  Locale,
  PromptSeriesDto,
  VideoDocumentSummaryDto,
} from '@/shared/contracts';
import { cn } from '@/renderer/lib/utils';
import { useI18n } from '@/renderer/i18n/useI18n';
import { usePinContentAction } from '@/renderer/features/desktop-petals/PinContentAction';
import {
  readCreationTreeDrag,
  endCreationTreeDrag,
  writeAlbumDrag,
  writeCreationItemDrag,
} from '@/renderer/components/albums/albumDrag';
import { AlbumMoveDialog, type AlbumMoveTarget } from '@/renderer/components/albums/AlbumMoveDialog';
import { AlbumTreePreview } from '@/renderer/components/albums/AlbumTreePreview';
import { buildAlbumTreeIndex } from '@/renderer/components/albums/albumTree';
import {
  itemDragStart,
  itemDragScopeProps,
  acceptsItemTransfer,
  itemDragIntent,
} from '@/renderer/components/albums/itemDrag';
import {
  TreeBranchCollapseProvider,
  TreeBranchCollapseRail,
  TreeBranchContent,
  TreeBranchTransitRail,
  TreeDisclosureRail,
} from '@/renderer/components/albums/TreeDisclosureRail';
import {
  COMPACT_TREE_NODE_METRICS,
  getTreeBranchItemTopology,
  getTreeNodeAnchor,
  TREE_CONNECTION_GEOMETRY,
  type TreeBranchItemTopology,
} from '@/renderer/components/albums/treeConnectionGeometry';
import { useTreeBranchExpansion } from '@/renderer/components/albums/useTreeBranchExpansion';
import { createTreeBranchExpansionAction } from '@/renderer/components/albums/treeBranchMenuActions';
import type { ContentLifecycleActionRequest } from '@/renderer/components/albums/useContentLifecycleActions';
import { ActionContextMenuItems, ActionMenuButton, type ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/renderer/components/ui/context-menu';
import { QuietEmpty } from '@/renderer/components/ui/quiet-empty';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { CreatorPaneResizeHandle } from '@/renderer/components/creator/CreatorPaneResizeHandle';
import { CreationLibraryChildList } from '@/renderer/components/creator/CreationLibraryChildDisclosure';
import { CreationLibraryHeader } from '@/renderer/components/creator/CreationLibraryHeader';
import type { CreationLibraryFilter } from '@/renderer/components/creator/creationLibraryFilter';
import { creationAlbumPreviewAssets } from '@/renderer/components/creator/creationAlbumPreviewAssets';
import { creationFormTabTarget } from '@/renderer/components/creator/creationFormTabTarget';
import { CreationAnimationGroup } from '@/renderer/components/creator/CreationAnimationGroup';
import { groupCreationAnimationForms } from '@/renderer/components/creator/creationAnimationGroups';
import {
  buildCreationLibraryProjection,
  creationFormPreviewAssetIds,
  creationFormTitle,
  creationFormKindLabel,
  type CreationFormProjection,
  type CreationItemProjection,
} from '@/renderer/components/creator/creationLibraryProjection';
import { buildCreationSessionProjection } from '@/renderer/components/creator/creationSessionProjection';
import { compareCreationLibraryOrder } from '@/renderer/components/creator/creationLibraryOrder';
import {
  useCreationAlbumChildVisibility,
  type CreationAlbumChildVisibilityEntry,
} from '@/renderer/components/creator/useCreationAlbumChildVisibility';
import {
  CreationLibraryTreeItem,
  getCreationTreeMediaNodeMetrics,
} from '@/renderer/components/creator/CreationLibraryTreeItem';
import { allAssets } from '@/renderer/components/creator/utils';
import { MediaStackPreview, type MediaStackSpread } from '@/renderer/components/media/MediaStackPreview';
import { AssetThumbnail } from '@/renderer/components/media/AssetThumbnail';
import { useVideoDocumentList } from '@/renderer/features/video-documents/useVideoDocumentList';
import { useVideoDocumentNavigation } from '@/renderer/features/video-documents/useVideoDocumentNavigation';
import type { CreatorOpenTabTarget } from '@/renderer/components/app/app-navigation';
import { outlineCurrentNodeKey } from '@/renderer/features/creation-outline/outline-tree';
import {
  creationTreeNavigationKey,
  useCreationTreeScroll,
  useCreationTreeScrollMemory,
} from '@/renderer/components/creator/useCreationTreeScroll';
import { CreationLibraryAssetPreview } from '@/renderer/components/creator/CreationLibraryAssetPreview';
import { creationSessionCoverFirstAssets } from '@/renderer/components/creator/creationCoverFirstAssets';
import type { DerivedVisualWorkspaceViewState } from '@/renderer/components/creator/derivedVisualWorkspace';
import { useCreationDraftSidebar } from '@/renderer/components/creator/useCreationDraftSidebar';
import { useCreationAlbumDraft } from '@/renderer/components/creator/useCreationAlbumDraft';
import type { CreationAlbumRequest } from '@/renderer/components/creator/CreationLibraryAlbumDraft';
import './CreationLibraryTree.css';

export type ResultLibraryMode = 'full' | 'images';
export type ResultLibrarySurface =
  | 'animation'
  | 'new-creation'
  | 'inspiration-stash'
  | 'image-breakdown'
  | 'evaluation-suite'
  | 'social-post'
  | 'article'
  | 'idea-creation'
  | 'existing-creation'
  | 'album-detail';

interface Props {
  active: boolean;
  data: BootstrapDto;
  locale: Locale;
  activeContent: 'images' | 'documents';
  filter: CreationLibraryFilter;
  selectedSeriesId: string | null;
  selectedDraftId: string | null;
  onSelectDraft(id: string): void;
  onBeforeDeleteDraft(draftId: string | null): Promise<void>;
  onDraftsDeleted(draftIds: string[]): void;
  selectedDerivedVisualId?: string | null;
  selectedAnimationId?: string | null;
  selectedCreationId: string | null;
  selectedInspirationStashId: string | null;
  selectedImageBreakdownId: string | null;
  selectedEvaluationSuiteId: string | null;
  selectedSocialPostId: string | null;
  selectedArticleId: string | null;
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
  onSelectInspirationStash(stashId: string): void;
  onSelectImageBreakdown(breakdownId: string): void;
  onSelectEvaluationSuite(suiteId: string): void;
  onSelectSocialPost(postId: string): void;
  onSelectArticle(articleId: string): void;
  onSelectAnimation(documentId: string): void;
  onRenameArticle(article: ArticleDto): void;
  onContentLifecycleAction(request: ContentLifecycleActionRequest): void;
  onSelect(seriesId: string, assetId?: string): void;
  onOpenDerivedVisual(visualId: string, view?: DerivedVisualWorkspaceViewState): void;
  onSelectDocument(documentId: string, albumId: string | null): void;
  onOpenInNewTab(target: CreatorOpenTabTarget): void;
  onRenameDocument(document: VideoDocumentSummaryDto): void;
  onSelectAlbum(albumId: string): void;
  onMore(seriesId: string): void;
  onNew(): void;
  onNewInAlbum(albumId: string): void;
  onRenameSeries(series: PromptSeriesDto): void;
  onRenameAlbum(album: AlbumDto): void;
  onToggleAlbumPin(album: AlbumDto): void;
  onCreateAlbum(parent: AlbumDto | null): void;
  createAlbumRequest: CreationAlbumRequest | null;
  onConfirmCreateAlbum(request: CreationAlbumRequest, title: string): Promise<boolean>;
  onCancelCreateAlbum(): void;
  onMoveAlbum(albumId: string, parentAlbumId: string | null, copy?: boolean): Promise<void>;
  onMoveCreationItem(creationItemId: string, albumId: string | null, copy?: boolean): Promise<void>;
  onToggleCreationItemPin(creationItemId: string, pinned: boolean): void;
  onImportExternalFiles?(albumId: string, files: File[], sourceUrl: string): void;
  notify(message: string): void;
}

type RootEntry = { kind: 'ALBUM'; album: AlbumDto } | { kind: 'ITEM'; item: CreationItemProjection };
type AlbumChildEntry = RootEntry;

const rowControlsClassName =
  'pointer-events-none absolute inset-y-0 right-1 z-30 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100';
const rowControlClassName =
  'shrink-0 rounded-sm text-muted-foreground hover:bg-hover-strong hover:text-foreground data-[state=open]:bg-hover-strong data-[state=open]:text-foreground';

function creationSidebarEntryKey(entry: RootEntry) {
  return entry.kind === 'ALBUM' ? `ALBUM:${entry.album.id}` : `CREATION_ITEM:${entry.item.key}`;
}

function creationSidebarEntryVisibility(entry: RootEntry): CreationAlbumChildVisibilityEntry {
  return entry.kind === 'ALBUM'
    ? {
        key: creationSidebarEntryKey(entry),
        pinned: entry.album.pinned,
        activityAt: entry.album.activityAt,
        createdAt: entry.album.createdAt,
      }
    : {
        key: creationSidebarEntryKey(entry),
        pinned: entry.item.item.pinned,
        activityAt: entry.item.activityAt,
        createdAt: entry.item.item.createdAt,
      };
}

function compareCreationSidebarEntries(left: RootEntry, right: RootEntry) {
  return compareCreationLibraryOrder(creationSidebarEntryVisibility(left), creationSidebarEntryVisibility(right));
}

function normalized(value: string, locale: Locale) {
  return value.trim().toLocaleLowerCase(locale === 'zh' ? 'zh-CN' : 'en');
}

function formIcon(form: CreationFormProjection) {
  switch (form.role) {
    case 'ANIMATION':
      return ImagesIcon;
    case 'INSPIRATION':
      return BookmarkIcon;
    case 'IMAGE_BREAKDOWN':
      return ScanSearchIcon;
    case 'EVALUATION_SUITE':
      return ListChecksIcon;
    case 'SOCIAL_POST':
      return PanelsTopLeftIcon;
    case 'ARTICLE':
      return form.entity?.content.editorMode === 'OUTLINE' ? ListTreeIcon : FileTextIcon;
    case 'VIDEO_DOCUMENT':
      return NotebookTextIcon;
    case 'IMAGE_CREATION':
      return ImagesIcon;
    case 'SOCIAL_POST_COVER':
    case 'ARTICLE_HEADER':
    case 'ARTICLE_INLINE':
      return ImageIcon;
  }
}

function uniqueDocuments(items: readonly VideoDocumentSummaryDto[]) {
  const byId = new Map<string, VideoDocumentSummaryDto>();
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()];
}

function CreationLibraryEmptyState({
  rootCount,
  hasDraftContent,
  query,
  filter,
  surface,
  busy,
  onCreateAlbum,
  onNew,
}: {
  rootCount: number;
  hasDraftContent: boolean;
  query: string;
  filter: CreationLibraryFilter;
  surface: ResultLibrarySurface;
  busy: boolean;
  onCreateAlbum(parent: AlbumDto | null): void;
  onNew(): void;
}) {
  const { creator } = useI18n().messages;
  if (rootCount || hasDraftContent) return null;
  return (
    <QuietEmpty
      title={query || !isAllCreationLibraryFilter(filter) ? creator.results.emptyFiltered : creator.results.empty}
      actionLabel={surface === 'new-creation' ? creator.album.newAlbum : creator.results.newCreation}
      actionDisabled={busy}
      onAction={() => {
        if (surface === 'new-creation') onCreateAlbum(null);
        else onNew();
      }}
    />
  );
}

function ResultLibraryResizeHandle({
  showModeToggle,
  canExpand,
  resizeValue,
  resizeMin,
  resizeMax,
  onResizeValueChange,
  onResizeStart,
}: Pick<
  Props,
  'showModeToggle' | 'canExpand' | 'resizeValue' | 'resizeMin' | 'resizeMax' | 'onResizeValueChange' | 'onResizeStart'
>) {
  const { messages } = useI18n();
  if (!showModeToggle) return null;
  return (
    <CreatorPaneResizeHandle
      edge="right"
      label={messages.creator.results.resize}
      value={resizeValue}
      min={resizeMin}
      max={resizeMax}
      disabled={!canExpand}
      onValueChange={onResizeValueChange}
      onPointerDown={onResizeStart}
    />
  );
}

export function ResultLibrary({
  active,
  data,
  locale,
  filter,
  selectedSeriesId,
  selectedDraftId,
  onSelectDraft,
  onBeforeDeleteDraft,
  onDraftsDeleted,
  selectedDerivedVisualId = null,
  selectedAnimationId,
  selectedCreationId,
  selectedInspirationStashId,
  selectedImageBreakdownId,
  selectedEvaluationSuiteId,
  selectedSocialPostId,
  selectedArticleId,
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
  onSelectInspirationStash,
  onSelectImageBreakdown,
  onSelectEvaluationSuite,
  onSelectSocialPost,
  onSelectArticle,
  onSelectAnimation,
  onRenameArticle,
  onContentLifecycleAction,
  onSelect,
  onOpenDerivedVisual,
  onSelectDocument,
  onOpenInNewTab,
  onRenameDocument,
  onSelectAlbum,
  onMore,
  onNew,
  onNewInAlbum,
  onRenameSeries,
  onRenameAlbum,
  onToggleAlbumPin,
  onCreateAlbum,
  createAlbumRequest,
  onConfirmCreateAlbum,
  onCancelCreateAlbum,
  onMoveAlbum,
  onMoveCreationItem,
  onToggleCreationItemPin,
  onImportExternalFiles,
  notify,
}: Props) {
  const { messages } = useI18n();
  const pinContentAction = usePinContentAction(notify);
  const formKindLabel = (form: CreationFormProjection) => creationFormKindLabel(form, messages.creator.album);
  const itemLifecycleTitle = (item: CreationItemProjection) =>
    item.title || messages.creator.album.formKinds.IMAGE_CREATION;
  const libraryLabels = messages.creator.results;
  const creatorAlbumLabels = messages.creator.album;
  const albumLabels = messages.gallery.albums;
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<AssetDto | null>(null);
  const [moveTarget, setMoveTarget] = useState<AlbumMoveTarget | null>(null);
  const [draggedCreationItemId, setDraggedCreationItemId] = useState<string | null>(null);
  const [draggedAlbumId, setDraggedAlbumId] = useState<string | null>(null);
  const [dropAlbumId, setDropAlbumId] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const draftSidebar = useCreationDraftSidebar({
    active,
    data,
    mode,
    selectedId: selectedDraftId,
    busy: lifecycleBusy,
    onSelect: onSelectDraft,
    onBeforeDelete: onBeforeDeleteDraft,
    onDeleted: onDraftsDeleted,
    notify,
  });
  const libraryScroll = useCreationTreeScrollMemory();
  const albumExpansion = useTreeBranchExpansion(viewportRef);
  const itemExpansion = useTreeBranchExpansion(viewportRef);
  const albumChildVisibility = useCreationAlbumChildVisibility();
  const lastAutoRevealedAlbumSelectionRef = useRef<string | null>(null);
  const setAlbumPersistent = albumExpansion.setPersistent;
  const setItemPersistent = itemExpansion.setPersistent;
  const queryKey = normalized(query, locale);
  const includeDocuments = filter.documents;
  const documentNavigation = useVideoDocumentNavigation({
    active: active && mode === 'full' && includeDocuments,
    refreshKey: documentNavigationRevision,
    notify,
  });
  const documentSearch = useVideoDocumentList({
    active: active && mode === 'full' && includeDocuments && Boolean(queryKey),
    refreshKey: documentNavigationRevision,
    query,
    albumId: null,
    unfiledOnly: false,
    notify,
  });
  const navigationDocuments = useMemo(
    () =>
      uniqueDocuments([
        ...documentNavigation.root.items.flatMap((entry) => (entry.kind === 'DOCUMENT' ? [entry.document] : [])),
        ...Object.values(documentNavigation.children).flatMap((page) =>
          page.items.flatMap((entry) => (entry.kind === 'DOCUMENT' ? [entry.document] : [])),
        ),
        ...documentSearch.items,
      ]),
    [documentNavigation.children, documentNavigation.root.items, documentSearch.items],
  );
  const sessions = useMemo(
    () => buildCreationSessionProjection(data.series, data.styleExplorationBatches),
    [data.series, data.styleExplorationBatches],
  );
  const projection = useMemo(
    () =>
      buildCreationLibraryProjection({
        creationItems: data.creationItems,
        animations: data.animations,
        labels: messages.creator.album,
        locale,
        series: data.series,
        imageBreakdowns: data.imageBreakdowns ?? [],
        evaluationSuites: data.evaluationSuites ?? [],
        sessions,
        inspirationStashes: data.inspirationStashes ?? [],
        socialPosts: data.socialPosts ?? [],
        articles: data.articles ?? [],
        videoDocuments: navigationDocuments,
        derivedVisuals: data.derivedVisuals ?? [],
      }),
    [
      data.animations,
      messages.creator.album,
      data.articles,
      data.creationItems,
      data.derivedVisuals,
      data.inspirationStashes,
      data.imageBreakdowns,
      data.evaluationSuites,
      data.series,
      data.socialPosts,
      locale,
      navigationDocuments,
      sessions,
    ],
  );
  const tree = useMemo(() => buildAlbumTreeIndex(data.albums), [data.albums]);
  const albumDraft = useCreationAlbumDraft({
    request: createAlbumRequest,
    tree,
    busy: lifecycleBusy,
    reveal: (path) => {
      setQuery('');
      setSearchOpen(false);
      onFilterChange({ ...allCreationLibraryFilters });
      for (const id of path) setAlbumPersistent('album:' + id, true, false);
    },
    onConfirm: onConfirmCreateAlbum,
    onCancel: onCancelCreateAlbum,
    notify,
  });
  const draftAlbumPath = albumDraft.path;
  const assetsById = useMemo(() => {
    const result = new Map<string, AssetDto>();
    const add = (asset: AssetDto | null | undefined) => {
      if (asset) result.set(asset.id, asset);
    };
    for (const album of data.albums) {
      album.previewAssets.forEach(add);
      album.documentPreviewAssets?.forEach(add);
    }
    for (const series of data.series) allAssets(series, { includeFailed: true }).forEach(add);
    for (const stash of data.inspirationStashes ?? []) stash.content.referenceAssets.forEach(add);
    for (const breakdown of data.imageBreakdowns ?? []) add(breakdown.sourceAsset);
    for (const post of data.socialPosts ?? []) post.content.mediaAssets.forEach(add);
    for (const article of data.articles ?? []) article.content.mediaAssets.forEach(add);
    for (const animation of data.animations ?? []) add(animation.preview);
    for (const document of navigationDocuments) {
      add(document.source.asset);
    }
    return result;
  }, [
    data.albums,
    data.animations,
    data.articles,
    data.imageBreakdowns,
    data.inspirationStashes,
    data.series,
    data.socialPosts,
    navigationDocuments,
  ]);

  const selectedForm = useMemo(() => {
    if (selectedAnimationId) return projection.formByEntityRef.get('GIF_DOCUMENT:' + selectedAnimationId) ?? null;
    if (selectedDerivedVisualId) {
      const derived = projection.formByEntityRef.get('DERIVED_VISUAL:' + selectedDerivedVisualId);
      if (derived) return derived;
    }
    if (selectedSeriesId) {
      const derived = projection.items
        .flatMap((item) => item.orderedForms)
        .find(
          (form) =>
            (form.role === 'SOCIAL_POST_COVER' || form.role === 'ARTICLE_HEADER' || form.role === 'ARTICLE_INLINE') &&
            form.entity?.promptSeriesId === selectedSeriesId,
        );
      if (derived) return derived;
    }
    const directRefs = [
      selectedEvaluationSuiteId ? 'EVALUATION_SUITE:' + selectedEvaluationSuiteId : null,
      selectedImageBreakdownId ? 'IMAGE_BREAKDOWN:' + selectedImageBreakdownId : null,
      selectedDocumentId ? 'VIDEO_DOCUMENT:' + selectedDocumentId : null,
      selectedArticleId ? 'ARTICLE:' + selectedArticleId : null,
      selectedSocialPostId ? 'SOCIAL_POST:' + selectedSocialPostId : null,
      selectedInspirationStashId ? 'ARTICLE:' + selectedInspirationStashId : null,
      selectedSeriesId ? 'PROMPT_SERIES:' + selectedSeriesId : null,
    ];
    for (const key of directRefs) {
      if (!key) continue;
      const form = projection.formByEntityRef.get(key);
      if (form) return form;
    }
    if (selectedCreationId) {
      const creation = (data.creations ?? []).find((candidate: CreationDto) => candidate.id === selectedCreationId);
      if (creation?.sourceScope.kind === 'SERIES') {
        return projection.formByEntityRef.get('PROMPT_SERIES:' + creation.sourceScope.id) ?? null;
      }
    }
    return null;
  }, [
    data.creations,
    projection.formByEntityRef,
    projection.items,
    selectedAnimationId,
    selectedArticleId,
    selectedCreationId,
    selectedDocumentId,
    selectedDerivedVisualId,
    selectedInspirationStashId,
    selectedImageBreakdownId,
    selectedEvaluationSuiteId,
    selectedSeriesId,
    selectedSocialPostId,
  ]);
  const selectedItem = selectedForm ? (projection.itemById.get(selectedForm.form.creationItemId) ?? null) : null;
  const selectedItemId = selectedItem?.key ?? null;
  const selectedFormId = selectedForm?.form.id ?? null;
  const outlineCurrentKey = outlineCurrentNodeKey(selectedAlbumId, selectedForm, selectedSeriesId);
  const selectedAlbumPath = useMemo(() => {
    const targetAlbumId = selectedAlbumId ?? selectedItem?.item.albumId ?? selectedDocumentAlbumId;
    if (!targetAlbumId) return [];
    const path: string[] = [];
    const visited = new Set<string>();
    let albumId: string | null = targetAlbumId;
    while (albumId && !visited.has(albumId)) {
      visited.add(albumId);
      path.push(albumId);
      albumId = tree.parentById.get(albumId) ?? null;
    }
    return path;
  }, [selectedAlbumId, selectedDocumentAlbumId, selectedItem?.item.albumId, tree.parentById]);
  const selectedAlbumPathSet = useMemo(() => new Set(selectedAlbumPath), [selectedAlbumPath]);
  useCreationTreeScroll({
    active: active && mode === 'full',
    viewportRef,
    memory: libraryScroll,
    navigationKey: creationTreeNavigationKey(outlineCurrentKey, selectedAlbumPath),
    currentSelector: '[data-result-library-selected="true"]',
  });

  function socialCoverGroup(form: CreationFormProjection) {
    if (form.role !== 'SOCIAL_POST_COVER') return [form];
    const item = projection.itemById.get(form.form.creationItemId);
    return (
      item?.orderedForms.filter(
        (candidate) => candidate.role === 'SOCIAL_POST_COVER' && candidate.form.sourceFormId === form.form.sourceFormId,
      ) ?? [form]
    );
  }

  function formDisplayTitle(form: CreationFormProjection) {
    if (form.role === 'SOCIAL_POST_COVER') return messages.creator.album.formKinds.SOCIAL_POST_COVER;
    const title = creationFormTitle(form, messages.creator.album);
    if (form.role !== 'ANIMATION') return title;
    const matches = projection.itemById
      .get(form.form.creationItemId)
      ?.orderedForms.filter(
        (candidate) => candidate.role === 'ANIMATION' && creationFormTitle(candidate, messages.creator.album) === title,
      );
    if (!matches || matches.length < 2) return title;
    return `${title} · ${matches.findIndex((candidate) => candidate.form.id === form.form.id) + 1}`;
  }

  function formDisplayKind(form: CreationFormProjection) {
    if (form.role !== 'SOCIAL_POST_COVER') return formKindLabel(form);
    const count = socialCoverGroup(form).length;
    return count > 1 ? libraryLabels.coverConcepts(count) : libraryLabels.cover;
  }

  function formTreeKey(form: CreationFormProjection) {
    return form.role === 'SOCIAL_POST_COVER'
      ? `cover-design:${form.form.creationItemId}:${form.form.sourceFormId ?? 'legacy'}`
      : `form:${form.form.id}`;
  }

  function formGroupSelected(form: CreationFormProjection) {
    return socialCoverGroup(form).some((candidate) => candidate.form.id === selectedFormId);
  }

  useEffect(() => {
    if (!selectedItem || !selectedForm || selectedItem.defaultForm?.form.id === selectedForm.form.id) return;
    setItemPersistent('item:' + selectedItem.key, true, false);
  }, [selectedForm, selectedItem, setItemPersistent]);

  useEffect(() => {
    if (selectedAlbumPath.length === 0) {
      lastAutoRevealedAlbumSelectionRef.current = null;
      return;
    }

    const selectionKey = JSON.stringify([
      selectedAlbumId,
      selectedItemId,
      selectedFormId,
      selectedDocumentId,
      ...selectedAlbumPath,
    ]);
    if (lastAutoRevealedAlbumSelectionRef.current === selectionKey) return;
    lastAutoRevealedAlbumSelectionRef.current = selectionKey;
    for (const currentAlbumId of selectedAlbumPath) setAlbumPersistent('album:' + currentAlbumId, true, false);
  }, [selectedAlbumId, selectedAlbumPath, selectedDocumentId, selectedFormId, selectedItemId, setAlbumPersistent]);

  useEffect(() => {
    if (!active || mode !== 'full' || !includeDocuments) return;
    for (const branchId of albumExpansion.openIds) {
      if (branchId.startsWith('album:')) documentNavigation.ensureChildren(branchId.slice('album:'.length));
    }
  }, [active, albumExpansion.openIds, documentNavigation, includeDocuments, mode]);

  const visibleItems = useMemo(() => {
    return projection.items.filter((item) => {
      const categoryForms = item.orderedForms.filter((form) => formMatchesFilter(form, filter));
      if (categoryForms.length === 0) return false;
      if (!queryKey) return true;
      return categoryForms.some((form) =>
        normalized(creationFormTitle(form, messages.creator.album), locale).includes(queryKey),
      );
    });
  }, [filter, locale, messages.creator.album, projection.items, queryKey]);
  const authorOptions = useMemo(
    () => creationLibraryAuthorOptions(projection.items, messages),
    [projection.items, messages],
  );
  const itemsByAlbumId = useMemo(() => {
    const result = new Map<string | null, CreationItemProjection[]>();
    for (const item of visibleItems) {
      const albumId = item.item.albumId;
      const values = result.get(albumId);
      if (values) values.push(item);
      else result.set(albumId, [item]);
    }
    return result;
  }, [visibleItems]);

  const albumVisible = useMemo(() => {
    const cache = new Map<string, boolean>();
    const visit = (albumId: string, visiting = new Set<string>()): boolean => {
      const cached = cache.get(albumId);
      if (cached !== undefined) return cached;
      if (visiting.has(albumId) || tree.effectivelyArchived.has(albumId)) return false;
      const nextVisiting = new Set(visiting);
      nextVisiting.add(albumId);
      const album = tree.byId.get(albumId);
      const ownMatch = Boolean(
        album &&
        isAllCreationLibraryFilter(filter) &&
        (!queryKey || normalized(album.title, locale).includes(queryKey)),
      );
      const containsItems = (itemsByAlbumId.get(albumId)?.length ?? 0) > 0;
      const containsAlbums = (tree.childrenByParentId.get(albumId) ?? []).some((child) =>
        visit(child.id, nextVisiting),
      );
      const visible = draftAlbumPath.has(albumId) || ownMatch || containsItems || containsAlbums;
      cache.set(albumId, visible);
      return visible;
    };
    for (const album of data.albums) visit(album.id);
    return cache;
  }, [data.albums, draftAlbumPath, filter, itemsByAlbumId, locale, queryKey, tree]);

  function visibleItemForms(item: CreationItemProjection) {
    const visible: CreationFormProjection[] = [];
    const seenGroups = new Set<string>();
    for (const form of item.orderedForms) {
      if (form.role !== 'SOCIAL_POST_COVER') {
        if (
          formMatchesFilter(form, filter) &&
          (!queryKey || normalized(creationFormTitle(form, messages.creator.album), locale).includes(queryKey))
        )
          visible.push(form);
        continue;
      }
      const groupKey = formTreeKey(form);
      if (seenGroups.has(groupKey)) continue;
      seenGroups.add(groupKey);
      const group = socialCoverGroup(form);
      const selected = group.find((candidate) => candidate.form.id === selectedFormId);
      const representative = selected ?? group.at(-1) ?? form;
      const queryMatches =
        !queryKey ||
        normalized(formDisplayTitle(representative), locale).includes(queryKey) ||
        group.some((candidate) =>
          normalized(creationFormTitle(candidate, messages.creator.album), locale).includes(queryKey),
        );
      if (formMatchesFilter(representative, filter) && queryMatches) visible.push(representative);
    }
    return visible;
  }

  function formAssets(form: CreationFormProjection) {
    const assetIds = socialCoverGroup(form).flatMap(creationFormPreviewAssetIds);
    const assets = [...new Set(assetIds)].flatMap((assetId) => assetsById.get(assetId) ?? []);
    if (assets.length > 0 || form.role !== 'VIDEO_DOCUMENT' || !form.entity) return assets;
    return [form.entity.source.asset];
  }

  function creationItemAssets(item: CreationItemProjection) {
    const assets = new Map<string, AssetDto>();
    for (const form of item.orderedForms) {
      for (const asset of formAssets(form)) assets.set(asset.id, asset);
    }
    return [...assets.values()];
  }

  function openForm(form: CreationFormProjection) {
    switch (form.role) {
      case 'ANIMATION':
        onSelectAnimation(form.entityRef.id);
        break;
      case 'INSPIRATION':
        onSelectInspirationStash(form.entityRef.id);
        break;
      case 'IMAGE_BREAKDOWN':
        onSelectImageBreakdown(form.entityRef.id);
        break;
      case 'EVALUATION_SUITE':
        onSelectEvaluationSuite(form.entityRef.id);
        break;
      case 'IMAGE_CREATION':
        onSelect(form.session?.primarySeries.id ?? form.entityRef.id);
        break;
      case 'SOCIAL_POST':
        onSelectSocialPost(form.entityRef.id);
        break;
      case 'ARTICLE':
        onSelectArticle(form.entityRef.id);
        break;
      case 'VIDEO_DOCUMENT':
        onSelectDocument(form.entityRef.id, projection.itemById.get(form.form.creationItemId)?.item.albumId ?? null);
        break;
      case 'SOCIAL_POST_COVER':
      case 'ARTICLE_HEADER':
      case 'ARTICLE_INLINE':
        onOpenDerivedVisual(form.entityRef.id);
        break;
    }
  }

  function openPreviewAsset(asset: AssetDto, forms: readonly CreationFormProjection[]) {
    const document = forms.find((form) => form.role === 'VIDEO_DOCUMENT' && form.entity?.source.asset.id === asset.id);
    if (document) {
      openForm(document);
      return;
    }
    // Prefer an image workspace over the article or manuscript that also embeds it.
    for (const form of forms) {
      if (
        form.role !== 'IMAGE_CREATION' &&
        form.role !== 'SOCIAL_POST_COVER' &&
        form.role !== 'ARTICLE_HEADER' &&
        form.role !== 'ARTICLE_INLINE'
      )
        continue;
      const record = form.session
        ? creationSessionCoverFirstAssets(form.session).find((entry) => entry.asset.id === asset.id)
        : undefined;
      if (!record && !creationFormPreviewAssetIds(form).includes(asset.id)) continue;
      if (form.role === 'IMAGE_CREATION') {
        onSelect(record?.seriesId ?? form.entityRef.id, asset.id);
      } else {
        onOpenDerivedVisual(form.entityRef.id, { assetId: asset.id, outputSeriesId: record?.seriesId });
      }
      return;
    }
    setPreviewAsset(asset);
  }

  function openAlbumPreviewAsset(albumId: string, asset: AssetDto) {
    const forms = projection.items
      .filter((item) => item.item.albumId && albumIsInside(item.item.albumId, albumId))
      .flatMap((item) => item.orderedForms);
    openPreviewAsset(asset, forms);
  }

  function formPreview(form: CreationFormProjection, spread: MediaStackSpread) {
    const assets = formAssets(form);
    const Icon = formIcon(form);
    const kindLabel = formKindLabel(form);
    return (
      <span className="relative grid h-[3.75rem] w-full place-items-center overflow-visible">
        <MediaStackPreview
          className="pointer-events-none"
          size="tree"
          singleItemAlign="center"
          items={assets.map((asset) => ({ asset }))}
          maxItems={3}
          spread={spread}
          onAssetSelect={(asset) => {
            const item = projection.itemById.get(form.form.creationItemId);
            openPreviewAsset(asset, [...socialCoverGroup(form), ...(item?.orderedForms ?? [])]);
          }}
        />
        <span
          title={kindLabel}
          aria-label={kindLabel}
          className="pointer-events-none absolute bottom-0 left-0 z-20 grid size-5 place-items-center rounded-sm bg-overlay/95 text-foreground-secondary"
        >
          <Icon className="size-3" />
        </span>
      </span>
    );
  }

  function creationItemPreview(item: CreationItemProjection, assets: readonly AssetDto[], spread: MediaStackSpread) {
    if (assets.length === 0) {
      const Icon = item.orderedForms.length === 1 ? formIcon(item.orderedForms[0]) : Layers3Icon;
      return (
        <span className="mx-1 grid size-7 place-items-center text-muted-foreground">
          <Icon className="size-4" aria-hidden="true" />
        </span>
      );
    }
    return (
      <MediaStackPreview
        className="pointer-events-none"
        size="tree"
        singleItemAlign="center"
        items={assets.map((asset) => ({ asset }))}
        maxItems={3}
        spread={spread}
        onAssetSelect={(asset) => openPreviewAsset(asset, item.orderedForms)}
      />
    );
  }

  function creationItemFormIndicators(item: CreationItemProjection) {
    const kind = (form: CreationFormProjection) =>
      form.role === 'ARTICLE' && form.entity?.content.editorMode === 'OUTLINE' ? 'OUTLINE' : form.role;
    const forms = [...new Map(item.orderedForms.map((form) => [kind(form), form] as const)).values()];
    const label = new Intl.ListFormat(locale === 'zh' ? 'zh-CN' : 'en', { style: 'short', type: 'conjunction' }).format(
      [...(item.item.pinned ? [libraryLabels.pinnedLabel] : []), ...forms.map(formKindLabel)],
    );
    return (
      <span className="mt-1 flex items-center gap-1 text-muted-foreground" aria-label={label}>
        {item.item.pinned && <PinIcon className="size-3" aria-hidden="true" />}
        {forms.map((form) => {
          const Icon = formIcon(form);
          return <Icon key={kind(form)} className="size-3" aria-hidden="true" />;
        })}
      </span>
    );
  }

  function childFormActions(form: CreationFormProjection): ActionMenuAction[] {
    const title = formDisplayTitle(form);
    const actions: ActionMenuAction[] = [
      {
        id: 'open-form',
        label: creatorAlbumLabels.open,
        icon: formIcon(form),
        onSelect: () => openForm(form),
      },
    ];
    if (form.role === 'ARTICLE' && form.entity) {
      actions.push({
        id: 'rename-form',
        label: creatorAlbumLabels.rename,
        icon: PencilIcon,
        disabled: lifecycleBusy,
        onSelect: () => onRenameArticle(form.entity!),
      });
    }
    if (form.role === 'ANIMATION' && form.entity) {
      actions.push({
        id: 'delete-animation-form',
        label: creatorAlbumLabels.delete,
        icon: Trash2Icon,
        destructive: true,
        separatorBefore: true,
        disabled: lifecycleBusy,
        onSelect: () =>
          onContentLifecycleAction({
            action: 'DELETE',
            target: { entityType: 'GIF_DOCUMENT', entityId: form.entityRef.id, scope: 'FORM' },
            title,
          }),
      });
    }
    return actions.map((action) => ({ ...action, label: action.label || title }));
  }

  function renderChildForm(form: CreationFormProjection, topology: TreeBranchItemTopology, compactMedia = false) {
    const title = formDisplayTitle(form);
    const kindLabel = formDisplayKind(form);
    const assets = formAssets(form);
    const compact = compactMedia || assets.length === 0;
    const Icon = formIcon(form);
    const metrics = compact
      ? COMPACT_TREE_NODE_METRICS
      : getCreationTreeMediaNodeMetrics(assets.map((asset) => ({ asset })));
    const actions = childFormActions(form);
    const row = (
      <CreationLibraryTreeItem
        dataAttributes={{
          'data-creation-item-id': form.form.creationItemId,
          'data-creation-form-id': form.form.id,
          'data-creation-form-role': form.role,
          'data-tree-node-id': formTreeKey(form),
        }}
        selected={formGroupSelected(form)}
        compact={compact}
        branchTopology={topology}
        ariaLabel={kindLabel + ': ' + title}
        openLabel={`${creatorAlbumLabels.open}: ${title}`}
        title={title}
        metadata={!compact && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{kindLabel}</span>}
        previewBounds={metrics.bounds}
        previewStyle={{ width: metrics.width }}
        canSpreadPreview={!compact && assets.length > 1}
        preview={
          compact ? (
            <span className="mx-1 grid size-7 place-items-center overflow-hidden rounded-sm">
              {assets[0] ? (
                <AssetThumbnail asset={assets[0]} size={64} alt="" className="size-full object-contain" />
              ) : (
                <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              )}
            </span>
          ) : (
            (previewExpanded) => formPreview(form, previewExpanded ? 'expanded' : 'settled')
          )
        }
        controls={
          <div data-result-library-row-control className={rowControlsClassName}>
            <ActionMenuButton
              actions={actions}
              label={`${creatorAlbumLabels.moreActions}: ${title}`}
              className={cn(rowControlClassName, 'size-6')}
            />
          </div>
        }
        onOpen={() => openForm(form)}
      />
    );
    return (
      <ContextMenu key={formTreeKey(form)}>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <ContextMenuContent>
          <ActionContextMenuItems actions={actions} />
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  function itemActions(
    item: CreationItemProjection,
    openTarget: CreationFormProjection,
    expanded: boolean,
    formCount: number,
  ): ActionMenuAction[] {
    const defaultForm = item.defaultForm;
    const title = itemLifecycleTitle(item);
    const tabTarget = creationFormTabTarget(openTarget, item.item.albumId);
    const actions: ActionMenuAction[] = [];
    actions.push({
      id: 'open-item',
      label: creatorAlbumLabels.open,
      icon: formIcon(openTarget),
      onSelect: () => openForm(openTarget),
    });
    if (tabTarget) {
      actions.push({
        id: 'open-item-in-new-tab',
        label: libraryLabels.openInNewTab,
        icon: PlusIcon,
        onSelect: () => onOpenInNewTab(tabTarget),
      });
    }
    if (defaultForm) {
      if (defaultForm.role === 'ARTICLE' && defaultForm.entity) {
        actions.push({
          id: 'rename-item',
          label: creatorAlbumLabels.rename,
          icon: PencilIcon,
          disabled: lifecycleBusy,
          onSelect: () => onRenameArticle(defaultForm.entity!),
        });
      }
      if (defaultForm.role === 'IMAGE_CREATION' && defaultForm.session) {
        actions.push(
          {
            id: 'rename-item',
            label: creatorAlbumLabels.rename,
            icon: PencilIcon,
            disabled: lifecycleBusy,
            onSelect: () => onRenameSeries(defaultForm.session!.primarySeries),
          },
          {
            id: 'manage-results',
            label: libraryLabels.manageResults,
            icon: ImagesIcon,
            onSelect: () => onMore(defaultForm.session!.primarySeries.id),
          },
        );
      }
      if (defaultForm.role === 'VIDEO_DOCUMENT' && defaultForm.entity) {
        actions.push({
          id: 'rename-item',
          label: creatorAlbumLabels.rename,
          icon: PencilIcon,
          disabled: lifecycleBusy,
          onSelect: () => onRenameDocument(defaultForm.entity!),
        });
      }
    }
    actions.push({
      id: 'pin-item',
      label: item.item.pinned ? creatorAlbumLabels.unpin : creatorAlbumLabels.pin,
      icon: item.item.pinned ? PinOffIcon : PinIcon,
      disabled: lifecycleBusy,
      onSelect: () => onToggleCreationItemPin(item.key, !item.item.pinned),
    });
    if (formCount > 1) {
      actions.push(
        createTreeBranchExpansionAction({
          expanded,
          expandLabel: libraryLabels.expandForms,
          collapseLabel: libraryLabels.collapseForms,
          onExpandedChange: (open) => itemExpansion.setPersistent('item:' + item.key, open),
        }),
      );
    }
    actions.push(
      {
        id: 'move-item',
        label: creatorAlbumLabels.move,
        icon: FolderInputIcon,
        disabled: lifecycleBusy,
        onSelect: () =>
          setMoveTarget({
            kind: 'CREATION',
            id: item.key,
            title,
            currentAlbumId: item.item.albumId,
          }),
      },
      {
        id: 'archive-item',
        label: creatorAlbumLabels.archive,
        icon: ArchiveIcon,
        separatorBefore: true,
        disabled: lifecycleBusy,
        onSelect: () =>
          onContentLifecycleAction({
            action: 'ARCHIVE',
            target: { entityType: 'CREATION_ITEM', entityId: item.key },
            title,
          }),
      },
      {
        id: 'delete-item',
        label: creatorAlbumLabels.delete,
        icon: Trash2Icon,
        destructive: true,
        disabled: lifecycleBusy,
        onSelect: () =>
          onContentLifecycleAction({
            action: 'DELETE',
            target: { entityType: 'CREATION_ITEM', entityId: item.key },
            title,
          }),
      },
    );
    return actions;
  }

  function startCreationItemDrag(event: DragEvent, creationItemId: string) {
    writeCreationItemDrag(event.dataTransfer, creationItemId);
    setDraggedCreationItemId(creationItemId);
  }

  function startAlbumDrag(event: DragEvent, albumId: string) {
    writeAlbumDrag(event.dataTransfer, albumId);
    setDraggedAlbumId(albumId);
  }

  function clearDrag() {
    endCreationTreeDrag();
    setDraggedCreationItemId(null);
    setDraggedAlbumId(null);
    setDropAlbumId(null);
  }

  function albumIsInside(candidateParentId: string, albumId: string) {
    let current: string | undefined = candidateParentId;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      if (current === albumId) return true;
      visited.add(current);
      current = tree.parentById.get(current);
    }
    return false;
  }

  function hasTreeDrag(event: DragEvent) {
    if (!acceptsItemTransfer(event)) return false;
    return Boolean(readCreationTreeDrag(event.dataTransfer));
  }

  async function dropIntoAlbum(event: DragEvent, albumId: string) {
    event.preventDefault();
    event.stopPropagation();
    try {
      if (event.dataTransfer.types.includes('Files') && onImportExternalFiles) {
        const files = [...event.dataTransfer.files];
        if (files.length) onImportExternalFiles(albumId, files, 'file-drop');
        return;
      }
      if (lifecycleBusy || !acceptsItemTransfer(event)) return;
      const source = readCreationTreeDrag(event.dataTransfer);
      const creationItemId = source?.kind === 'CREATION_ITEM' ? source.id : null;
      if (creationItemId) {
        const item = projection.itemById.get(creationItemId);
        if (item && (item.item.albumId !== albumId || itemDragIntent(event) === 'COPY'))
          await onMoveCreationItem(creationItemId, albumId, itemDragIntent(event) === 'COPY');
        return;
      }
      const albumIdValue = source?.kind === 'ALBUM' ? source.id : null;
      if (albumIdValue && albumIdValue !== albumId && !albumIsInside(albumId, albumIdValue)) {
        await onMoveAlbum(albumIdValue, albumId, itemDragIntent(event) === 'COPY');
      }
    } finally {
      clearDrag();
    }
  }

  async function dropAtRoot(event: DragEvent) {
    event.preventDefault();
    if (lifecycleBusy || !acceptsItemTransfer(event)) return;
    try {
      const source = readCreationTreeDrag(event.dataTransfer);
      const creationItemId = source?.kind === 'CREATION_ITEM' ? source.id : null;
      if (creationItemId) {
        const item = projection.itemById.get(creationItemId);
        if (item && (item.item.albumId || itemDragIntent(event) === 'COPY'))
          await onMoveCreationItem(creationItemId, null, itemDragIntent(event) === 'COPY');
        return;
      }
      const albumIdValue = source?.kind === 'ALBUM' ? source.id : null;
      if (albumIdValue && (tree.parentById.has(albumIdValue) || itemDragIntent(event) === 'COPY'))
        await onMoveAlbum(albumIdValue, null, itemDragIntent(event) === 'COPY');
    } finally {
      clearDrag();
    }
  }

  function renderCreationItem(item: CreationItemProjection, topology?: TreeBranchItemTopology): ReactNode {
    const branchId = 'item:' + item.key;
    const forms = visibleItemForms(item);
    const formGroups = groupCreationAnimationForms(forms);
    const openTarget = forms.find((form) => form.form.id === item.defaultForm?.form.id) ?? forms[0];
    if (!openTarget) return null;
    const visibleItem = { ...item, orderedForms: forms, defaultForm: openTarget };
    const expandable = forms.length > 1;
    const expanded = itemExpansion.isOpen(branchId);
    const title = forms.length === 1 ? formDisplayTitle(openTarget) : itemLifecycleTitle(item);
    const assets = creationItemAssets(visibleItem);
    const compact = assets.length === 0;
    const metrics = compact
      ? COMPACT_TREE_NODE_METRICS
      : getCreationTreeMediaNodeMetrics(assets.map((asset) => ({ asset })));
    const rowHeight = compact ? TREE_CONNECTION_GEOMETRY.compactRowHeight : TREE_CONNECTION_GEOMETRY.rowHeight;
    const actions = itemActions(item, openTarget, expanded, forms.length);
    const row = (
      <CreationLibraryTreeItem
        dataAttributes={{
          'data-creation-item-id': item.key,
          'data-tree-node-id': branchId,
        }}
        selected={selectedItemId === item.key && forms.some(formGroupSelected) && !expanded}
        compact={compact}
        branchTopology={topology}
        ariaLabel={libraryLabels.creationItemLabel(title)}
        openLabel={libraryLabels.openItemLabel(title)}
        title={title}
        metadata={!compact && creationItemFormIndicators(visibleItem)}
        childBranch={expandable ? { open: expanded } : undefined}
        canSpreadPreview={assets.length > 1}
        previewBounds={metrics.bounds}
        previewStyle={{ width: metrics.width }}
        preview={(previewExpanded) => (
          <>
            {creationItemPreview(
              visibleItem,
              assets,
              previewExpanded ? 'expanded' : expanded ? 'settled' : 'collapsed',
            )}
            {compact && expandable && (
              <CollapsibleTrigger asChild>
                <TreeDisclosureRail
                  attached
                  open={expanded}
                  label={expanded ? libraryLabels.collapseForms : libraryLabels.expandForms}
                  anchor={getTreeNodeAnchor(metrics.bounds, compact ? 0 : undefined)}
                  rowHeight={rowHeight}
                  onClick={(event) => event.stopPropagation()}
                />
              </CollapsibleTrigger>
            )}
          </>
        )}
        controls={
          <>
            {compact && item.item.pinned && (
              <PinIcon className="pointer-events-none relative z-10 size-3 text-muted-foreground" />
            )}
            <div data-result-library-row-control data-item-drag-ignore className={rowControlsClassName}>
              <ActionMenuButton
                actions={actions}
                label={libraryLabels.itemActionsLabel(title)}
                className={cn(rowControlClassName, 'size-6')}
              />
            </div>
          </>
        }
        draggable={!lifecycleBusy}
        onDragStart={(event) => startCreationItemDrag(event, item.key)}
        onDragEnd={clearDrag}
        onGestureExpand={() => itemExpansion.expandFromGesture(branchId)}
        onPointerTrackStart={(clientY) => itemExpansion.beginPointerTrack(branchId, clientY)}
        onPointerTrack={(clientY) => itemExpansion.trackPointer(branchId, clientY)}
        onOpen={() => openForm(openTarget)}
      />
    );
    return (
      <Collapsible
        key={item.key}
        open={expanded}
        onOpenChange={(open) => itemExpansion.setPersistent(branchId, open)}
        className="relative"
        data-tree-branch-id={branchId}
        data-creation-item-branch={item.key}
      >
        {topology && <TreeBranchTransitRail topology={topology} />}
        <ContextMenu>
          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
          <ContextMenuContent>
            <ActionContextMenuItems actions={actions} />
          </ContextMenuContent>
        </ContextMenu>
        {expanded && expandable && (
          <TreeBranchCollapseRail
            label={libraryLabels.collapseForms}
            rowHeight={rowHeight}
            onCollapse={() => itemExpansion.collapse(branchId)}
          />
        )}
        {expandable && (
          <TreeBranchContent>
            <TreeBranchCollapseProvider onCollapse={() => itemExpansion.collapse(branchId)}>
              {formGroups.map((group, index) => {
                const topology = getTreeBranchItemTopology(index, formGroups.length);
                return group.forms.length === 1 ? (
                  renderChildForm(group.forms[0], topology)
                ) : (
                  <CreationAnimationGroup
                    key={group.key}
                    group={group}
                    topology={topology}
                    selectedFormId={selectedFormId}
                    expansion={itemExpansion}
                    formAssets={formAssets}
                    onOpen={openForm}
                    renderForm={renderChildForm}
                  />
                );
              })}
            </TreeBranchCollapseProvider>
          </TreeBranchContent>
        )}
      </Collapsible>
    );
  }

  function albumActions(album: AlbumDto, expanded: boolean, expandable: boolean): ActionMenuAction[] {
    const labels = messages.gallery.albums;
    const actions: ActionMenuAction[] = [
      {
        id: 'open-album',
        label: labels.open,
        icon: GalleryVerticalEndIcon,
        onSelect: () => onSelectAlbum(album.id),
      },
      pinContentAction({ kind: 'ALBUM', id: album.id }, lifecycleBusy || tree.effectivelyArchived.has(album.id)),
    ];
    if (expandable) {
      actions.push(
        createTreeBranchExpansionAction({
          expanded,
          expandLabel: labels.expand,
          collapseLabel: labels.collapse,
          onExpandedChange: (open) => albumExpansion.setPersistent('album:' + album.id, open),
        }),
      );
    }
    actions.push(
      {
        id: 'new-creation',
        label: messages.creator.results.newCreation,
        icon: PlusIcon,
        disabled: lifecycleBusy,
        onSelect: () => onNewInAlbum(album.id),
      },
      {
        id: 'new-album',
        label: labels.createChild,
        icon: GalleryVerticalEndIcon,
        disabled: lifecycleBusy,
        onSelect: () => onCreateAlbum(album),
      },
      {
        id: 'rename-album',
        label: labels.rename,
        icon: PencilIcon,
        disabled: lifecycleBusy,
        onSelect: () => onRenameAlbum(album),
      },
      {
        id: 'pin-album',
        label: album.pinned ? labels.unpin : labels.pin,
        icon: album.pinned ? PinOffIcon : PinIcon,
        disabled: lifecycleBusy,
        onSelect: () => onToggleAlbumPin(album),
      },
      {
        id: 'move-album',
        label: labels.move,
        icon: FolderInputIcon,
        disabled: lifecycleBusy,
        onSelect: () =>
          setMoveTarget({
            kind: 'ALBUM',
            id: album.id,
            title: album.title,
            currentAlbumId: tree.parentById.get(album.id) ?? null,
          }),
      },
      {
        id: 'archive-album',
        label: labels.archive,
        icon: ArchiveIcon,
        separatorBefore: true,
        disabled: lifecycleBusy,
        onSelect: () =>
          onContentLifecycleAction({
            action: 'ARCHIVE',
            target: { entityType: 'ALBUM', entityId: album.id },
            title: album.title,
          }),
      },
      {
        id: 'delete-album',
        label: labels.delete,
        icon: Trash2Icon,
        destructive: true,
        disabled: lifecycleBusy,
        onSelect: () =>
          onContentLifecycleAction({
            action: 'DELETE',
            target: { entityType: 'ALBUM', entityId: album.id },
            title: album.title,
          }),
      },
    );
    return actions;
  }

  function albumChildren(album: AlbumDto): AlbumChildEntry[] {
    const entries: AlbumChildEntry[] = [
      ...(tree.childrenByParentId.get(album.id) ?? [])
        .filter((child) => albumVisible.get(child.id))
        .map((child) => ({ kind: 'ALBUM' as const, album: child })),
      ...(itemsByAlbumId.get(album.id) ?? []).map((item) => ({ kind: 'ITEM' as const, item })),
    ];
    return entries.sort(compareCreationSidebarEntries);
  }

  function renderAlbum(album: AlbumDto, topology?: TreeBranchItemTopology): ReactNode {
    const branchId = 'album:' + album.id;
    const children = albumChildren(album);
    const childVisibilityEntries = children.map(creationSidebarEntryVisibility);
    const requiredChildKeys = new Set<string>();
    for (const entry of children) {
      if (entry.kind === 'ALBUM' && (selectedAlbumPathSet.has(entry.album.id) || draftAlbumPath.has(entry.album.id))) {
        requiredChildKeys.add(creationSidebarEntryKey(entry));
      } else if (entry.kind === 'ITEM' && selectedAlbumId === null && entry.item.key === selectedItemId) {
        requiredChildKeys.add(creationSidebarEntryKey(entry));
      }
    }
    const childVisibility = albumChildVisibility.project(
      album.id,
      childVisibilityEntries,
      requiredChildKeys,
      Boolean(queryKey),
    );
    const visibleChildren = children.slice(0, childVisibility.visibleCount);
    const showChildDisclosure = childVisibility.disclosure !== null;
    const hasAlbumDraft = albumDraft.belongsTo(album.id);
    const draftOffset = Number(hasAlbumDraft);
    const renderedChildCount = visibleChildren.length + Number(showChildDisclosure) + draftOffset;
    const childDisclosureTopology = showChildDisclosure
      ? getTreeBranchItemTopology(visibleChildren.length + draftOffset, renderedChildCount)
      : undefined;
    const expanded = draftAlbumPath.has(album.id) || albumExpansion.isOpen(branchId);
    const expandable = hasAlbumDraft || children.length > 0 || (includeDocuments && album.creationItemCount > 0);
    const selected = selectedAlbumId === album.id;
    const actions = albumActions(album, expanded, expandable);
    const previewAssets = creationAlbumPreviewAssets(album, filter);
    const compact = previewAssets.length === 0;
    const click: MouseEventHandler<HTMLButtonElement> = (event) => {
      if (event.detail <= 1) onSelectAlbum(album.id);
    };
    const doubleClick: MouseEventHandler<HTMLButtonElement> = () => {
      if (expandable) albumExpansion.setPersistent(branchId, !expanded);
    };
    const row = (
      <div
        data-album-id={album.id}
        data-tree-node-id={branchId}
        data-result-library-selected={selected ? 'true' : undefined}
        role="group"
        aria-label={album.title}
        className={cn(
          'group relative flex h-[4.25rem] min-w-0 cursor-pointer items-center gap-1 rounded-sm px-1 transition-colors hover:bg-hover',
          compact && 'h-9',
          selected &&
            'text-selected-foreground before:pointer-events-none before:absolute before:inset-y-0.5 before:left-0 before:right-0 before:rounded-sm before:bg-selected hover:bg-transparent',
          dropAlbumId === album.id && 'bg-accent ring-1 ring-inset ring-ring',
        )}
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes('Files') || hasTreeDrag(event)) {
            event.preventDefault();
            event.stopPropagation();
            setDropAlbumId(album.id);
          }
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files') || hasTreeDrag(event)) {
            event.preventDefault();
            event.stopPropagation();
            setDropAlbumId(album.id);
            event.dataTransfer.dropEffect =
              event.dataTransfer.types.includes('Files') || itemDragIntent(event) === 'COPY' ? 'copy' : 'move';
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDropAlbumId(null);
          }
        }}
        onDrop={(event) => {
          void dropIntoAlbum(event, album.id);
        }}
        draggable={!lifecycleBusy}
        onDragStart={itemDragStart((event) => startAlbumDrag(event, album.id))}
        onDragEnd={clearDrag}
      >
        <Button
          type="button"
          variant="ghost"
          aria-label={`${albumLabels.open}: ${album.title}`}
          aria-current={selected ? 'page' : undefined}
          className={cn(
            'absolute inset-0 z-0 size-auto rounded-sm p-0 hover:bg-transparent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            selected && 'active:bg-transparent',
          )}
          onClick={click}
          onDoubleClick={doubleClick}
        />
        <AlbumTreePreview
          assets={previewAssets}
          title={album.title}
          open={expanded}
          expandable={expandable}
          compact={compact}
          expandLabel={expanded ? messages.gallery.albums.collapse : messages.gallery.albums.expand}
          overlayStyle="solid"
          branchTopology={topology}
          onGestureExpand={() => albumExpansion.expandFromGesture(branchId)}
          onPointerTrackStart={(clientY) => albumExpansion.beginPointerTrack(branchId, clientY)}
          onPointerTrack={(clientY) => albumExpansion.trackPointer(branchId, clientY)}
          onAssetSelect={(asset) => openAlbumPreviewAsset(album.id, asset)}
          onClick={click}
          onDoubleClick={doubleClick}
        />
        <span className="pointer-events-none relative z-10 min-w-0 flex-1 px-1 pr-8 text-left">
          <strong
            className={cn(
              'line-clamp-2 break-words text-base font-medium leading-5',
              compact && 'line-clamp-1 truncate',
            )}
            title={album.title}
          >
            {album.title}
          </strong>
        </span>
        {album.pinned && <PinIcon className="pointer-events-none relative z-10 size-3.5 text-muted-foreground" />}
        <div data-result-library-row-control data-item-drag-ignore className={rowControlsClassName}>
          <ActionMenuButton
            actions={actions}
            label={`${albumLabels.moreActions}: ${album.title}`}
            className={cn(rowControlClassName, 'size-6')}
          />
        </div>
      </div>
    );
    return (
      <Collapsible
        key={album.id}
        open={expanded}
        onOpenChange={(open) => albumExpansion.setPersistent(branchId, open)}
        className="relative"
        data-tree-branch-id={branchId}
      >
        {topology && <TreeBranchTransitRail topology={topology} />}
        <ContextMenu>
          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
          <ContextMenuContent>
            <ActionContextMenuItems actions={actions} />
          </ContextMenuContent>
        </ContextMenu>
        {expanded && children.length > 0 && (
          <TreeBranchCollapseRail
            label={messages.gallery.albums.collapse}
            rowHeight={compact ? TREE_CONNECTION_GEOMETRY.compactRowHeight : undefined}
            onCollapse={() => albumExpansion.collapse(branchId)}
          />
        )}
        <CreationLibraryChildList
          branchTopology={childDisclosureTopology}
          collapseLabel={messages.gallery.albums.collapse}
          hasVisibleChildren={hasAlbumDraft || visibleChildren.length > 0}
          label={
            childVisibility.disclosure === 'fewer' ? libraryLabels.showFewerChildren : libraryLabels.showMoreChildren
          }
          loading={false}
          resetLabel={childVisibility.canReset ? libraryLabels.restoreDefaultVisibleItems : undefined}
          showDisclosure={showChildDisclosure}
          onCollapse={() => albumExpansion.collapse(branchId)}
          onReveal={() => {
            if (childVisibility.disclosure === 'fewer') albumChildVisibility.reset(album.id);
            else albumChildVisibility.revealMore(album.id, childVisibilityEntries, childVisibility.visibleCount);
          }}
          onReset={() => albumChildVisibility.reset(album.id)}
        >
          {albumDraft.renderAt(album.id, getTreeBranchItemTopology(0, renderedChildCount))}
          {visibleChildren.map((entry, index) => {
            const childTopology = getTreeBranchItemTopology(index + draftOffset, renderedChildCount);
            return entry.kind === 'ALBUM'
              ? renderAlbum(entry.album, childTopology)
              : renderCreationItem(entry.item, childTopology);
          })}
        </CreationLibraryChildList>
      </Collapsible>
    );
  }

  const roots = useMemo<RootEntry[]>(() => {
    const entries: RootEntry[] = [
      ...tree.activeRoots
        .filter((album) => albumVisible.get(album.id))
        .map((album) => ({ kind: 'ALBUM' as const, album })),
      ...(itemsByAlbumId.get(null) ?? []).map((item) => ({ kind: 'ITEM' as const, item })),
    ];
    return entries.sort(compareCreationSidebarEntries);
  }, [albumVisible, itemsByAlbumId, tree.activeRoots]);

  function moveTargetTo(albumId: string | null) {
    if (!moveTarget) return Promise.resolve();
    if (moveTarget.kind === 'ALBUM') return onMoveAlbum(moveTarget.id, albumId);
    if (moveTarget.kind === 'CREATION') return onMoveCreationItem(moveTarget.id, albumId);
    return Promise.resolve();
  }

  const resizeHandle = (
    <ResultLibraryResizeHandle
      showModeToggle={showModeToggle}
      canExpand={canExpand}
      resizeValue={resizeValue}
      resizeMin={resizeMin}
      resizeMax={resizeMax}
      onResizeValueChange={onResizeValueChange}
      onResizeStart={onResizeStart}
    />
  );
  const moveDialog = (
    <AlbumMoveDialog
      albums={data.albums}
      target={moveTarget}
      labels={{
        title: creatorAlbumLabels.moveTitle,
        topLevel: messages.creator.outline.topLevel,
        operationFailed: albumLabels.operationFailed,
      }}
      busy={lifecycleBusy}
      onOpenChange={(open) => {
        if (!open) setMoveTarget(null);
      }}
      onMove={moveTargetTo}
    />
  );

  const collapseButton = (
    <CreationLibraryPaneToggle mode={mode} visible={showModeToggle} canExpand={canExpand} onModeChange={onModeChange} />
  );
  const header = (
    <CreationLibraryHeader
      collapsed={mode === 'images'}
      busy={lifecycleBusy}
      canExpand={canExpand}
      paneToggle={collapseButton}
      onExpand={() => onModeChange('full')}
      onNewCreation={onNew}
      onNewAlbum={() => onCreateAlbum(null)}
      searchOpen={searchOpen}
      onSearchOpenChange={setSearchOpen}
      query={query}
      filter={filter}
      authors={authorOptions}
      onQueryChange={setQuery}
      onFilterChange={onFilterChange}
    />
  );

  if (mode === 'images') {
    return (
      <aside
        {...itemDragScopeProps}
        aria-label={libraryLabels.library}
        className="relative isolate flex size-full min-h-0 flex-col border-r bg-surface-sunken"
      >
        {resizeHandle}
        {header}
        <div className="min-h-0 flex-1" />
        {draftSidebar.feedback}
        {moveDialog}
      </aside>
    );
  }

  return (
    <aside
      aria-label={libraryLabels.library}
      {...itemDragScopeProps}
      className="relative isolate flex min-h-0 min-w-0 flex-col border-r bg-surface-sunken"
    >
      {resizeHandle}
      {header}
      <ScrollArea
        type="always"
        className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:min-h-full"
        viewportRef={viewportRef}
      >
        <div
          data-result-library-root
          data-rendered-root-count={roots.length}
          className="creation-library-tree min-h-full space-y-0.5 px-2 py-2"
          onDragOver={(event) => {
            if (!lifecycleBusy && hasTreeDrag(event)) {
              event.preventDefault();
              event.dataTransfer.dropEffect = itemDragIntent(event) === 'COPY' ? 'copy' : 'move';
            }
          }}
          onDrop={(event) => {
            if (!lifecycleBusy && hasTreeDrag(event)) void dropAtRoot(event);
          }}
        >
          {albumDraft.renderAt(null)}
          {roots.map((entry) => (entry.kind === 'ALBUM' ? renderAlbum(entry.album) : renderCreationItem(entry.item)))}
          <CreationLibraryEmptyState
            rootCount={roots.length}
            hasDraftContent={draftSidebar.hasContent || Boolean(createAlbumRequest)}
            query={queryKey}
            filter={filter}
            surface={surface}
            busy={lifecycleBusy}
            onCreateAlbum={onCreateAlbum}
            onNew={onNew}
          />
        </div>
      </ScrollArea>
      {draftSidebar.content}
      {draftSidebar.feedback}
      {moveDialog}
      <CreationLibraryAssetPreview asset={previewAsset} onClose={() => setPreviewAsset(null)} />
      <span
        data-result-library-drag-state
        data-creation-item-id={draggedCreationItemId ?? undefined}
        data-album-id={draggedAlbumId ?? undefined}
        className="hidden"
        aria-hidden="true"
      />
    </aside>
  );
}
