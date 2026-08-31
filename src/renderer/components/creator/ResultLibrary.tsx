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
  NotebookTextIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
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
import {
  ALBUM_DRAG_TYPE,
  CREATION_ITEM_DRAG_TYPE,
  readCreationItemDrag,
  writeAlbumDrag,
  writeCreationItemDrag,
} from '@/renderer/components/albums/albumDrag';
import { AlbumMoveDialog, type AlbumMoveTarget } from '@/renderer/components/albums/AlbumMoveDialog';
import { AlbumTreePreview } from '@/renderer/components/albums/AlbumTreePreview';
import { buildAlbumTreeIndex } from '@/renderer/components/albums/albumTree';
import { TreeDragHandle } from '@/renderer/components/albums/TreeDragHandle';
import {
  TreeBranchCollapseProvider,
  TreeBranchCollapseRail,
  TreeBranchContent,
  TreeBranchTransitRail,
} from '@/renderer/components/albums/TreeDisclosureRail';
import {
  getTreeBranchItemTopology,
  type TreeBranchItemTopology,
} from '@/renderer/components/albums/treeConnectionGeometry';
import { useTreeBranchExpansion } from '@/renderer/components/albums/useTreeBranchExpansion';
import { createTreeBranchExpansionAction } from '@/renderer/components/albums/treeBranchMenuActions';
import type { ContentLifecycleActionRequest } from '@/renderer/components/albums/useContentLifecycleActions';
import { ActionContextMenuItems, ActionMenuButton, type ActionMenuAction } from '@/renderer/components/ui/action-menu';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible } from '@/renderer/components/ui/collapsible';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/renderer/components/ui/context-menu';
import { QuietEmpty } from '@/renderer/components/ui/quiet-empty';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { CreatorPaneResizeHandle } from '@/renderer/components/creator/CreatorPaneResizeHandle';
import { CreationLibraryChildList } from '@/renderer/components/creator/CreationLibraryChildDisclosure';
import { CreationLibraryToolbar } from '@/renderer/components/creator/CreationLibraryToolbar';
import type { CreationLibraryFilter } from '@/renderer/components/creator/creationLibraryFilter';
import { creationAlbumPreviewAssets } from '@/renderer/components/creator/creationAlbumPreviewAssets';
import { creationFormTabTarget } from '@/renderer/components/creator/creationFormTabTarget';
import {
  buildCreationLibraryProjection,
  creationFormPreviewAssetIds,
  creationFormTitle,
  type CreationFormProjection,
  type CreationItemProjection,
} from '@/renderer/components/creator/creationLibraryProjection';
import { buildCreationSessionProjection } from '@/renderer/components/creator/creationSessionProjection';
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
import { useVideoDocumentList } from '@/renderer/features/video-documents/useVideoDocumentList';
import { useVideoDocumentNavigation } from '@/renderer/features/video-documents/useVideoDocumentNavigation';
import type { CreatorOpenTabTarget } from '@/renderer/components/app/app-navigation';

export type ResultLibraryMode = 'full' | 'images';
export type ResultLibrarySurface =
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
  selectedDerivedVisualId?: string | null;
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
  onRenameArticle(article: ArticleDto): void;
  onContentLifecycleAction(request: ContentLifecycleActionRequest): void;
  onSelect(seriesId: string, assetId?: string): void;
  onOpenDerivedVisual(visualId: string): void;
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
  onMoveAlbum(albumId: string, parentAlbumId: string | null): Promise<void>;
  onMoveCreationItem(creationItemId: string, albumId: string | null): Promise<void>;
  onToggleCreationItemPin(creationItemId: string, pinned: boolean): void;
  onImportExternalFiles?(albumId: string, files: File[], sourceUrl: string): void;
  notify(message: string): void;
}

type RootEntry = { kind: 'ALBUM'; album: AlbumDto } | { kind: 'ITEM'; item: CreationItemProjection };
type AlbumChildEntry = RootEntry;

const rowControlsClassName =
  'pointer-events-none absolute inset-y-0 right-1 z-30 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100';
const rowControlClassName = 'pointer-events-auto shrink-0 rounded-md bg-overlay/95 shadow-overlay';

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
  const leftPinned = left.kind === 'ALBUM' ? left.album.pinned : left.item.item.pinned;
  const rightPinned = right.kind === 'ALBUM' ? right.album.pinned : right.item.item.pinned;
  const pinned = Number(rightPinned) - Number(leftPinned);
  if (pinned) return pinned;
  const leftActivityAt = left.kind === 'ALBUM' ? left.album.activityAt : left.item.activityAt;
  const rightActivityAt = right.kind === 'ALBUM' ? right.album.activityAt : right.item.activityAt;
  const activity = rightActivityAt.localeCompare(leftActivityAt);
  if (activity) return activity;
  const leftCreatedAt = left.kind === 'ALBUM' ? left.album.createdAt : left.item.item.createdAt;
  const rightCreatedAt = right.kind === 'ALBUM' ? right.album.createdAt : right.item.item.createdAt;
  return (
    rightCreatedAt.localeCompare(leftCreatedAt) ||
    creationSidebarEntryKey(left).localeCompare(creationSidebarEntryKey(right))
  );
}

function normalized(value: string, locale: Locale) {
  return value.trim().toLocaleLowerCase(locale === 'zh' ? 'zh-CN' : 'en');
}

function formMatchesFilter(form: CreationFormProjection, filter: CreationLibraryFilter) {
  switch (form.role) {
    case 'INSPIRATION':
      return filter.inspirations;
    case 'IMAGE_BREAKDOWN':
      return filter.images;
    case 'EVALUATION_SUITE':
      return filter.evaluations;
    case 'SOCIAL_POST':
      return filter.socialPosts;
    case 'ARTICLE':
      return filter.articles;
    case 'VIDEO_DOCUMENT':
      return filter.documents;
    case 'IMAGE_CREATION':
    case 'SOCIAL_POST_COVER':
    case 'ARTICLE_HEADER':
    case 'ARTICLE_INLINE':
      return filter.images;
  }
}

function formIcon(form: CreationFormProjection) {
  switch (form.role) {
    case 'INSPIRATION':
      return BookmarkIcon;
    case 'IMAGE_BREAKDOWN':
      return ScanSearchIcon;
    case 'EVALUATION_SUITE':
      return ListChecksIcon;
    case 'SOCIAL_POST':
      return PanelsTopLeftIcon;
    case 'ARTICLE':
      return FileTextIcon;
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

function formKindLabel(form: CreationFormProjection, locale: Locale) {
  if (locale === 'zh') {
    switch (form.role) {
      case 'INSPIRATION':
        return '灵感';
      case 'IMAGE_BREAKDOWN':
        return '图片拆解';
      case 'EVALUATION_SUITE':
        return '评测集';
      case 'SOCIAL_POST':
        return '贴图';
      case 'ARTICLE':
        return '文章';
      case 'VIDEO_DOCUMENT':
        return '视频文档';
      case 'IMAGE_CREATION':
        return '图像创作';
      case 'SOCIAL_POST_COVER':
        return '封面设计';
      case 'ARTICLE_HEADER':
        return '文章题图';
      case 'ARTICLE_INLINE':
        return '文章配图';
    }
  }
  switch (form.role) {
    case 'INSPIRATION':
      return 'Inspiration';
    case 'IMAGE_BREAKDOWN':
      return 'Image breakdown';
    case 'EVALUATION_SUITE':
      return 'Evaluation suite';
    case 'SOCIAL_POST':
      return 'Social post';
    case 'ARTICLE':
      return 'Article';
    case 'VIDEO_DOCUMENT':
      return 'Video document';
    case 'IMAGE_CREATION':
      return 'Image creation';
    case 'SOCIAL_POST_COVER':
      return 'Cover design';
    case 'ARTICLE_HEADER':
      return 'Article header';
    case 'ARTICLE_INLINE':
      return 'Article image';
  }
}

function uniqueDocuments(items: readonly VideoDocumentSummaryDto[]) {
  const byId = new Map<string, VideoDocumentSummaryDto>();
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()];
}

function itemLifecycleTitle(item: CreationItemProjection, locale: Locale) {
  return item.title || (locale === 'zh' ? '未命名创作' : 'Untitled creation');
}

function creationAlbumContext(
  selectedAlbumId: string | null,
  selectedItem: CreationItemProjection | null,
  selectedDocumentAlbumId: string | null,
) {
  return selectedAlbumId ?? selectedItem?.item.albumId ?? selectedDocumentAlbumId ?? null;
}

export function ResultLibrary({
  active,
  data,
  locale,
  activeContent,
  filter,
  selectedSeriesId,
  selectedDerivedVisualId = null,
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
  onMoveAlbum,
  onMoveCreationItem,
  onToggleCreationItemPin,
  onImportExternalFiles,
  notify,
}: Props) {
  const { messages } = useI18n();
  const libraryLabels = messages.creator.results;
  const creatorAlbumLabels = messages.creator.album;
  const albumLabels = messages.gallery.albums;
  const [query, setQuery] = useState('');
  const [moveTarget, setMoveTarget] = useState<AlbumMoveTarget | null>(null);
  const [draggedCreationItemId, setDraggedCreationItemId] = useState<string | null>(null);
  const [draggedAlbumId, setDraggedAlbumId] = useState<string | null>(null);
  const [dropAlbumId, setDropAlbumId] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const albumExpansion = useTreeBranchExpansion(viewportRef);
  const itemExpansion = useTreeBranchExpansion(viewportRef);
  const albumChildVisibility = useCreationAlbumChildVisibility();
  const lastAutoRevealedAlbumSelectionRef = useRef<string | null>(null);
  const setAlbumPersistent = albumExpansion.setPersistent;
  const setItemPersistent = itemExpansion.setPersistent;
  const queryKey = normalized(query, locale);
  const includeDocuments = filter.documents || activeContent === 'documents' || selectedDocumentId !== null;
  const documentNavigation = useVideoDocumentNavigation({
    active: active && includeDocuments,
    refreshKey: documentNavigationRevision,
    notify,
  });
  const documentSearch = useVideoDocumentList({
    active: active && filter.documents && Boolean(queryKey),
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
    for (const document of navigationDocuments) {
      add(document.source.asset);
    }
    return result;
  }, [
    data.albums,
    data.articles,
    data.imageBreakdowns,
    data.inspirationStashes,
    data.series,
    data.socialPosts,
    navigationDocuments,
  ]);

  const selectedForm = useMemo(() => {
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
      selectedInspirationStashId ? 'INSPIRATION_STASH:' + selectedInspirationStashId : null,
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
  const newCreationAlbumId = creationAlbumContext(selectedAlbumId, selectedItem, selectedDocumentAlbumId);

  function startNewCreationInContext() {
    if (newCreationAlbumId) onNewInAlbum(newCreationAlbumId);
    else onNew();
  }

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
    return form.role === 'SOCIAL_POST_COVER'
      ? locale === 'zh'
        ? '封面设计'
        : 'Cover design'
      : creationFormTitle(form, locale);
  }

  function formDisplayKind(form: CreationFormProjection) {
    if (form.role !== 'SOCIAL_POST_COVER') return formKindLabel(form, locale);
    const count = socialCoverGroup(form).length;
    if (locale === 'zh') return count > 1 ? `封面 · ${count} 方案` : '封面';
    return count > 1 ? `Cover · ${count} concepts` : 'Cover';
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
    setItemPersistent('item:' + selectedItem.key, true);
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
    for (const currentAlbumId of selectedAlbumPath) setAlbumPersistent('album:' + currentAlbumId, true);
  }, [selectedAlbumId, selectedAlbumPath, selectedDocumentId, selectedFormId, selectedItemId, setAlbumPersistent]);

  useEffect(() => {
    if (!includeDocuments) return;
    for (const branchId of albumExpansion.openIds) {
      if (branchId.startsWith('album:')) documentNavigation.ensureChildren(branchId.slice('album:'.length));
    }
  }, [albumExpansion.openIds, documentNavigation, includeDocuments]);

  const visibleItems = useMemo(() => {
    return projection.items.filter((item) => {
      const categoryForms = item.orderedForms.filter((form) => formMatchesFilter(form, filter));
      if (categoryForms.length === 0 && item.key !== selectedItemId) return false;
      if (!queryKey || item.key === selectedItemId) return true;
      return categoryForms.some((form) => normalized(creationFormTitle(form, locale), locale).includes(queryKey));
    });
  }, [filter, locale, projection.items, queryKey, selectedItemId]);
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
      const ownMatch = Boolean(album && (!queryKey || normalized(album.title, locale).includes(queryKey)));
      const containsItems = (itemsByAlbumId.get(albumId)?.length ?? 0) > 0;
      const containsAlbums = (tree.childrenByParentId.get(albumId) ?? []).some((child) =>
        visit(child.id, nextVisiting),
      );
      const visible = ownMatch || containsItems || containsAlbums;
      cache.set(albumId, visible);
      return visible;
    };
    for (const album of data.albums) visit(album.id);
    return cache;
  }, [data.albums, itemsByAlbumId, locale, queryKey, tree]);

  function visibleItemForms(item: CreationItemProjection) {
    const visible: CreationFormProjection[] = [];
    const seenGroups = new Set<string>();
    for (const form of item.orderedForms) {
      if (form.role !== 'SOCIAL_POST_COVER') {
        if (form.form.id === selectedFormId) visible.push(form);
        else if (
          formMatchesFilter(form, filter) &&
          (!queryKey || normalized(creationFormTitle(form, locale), locale).includes(queryKey))
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
        group.some((candidate) => normalized(creationFormTitle(candidate, locale), locale).includes(queryKey));
      if (selected || (formMatchesFilter(representative, filter) && queryMatches)) visible.push(representative);
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

  function albumChildDisclosureAssets(entries: readonly AlbumChildEntry[]) {
    const assets = new Map<string, AssetDto>();
    for (const entry of entries) {
      const entryAssets =
        entry.kind === 'ALBUM' ? creationAlbumPreviewAssets(entry.album, filter) : creationItemAssets(entry.item);
      for (const asset of entryAssets) {
        assets.set(asset.id, asset);
        if (assets.size >= 3) return [...assets.values()];
      }
    }
    return [...assets.values()];
  }

  function openForm(form: CreationFormProjection) {
    switch (form.role) {
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

  function formPreview(form: CreationFormProjection, spread: MediaStackSpread) {
    const assets = formAssets(form);
    const Icon = formIcon(form);
    const kindLabel = formKindLabel(form, locale);
    if (assets.length === 0) {
      return (
        <span className="relative grid size-12 place-items-center rounded-md border bg-background text-foreground-secondary">
          <Icon className="size-4" aria-hidden="true" />
          <span className="sr-only">{kindLabel}</span>
        </span>
      );
    }
    return (
      <span className="relative grid h-[3.75rem] w-full place-items-center overflow-visible">
        <MediaStackPreview
          className="pointer-events-none"
          size="tree"
          singleItemAlign="center"
          items={assets.map((asset) => ({ asset }))}
          maxItems={3}
          spread={spread}
        />
        <span
          title={kindLabel}
          aria-label={kindLabel}
          className="pointer-events-none absolute bottom-0 left-0 z-20 grid size-5 place-items-center rounded-md border bg-overlay/95 text-foreground-secondary shadow-overlay"
        >
          <Icon className="size-3" />
        </span>
      </span>
    );
  }

  function creationItemPreview(assets: readonly AssetDto[], spread: MediaStackSpread) {
    if (assets.length === 0) {
      return (
        <span className="relative grid size-12 place-items-center rounded-md border bg-background text-foreground-secondary">
          <Layers3Icon className="size-4" aria-hidden="true" />
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
      />
    );
  }

  function creationItemFormIndicators(item: CreationItemProjection) {
    const forms = [...new Map(item.orderedForms.map((form) => [form.role, form] as const)).values()];
    const formLabel = forms.map((form) => formKindLabel(form, locale)).join(locale === 'zh' ? '、' : ', ');
    const label = item.item.pinned
      ? `${locale === 'zh' ? '已置顶' : 'Pinned'}${locale === 'zh' ? '、' : ', '}${formLabel}`
      : formLabel;
    return (
      <span className="mt-1 flex items-center gap-1 text-muted-foreground" aria-label={label}>
        {item.item.pinned && <PinIcon className="size-3" aria-hidden="true" />}
        {forms.map((form) => {
          const Icon = formIcon(form);
          return <Icon key={form.role} className="size-3" aria-hidden="true" />;
        })}
      </span>
    );
  }

  function childFormActions(form: CreationFormProjection): ActionMenuAction[] {
    const title = formDisplayTitle(form);
    const actions: ActionMenuAction[] = [
      {
        id: 'open-form',
        label: locale === 'zh' ? '打开' : 'Open',
        icon: formIcon(form),
        onSelect: () => openForm(form),
      },
    ];
    if (form.role === 'ARTICLE' && form.entity) {
      actions.push({
        id: 'rename-form',
        label: locale === 'zh' ? '重命名…' : 'Rename…',
        icon: PencilIcon,
        disabled: lifecycleBusy,
        onSelect: () => onRenameArticle(form.entity!),
      });
    }
    return actions.map((action) => ({ ...action, label: action.label || title }));
  }

  function renderChildForm(form: CreationFormProjection, topology: TreeBranchItemTopology) {
    const title = formDisplayTitle(form);
    const kindLabel = formDisplayKind(form);
    const assets = formAssets(form);
    const metrics = getCreationTreeMediaNodeMetrics(assets.map((asset) => ({ asset })));
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
        branchTopology={topology}
        ariaLabel={kindLabel + ': ' + title}
        openLabel={(locale === 'zh' ? '打开：' : 'Open: ') + title}
        title={title}
        metadata={<span className="mt-0.5 block truncate text-xs text-muted-foreground">{kindLabel}</span>}
        previewBounds={metrics.bounds}
        previewStyle={{ width: metrics.width }}
        preview={formPreview(form, 'settled')}
        controls={
          <div data-result-library-row-control className={rowControlsClassName}>
            <ActionMenuButton
              actions={actions}
              label={(locale === 'zh' ? '更多操作：' : 'More actions: ') + title}
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
    const title = itemLifecycleTitle(item, locale);
    const tabTarget = creationFormTabTarget(openTarget, item.item.albumId);
    const actions: ActionMenuAction[] = [];
    actions.push({
      id: 'open-item',
      label: locale === 'zh' ? '打开' : 'Open',
      icon: formIcon(openTarget),
      onSelect: () => openForm(openTarget),
    });
    if (tabTarget) {
      actions.push({
        id: 'open-item-in-new-tab',
        label: locale === 'zh' ? '在新标签页打开' : 'Open in new tab',
        icon: PlusIcon,
        onSelect: () => onOpenInNewTab(tabTarget),
      });
    }
    if (defaultForm) {
      if (defaultForm.role === 'ARTICLE' && defaultForm.entity) {
        actions.push({
          id: 'rename-item',
          label: locale === 'zh' ? '重命名…' : 'Rename…',
          icon: PencilIcon,
          disabled: lifecycleBusy,
          onSelect: () => onRenameArticle(defaultForm.entity!),
        });
      }
      if (defaultForm.role === 'IMAGE_CREATION' && defaultForm.session) {
        actions.push(
          {
            id: 'rename-item',
            label: locale === 'zh' ? '重命名…' : 'Rename…',
            icon: PencilIcon,
            disabled: lifecycleBusy,
            onSelect: () => onRenameSeries(defaultForm.session!.primarySeries),
          },
          {
            id: 'manage-results',
            label: locale === 'zh' ? '管理成果' : 'Manage results',
            icon: ImagesIcon,
            onSelect: () => onMore(defaultForm.session!.primarySeries.id),
          },
        );
      }
      if (defaultForm.role === 'VIDEO_DOCUMENT' && defaultForm.entity) {
        actions.push({
          id: 'rename-item',
          label: locale === 'zh' ? '重命名…' : 'Rename…',
          icon: PencilIcon,
          disabled: lifecycleBusy,
          onSelect: () => onRenameDocument(defaultForm.entity!),
        });
      }
    }
    actions.push({
      id: 'pin-item',
      label: item.item.pinned ? (locale === 'zh' ? '取消置顶' : 'Unpin') : locale === 'zh' ? '置顶' : 'Pin',
      icon: item.item.pinned ? PinOffIcon : PinIcon,
      disabled: lifecycleBusy,
      onSelect: () => onToggleCreationItemPin(item.key, !item.item.pinned),
    });
    if (formCount > 1) {
      actions.push(
        createTreeBranchExpansionAction({
          expanded,
          expandLabel: locale === 'zh' ? '展开创作形式' : 'Expand creation forms',
          collapseLabel: locale === 'zh' ? '收起创作形式' : 'Collapse creation forms',
          onExpandedChange: (open) => itemExpansion.setPersistent('item:' + item.key, open),
        }),
      );
    }
    actions.push(
      {
        id: 'move-item',
        label: locale === 'zh' ? '移动…' : 'Move…',
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
        label: locale === 'zh' ? '归档' : 'Archive',
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
        label: locale === 'zh' ? '删除' : 'Delete',
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
    return (
      event.dataTransfer.types.includes(CREATION_ITEM_DRAG_TYPE) || event.dataTransfer.types.includes(ALBUM_DRAG_TYPE)
    );
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
      const creationItemId = readCreationItemDrag(event.dataTransfer);
      if (creationItemId) {
        const item = projection.itemById.get(creationItemId);
        if (item && item.item.albumId !== albumId) await onMoveCreationItem(creationItemId, albumId);
        return;
      }
      const albumIdValue = event.dataTransfer.getData(ALBUM_DRAG_TYPE).trim();
      if (albumIdValue && albumIdValue !== albumId && !albumIsInside(albumId, albumIdValue)) {
        await onMoveAlbum(albumIdValue, albumId);
      }
    } finally {
      clearDrag();
    }
  }

  async function dropAtRoot(event: DragEvent) {
    event.preventDefault();
    try {
      const creationItemId = readCreationItemDrag(event.dataTransfer);
      if (creationItemId) {
        const item = projection.itemById.get(creationItemId);
        if (item?.item.albumId) await onMoveCreationItem(creationItemId, null);
        return;
      }
      const albumIdValue = event.dataTransfer.getData(ALBUM_DRAG_TYPE).trim();
      if (albumIdValue && tree.parentById.has(albumIdValue)) await onMoveAlbum(albumIdValue, null);
    } finally {
      clearDrag();
    }
  }

  function renderCreationItem(item: CreationItemProjection, topology?: TreeBranchItemTopology): ReactNode {
    const defaultForm = item.defaultForm;
    if (!defaultForm) return null;
    const branchId = 'item:' + item.key;
    const forms = visibleItemForms(item);
    const openTarget = defaultForm;
    const expandable = forms.length > 1;
    const expanded = itemExpansion.isOpen(branchId);
    const title = itemLifecycleTitle(item, locale);
    const assets = creationItemAssets(item);
    const metrics = getCreationTreeMediaNodeMetrics(assets.map((asset) => ({ asset })));
    const actions = itemActions(item, openTarget, expanded, forms.length);
    const row = (
      <CreationLibraryTreeItem
        dataAttributes={{
          'data-creation-item-id': item.key,
          'data-tree-node-id': branchId,
        }}
        selected={selectedItemId === item.key && !expanded}
        branchTopology={topology}
        ariaLabel={(locale === 'zh' ? '创作项：' : 'Creation item: ') + title}
        openLabel={(locale === 'zh' ? '打开：' : 'Open: ') + title}
        title={title}
        metadata={creationItemFormIndicators(item)}
        childBranch={expandable ? { open: expanded } : undefined}
        canSpreadPreview={assets.length > 1}
        previewBounds={metrics.bounds}
        previewStyle={{ width: metrics.width }}
        preview={(previewExpanded) =>
          creationItemPreview(assets, previewExpanded ? 'expanded' : expanded ? 'settled' : 'collapsed')
        }
        controls={
          <div data-result-library-row-control className={rowControlsClassName}>
            {!lifecycleBusy && (
              <TreeDragHandle
                label={(locale === 'zh' ? '拖动创作项：' : 'Drag creation item: ') + title}
                className={rowControlClassName}
                onDragStart={(event) => startCreationItemDrag(event, item.key)}
                onDragEnd={clearDrag}
              />
            )}
            <ActionMenuButton
              actions={actions}
              label={(locale === 'zh' ? '更多操作：' : 'More actions: ') + title}
              className={cn(rowControlClassName, 'size-6')}
            />
          </div>
        }
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
            label={locale === 'zh' ? '收起创作形式' : 'Collapse creation forms'}
            onCollapse={() => itemExpansion.collapse(branchId)}
          />
        )}
        {expandable && (
          <TreeBranchContent>
            <TreeBranchCollapseProvider onCollapse={() => itemExpansion.collapse(branchId)}>
              {forms.map((form, index) => renderChildForm(form, getTreeBranchItemTopology(index, forms.length)))}
            </TreeBranchCollapseProvider>
          </TreeBranchContent>
        )}
      </Collapsible>
    );
  }

  function albumActions(album: AlbumDto, expanded: boolean, expandable: boolean): ActionMenuAction[] {
    const actions: ActionMenuAction[] = [
      {
        id: 'open-album',
        label: locale === 'zh' ? '打开' : 'Open',
        icon: GalleryVerticalEndIcon,
        onSelect: () => onSelectAlbum(album.id),
      },
    ];
    if (expandable) {
      actions.push(
        createTreeBranchExpansionAction({
          expanded,
          expandLabel: locale === 'zh' ? '展开图集' : 'Expand album',
          collapseLabel: locale === 'zh' ? '收起图集' : 'Collapse album',
          onExpandedChange: (open) => albumExpansion.setPersistent('album:' + album.id, open),
        }),
      );
    }
    actions.push(
      {
        id: 'new-creation',
        label: locale === 'zh' ? '新建创作' : 'New creation',
        icon: PlusIcon,
        disabled: lifecycleBusy,
        onSelect: () => onNewInAlbum(album.id),
      },
      {
        id: 'new-album',
        label: locale === 'zh' ? '新建子图集' : 'New subalbum',
        icon: GalleryVerticalEndIcon,
        disabled: lifecycleBusy,
        onSelect: () => onCreateAlbum(album),
      },
      {
        id: 'rename-album',
        label: locale === 'zh' ? '重命名…' : 'Rename…',
        icon: PencilIcon,
        disabled: lifecycleBusy,
        onSelect: () => onRenameAlbum(album),
      },
      {
        id: 'pin-album',
        label: album.pinned ? (locale === 'zh' ? '取消置顶' : 'Unpin') : locale === 'zh' ? '置顶' : 'Pin',
        icon: album.pinned ? PinOffIcon : PinIcon,
        disabled: lifecycleBusy,
        onSelect: () => onToggleAlbumPin(album),
      },
      {
        id: 'move-album',
        label: locale === 'zh' ? '移动…' : 'Move…',
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
        label: locale === 'zh' ? '归档' : 'Archive',
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
        label: locale === 'zh' ? '删除' : 'Delete',
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
      if (entry.kind === 'ALBUM' && selectedAlbumPathSet.has(entry.album.id)) {
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
    const hiddenChildren = children.slice(childVisibility.visibleCount);
    const showChildDisclosure = childVisibility.disclosure !== null;
    const renderedChildCount = visibleChildren.length + Number(showChildDisclosure);
    const childDisclosureTopology = showChildDisclosure
      ? getTreeBranchItemTopology(visibleChildren.length, renderedChildCount)
      : undefined;
    const expanded = albumExpansion.isOpen(branchId);
    const expandable = children.length > 0 || (includeDocuments && album.creationItemCount > 0);
    const selected = selectedAlbumId === album.id;
    const actions = albumActions(album, expanded, expandable);
    const previewAssets = creationAlbumPreviewAssets(album, filter);
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
          'group relative flex h-[4.25rem] min-w-0 cursor-pointer items-center gap-1 rounded-lg px-1 transition-colors hover:bg-hover',
          selected &&
            'text-selected-foreground before:pointer-events-none before:absolute before:inset-y-0.5 before:left-3 before:right-0 before:rounded-xl before:bg-selected hover:bg-transparent',
          dropAlbumId === album.id && 'bg-accent ring-1 ring-inset ring-ring',
        )}
        onDragEnter={(event) => {
          if (
            event.dataTransfer.types.includes('Files') ||
            event.dataTransfer.types.includes(CREATION_ITEM_DRAG_TYPE) ||
            event.dataTransfer.types.includes(ALBUM_DRAG_TYPE)
          ) {
            event.preventDefault();
            event.stopPropagation();
            setDropAlbumId(album.id);
          }
        }}
        onDragOver={(event) => {
          if (
            event.dataTransfer.types.includes('Files') ||
            event.dataTransfer.types.includes(CREATION_ITEM_DRAG_TYPE) ||
            event.dataTransfer.types.includes(ALBUM_DRAG_TYPE)
          ) {
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = event.dataTransfer.types.includes('Files') ? 'copy' : 'move';
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropAlbumId(null);
        }}
        onDrop={(event) => void dropIntoAlbum(event, album.id)}
      >
        <Button
          type="button"
          variant="ghost"
          aria-label={(locale === 'zh' ? '打开：' : 'Open: ') + album.title}
          aria-current={selected ? 'page' : undefined}
          className="absolute inset-0 z-0 size-auto rounded-lg p-0 hover:bg-transparent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={click}
          onDoubleClick={doubleClick}
        />
        <AlbumTreePreview
          assets={previewAssets}
          title={album.title}
          open={expanded}
          expandable={expandable}
          expandLabel={
            expanded ? (locale === 'zh' ? '收起图集' : 'Collapse album') : locale === 'zh' ? '展开图集' : 'Expand album'
          }
          overlayStyle="solid"
          disclosureInteractive={false}
          branchTopology={topology}
          onGestureExpand={() => albumExpansion.expandFromGesture(branchId)}
          onPointerTrackStart={(clientY) => albumExpansion.beginPointerTrack(branchId, clientY)}
          onPointerTrack={(clientY) => albumExpansion.trackPointer(branchId, clientY)}
          onClick={click}
          onDoubleClick={doubleClick}
        />
        <span className="pointer-events-none relative z-10 min-w-0 flex-1 px-1 text-left">
          <strong className="line-clamp-2 break-words text-base font-medium leading-5" title={album.title}>
            {album.title}
          </strong>
        </span>
        {album.pinned && <PinIcon className="pointer-events-none relative z-10 size-3.5 text-muted-foreground" />}
        <div data-result-library-row-control className={rowControlsClassName}>
          {!lifecycleBusy && (
            <TreeDragHandle
              label={(locale === 'zh' ? '拖动图集：' : 'Drag album: ') + album.title}
              className={rowControlClassName}
              onDragStart={(event) => startAlbumDrag(event, album.id)}
              onDragEnd={clearDrag}
            />
          )}
          <ActionMenuButton
            actions={actions}
            label={(locale === 'zh' ? '更多操作：' : 'More actions: ') + album.title}
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
            label={locale === 'zh' ? '收起图集' : 'Collapse album'}
            onCollapse={() => albumExpansion.collapse(branchId)}
          />
        )}
        <CreationLibraryChildList
          branchTopology={childDisclosureTopology}
          collapseLabel={locale === 'zh' ? '收起图集' : 'Collapse album'}
          hasVisibleChildren={visibleChildren.length > 0}
          label={
            childVisibility.disclosure === 'fewer' ? libraryLabels.showFewerChildren : libraryLabels.showMoreChildren
          }
          loading={false}
          previewAssets={childVisibility.disclosure === 'more' ? albumChildDisclosureAssets(hiddenChildren) : []}
          resetLabel={childVisibility.canReset ? libraryLabels.restoreDefaultVisibleItems : undefined}
          showDisclosure={showChildDisclosure}
          onCollapse={() => albumExpansion.collapse(branchId)}
          onReveal={() => {
            if (childVisibility.disclosure === 'fewer') albumChildVisibility.reset(album.id);
            else albumChildVisibility.revealMore(album.id, childVisibilityEntries, childVisibility.visibleCount);
          }}
          onReset={() => albumChildVisibility.reset(album.id)}
        >
          {visibleChildren.map((entry, index) => {
            const childTopology = getTreeBranchItemTopology(index, renderedChildCount);
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

  function compactEntry(entry: RootEntry) {
    if (entry.kind === 'ALBUM') {
      const assets = creationAlbumPreviewAssets(entry.album, filter);
      return (
        <ContextMenu key={'compact-album:' + entry.album.id}>
          <ContextMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="relative size-16 shrink-0 overflow-visible rounded-xl p-0"
              title={entry.album.title}
              aria-label={entry.album.title}
              aria-current={selectedAlbumId === entry.album.id ? 'page' : undefined}
              onClick={() => onSelectAlbum(entry.album.id)}
            >
              <MediaStackPreview
                className="pointer-events-none"
                size="rail"
                items={assets.map((asset) => ({ asset }))}
                maxItems={3}
              />
            </Button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ActionContextMenuItems
              actions={albumActions(
                entry.album,
                albumExpansion.isOpen('album:' + entry.album.id),
                albumChildren(entry.album).length > 0,
              )}
            />
          </ContextMenuContent>
        </ContextMenu>
      );
    }
    const defaultForm = entry.item.defaultForm;
    if (!defaultForm) return null;
    const forms = visibleItemForms(entry.item);
    const openTarget = defaultForm;
    const assets = creationItemAssets(entry.item);
    const title = itemLifecycleTitle(entry.item, locale);
    const actions = itemActions(entry.item, openTarget, itemExpansion.isOpen('item:' + entry.item.key), forms.length);
    return (
      <ContextMenu key={'compact-item:' + entry.item.key}>
        <ContextMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="relative size-16 shrink-0 overflow-visible rounded-xl p-0"
            title={title}
            aria-label={title}
            aria-current={selectedItemId === entry.item.key ? 'page' : undefined}
            onClick={() => openForm(openTarget)}
          >
            {assets.length > 0 ? (
              <MediaStackPreview
                className="pointer-events-none"
                size="rail"
                items={assets.map((asset) => ({ asset }))}
                maxItems={3}
              />
            ) : (
              <Layers3Icon className="size-5 text-muted-foreground" />
            )}
          </Button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ActionContextMenuItems actions={actions} />
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  const resizeHandle = showModeToggle ? (
    <CreatorPaneResizeHandle
      edge="right"
      label={libraryLabels.resize}
      value={resizeValue}
      min={resizeMin}
      max={resizeMax}
      disabled={!canExpand}
      onValueChange={onResizeValueChange}
      onPointerDown={onResizeStart}
    />
  ) : null;
  const moveDialog = (
    <AlbumMoveDialog
      albums={data.albums}
      target={moveTarget}
      labels={{
        title: locale === 'zh' ? '移动到图集' : 'Move to album',
        topLevel: locale === 'zh' ? '顶层' : 'Top level',
        operationFailed: albumLabels.operationFailed,
      }}
      busy={lifecycleBusy}
      onOpenChange={(open) => {
        if (!open) setMoveTarget(null);
      }}
      onMove={moveTargetTo}
    />
  );

  if (mode === 'images') {
    return (
      <aside
        aria-label={libraryLabels.library}
        className="relative flex size-full min-h-0 flex-col border-r bg-surface-sunken"
      >
        {resizeHandle}
        <header className="grid h-14 shrink-0 place-items-center border-b border-border/60">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-action="new-creation"
            disabled={lifecycleBusy}
            title={libraryLabels.newCreation}
            aria-label={libraryLabels.newCreation}
            onClick={startNewCreationInContext}
          >
            <PlusIcon className="size-4" />
          </Button>
        </header>
        <ScrollArea type="always" className="min-h-0 flex-1">
          <div className="flex flex-col items-center gap-2 px-2 py-3 pb-14">{roots.map(compactEntry)}</div>
        </ScrollArea>
        {showModeToggle && (
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="absolute bottom-2 left-1/2 z-20 -translate-x-1/2 shadow-overlay"
            title={libraryLabels.full}
            aria-label={libraryLabels.full}
            disabled={!canExpand}
            onClick={() => onModeChange('full')}
          >
            <PanelLeftOpenIcon className="size-4" />
          </Button>
        )}
        {moveDialog}
      </aside>
    );
  }

  return (
    <aside
      aria-label={libraryLabels.library}
      className="relative flex min-h-0 min-w-0 flex-col border-r bg-surface-sunken"
    >
      {resizeHandle}
      <header className="flex h-14 shrink-0 items-center justify-between gap-1 border-b border-border/60 px-3">
        <h1 className="truncate text-lg font-semibold tracking-tight">{libraryLabels.library}</h1>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={lifecycleBusy}
            title={creatorAlbumLabels.newAlbum}
            aria-label={creatorAlbumLabels.newAlbum}
            onClick={() => onCreateAlbum(null)}
          >
            <GalleryVerticalEndIcon className="size-4" />
          </Button>
          <Button
            type="button"
            data-action="new-creation"
            variant={surface === 'new-creation' ? 'secondary' : 'outline'}
            size="icon-sm"
            disabled={lifecycleBusy}
            title={libraryLabels.newCreation}
            aria-label={libraryLabels.newCreation}
            onClick={startNewCreationInContext}
          >
            <PlusIcon className="size-4" />
          </Button>
        </div>
      </header>
      <CreationLibraryToolbar query={query} filter={filter} onQueryChange={setQuery} onFilterChange={onFilterChange} />
      <ScrollArea
        type="always"
        className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:min-h-full"
        viewportRef={viewportRef}
      >
        <div
          data-result-library-root
          data-rendered-root-count={roots.length}
          className="min-h-full space-y-0.5 px-2 py-2 pb-14"
          onDragOver={(event) => {
            if (!lifecycleBusy && hasTreeDrag(event)) {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }
          }}
          onDrop={(event) => {
            if (!lifecycleBusy && hasTreeDrag(event)) void dropAtRoot(event);
          }}
        >
          {roots.map((entry) => (entry.kind === 'ALBUM' ? renderAlbum(entry.album) : renderCreationItem(entry.item)))}
          {roots.length === 0 && (
            <QuietEmpty
              title={queryKey ? libraryLabels.emptyFiltered : libraryLabels.empty}
              actionLabel={surface === 'new-creation' ? creatorAlbumLabels.newAlbum : libraryLabels.newCreation}
              actionDisabled={lifecycleBusy}
              onAction={() => {
                if (surface === 'new-creation') onCreateAlbum(null);
                else startNewCreationInContext();
              }}
            />
          )}
        </div>
      </ScrollArea>
      {showModeToggle && (
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          className="absolute bottom-2 left-2 z-20 shadow-overlay"
          title={libraryLabels.imagesOnly}
          aria-label={libraryLabels.imagesOnly}
          onClick={() => onModeChange('images')}
        >
          <PanelLeftCloseIcon className="size-4" />
        </Button>
      )}
      {moveDialog}
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
