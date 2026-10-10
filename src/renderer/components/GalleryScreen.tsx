import type { MaterialAlbumMembershipApplyInput } from '@/shared/contracts/material-album-membership';
import { copyCreationTarget } from '@/renderer/components/albums/copyCreationTarget';
import { BookOpenIcon, LoaderCircleIcon } from 'lucide-react';
import {
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from 'react';
import type {
  AssetFileRevealContext,
  CreationItemDto,
  CreationRelationFilter,
  FacetDefinitionDto,
  FavoriteTextMaterialDto,
  ExternalMaterialMetadataDto,
  GalleryItemDto,
  GalleryMaterialDto,
  GalleryPageDto,
  GallerySourceFilter,
  ImageRatingDimension,
  IntakeCommitResult,
  MaterialAlbumDto,
  MaterialSelectionTargetInput,
  ContentLifecycleTarget,
  NewExternalCreationImportResult,
  PromptSeriesDto,
  TermListItem,
} from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { Button } from '@/renderer/components/ui/button';
import {
  MaterialLibraryNavigation,
  type MaterialLibraryCategory,
} from '@/renderer/components/gallery/MaterialLibraryNavigation';
import { MaterialAlbumHeader } from '@/renderer/components/gallery/MaterialAlbumHeader';
import { MaterialAlbumMoveProvider } from '@/renderer/components/gallery/MaterialAlbumMoveProvider';
import { WorkspaceDetailLoadingBoundary } from '@/renderer/components/app/WorkspaceDetailLoadingBoundary';
import { MaterialLibraryContent } from '@/renderer/components/gallery/MaterialLibraryContent';
import {
  MaterialLibraryToolbar,
  type MaterialSourceFilter,
} from '@/renderer/components/gallery/MaterialLibraryToolbar';
import { MaterialBatchToolbar } from '@/renderer/components/gallery/MaterialBatchToolbar';
import {
  loadGalleryPreferences,
  saveGalleryPreferences,
  type GalleryPreferences,
} from '@/renderer/components/gallery/galleryPreferences';
import {
  mediaMaterial,
  materialTitle,
  textMaterial,
  type MaterialLibraryItem,
  type SelectionModifiers,
} from '@/renderer/components/gallery/materialLibraryTypes';
import {
  buildMaterialAlbumBrowseIndex,
  materialAlbumAncestors,
} from '@/renderer/components/gallery/materialAlbumBrowse';
import { materialLibraryNavigationLabels } from '@/renderer/components/gallery/materialLibraryNavigationLabels';
import { buildMaterialAlbumTree, canMoveMaterialAlbumTo } from '@/renderer/components/gallery/materialAlbumTree';
import { useCreationCollectionBrowse } from '@/renderer/components/gallery/useCreationCollectionBrowse';
import { useMaterialAlbumDirectory } from '@/renderer/components/gallery/useMaterialAlbumDirectory';
import { useGalleryViewport } from '@/renderer/components/gallery/useGalleryViewport';
import type { GalleryBrowseState } from '@/shared/contracts/workspace-layout';
import { nextGallerySelection } from '@/renderer/components/gallery/gallerySelection';
import {
  startNativeAssetFilesDrag,
  writeMaterialsDrag,
  type CreationTreeDrag,
} from '@/renderer/components/albums/albumDrag';
import {
  useContentLifecycleActions,
  type ContentLifecycleActionRequest,
} from '@/renderer/components/albums/useContentLifecycleActions';
import { GalleryIntakeAdapter, type GalleryIntakeAdapterHandle } from '@/renderer/features/intake/GalleryIntakeAdapter';
import {
  navigationLocationKey,
  type GalleryCollection,
  type GalleryDictionaryCollection,
  type GalleryLocation,
  type HistoryNavigationGuard,
  type NavigationMode,
} from '@/renderer/components/app/app-navigation';
import { OTHER_DOMAIN, OTHER_TYPE } from '@/renderer/components/dictionary/dictionary-navigation';
import { buildDictionaryMaterialTree } from '@/renderer/components/gallery/dictionaryMaterialTree';

const MaterialDetailPage = lazy(() =>
  import('@/renderer/components/gallery/MaterialInspector').then((module) => ({ default: module.MaterialDetailPage })),
);

interface Props {
  spaceId: string;
  libraryKey: string;
  dataRevision: number;
  active: boolean;
  location: GalleryLocation;
  onNavigate(location: GalleryLocation, mode?: NavigationMode): void;
  onHistoryNavigationGuardChange(guard: HistoryNavigationGuard | null): void;
  onOpenResult(seriesId: string, assetId: string, versionId?: string): void;
  onOpenTerm(termId: string): void;
  onIntakeCommitted(result: IntakeCommitResult): void | Promise<void>;
  onActiveAlbumChange(albumId: string | null): void;
  refresh(): Promise<void>;
  notify(message: string): void;
  terms: TermListItem[];
  facets: FacetDefinitionDto[];
  series: PromptSeriesDto[];
  creationItems: CreationItemDto[];
}

const pageSize = 24;
const emptyPage: GalleryPageDto = { items: [], total: 0, nextCursor: null };
const galleryCacheLimit = 12;
const galleryCacheItemLimit = pageSize * 12;
const galleryCachePerQueryItemLimit = pageSize * 4;

function sourceForCollection(collection: GalleryCollection): MaterialSourceFilter {
  if (collection.kind === 'creation') return 'CREATION';
  if (collection.kind === 'import') return 'IMPORT';
  return 'ALL';
}

function categoryForCollection(collection: GalleryCollection): MaterialLibraryCategory {
  if (collection.kind === 'dictionary') return 'DICTIONARY';
  return 'MATERIAL';
}

function contentLifecycleTargetForMaterial(item: MaterialLibraryItem): ContentLifecycleTarget {
  if (item.kind === 'TEXT') return { entityType: 'MATERIAL', entityId: item.text.id };
  return item.image.materialId
    ? { entityType: 'MATERIAL', entityId: item.image.materialId }
    : { entityType: 'IMAGE_ASSET', entityId: item.image.asset.id };
}

interface GallerySnapshot {
  items: GalleryItemDto[];
  favoriteTexts: FavoriteTextMaterialDto[];
  total: number;
  nextCursor: string | null;
}

function rememberGallerySnapshot(cache: Map<string, GallerySnapshot>, key: string, snapshot: GallerySnapshot) {
  cache.delete(key);
  if (snapshot.items.length + snapshot.favoriteTexts.length > galleryCachePerQueryItemLimit) return;
  cache.set(key, snapshot);
  const cachedItemCount = () =>
    [...cache.values()].reduce(
      (total, candidate) => total + candidate.items.length + candidate.favoriteTexts.length,
      0,
    );
  while (cache.size > galleryCacheLimit || cachedItemCount() > galleryCacheItemLimit) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

export function GalleryScreen({
  spaceId,
  libraryKey,
  dataRevision,
  active,
  location,
  onNavigate,
  onHistoryNavigationGuardChange,
  onOpenResult,
  onOpenTerm,
  onIntakeCommitted,
  onActiveAlbumChange,
  refresh,
  notify,
  terms,
  facets = [],
  series,
  creationItems,
}: Props) {
  const { locale, messages } = useI18n();
  const l = messages.gallery.screen;
  const locationKey = navigationLocationKey(location);
  const requestedTargetKey = location.requestedAssetId
    ? `asset:${location.requestedAssetId}`
    : location.requestedMaterialId
      ? `material:${location.requestedMaterialId}`
      : null;
  const appliedLocationKeyRef = useRef(locationKey);
  const navigationPending = appliedLocationKeyRef.current !== locationKey;
  const requestId = useRef(0);
  const loadingRef = useRef(false);
  const pendingGalleryQueryKey = useRef<string | null>(null);
  const intakeRef = useRef<GalleryIntakeAdapterHandle | null>(null);
  const galleryCacheRef = useRef<Map<string, GallerySnapshot>>(new Map());
  const displayedLibraryKeyRef = useRef(libraryKey);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pageEndRef = useRef<HTMLDivElement | null>(null);
  const [preferences, setPreferences] = useState<GalleryPreferences>(() => ({
    ...loadGalleryPreferences(),
    ...location.browse,
  }));
  const { scope, contentTypes, unratedDimensions } = preferences;
  const [query, setQuery] = useState(location.browse?.query ?? '');
  const [navigationToggleHost, setNavigationToggleHost] = useState<HTMLDivElement | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState(() => location.browse?.query.trim() ?? '');
  const viewportSnapshotRef = useRef(location.browse?.viewport);
  const [viewportRestoreRevision, setViewportRestoreRevision] = useState(0);
  const [items, setItems] = useState<GalleryItemDto[]>([]);
  const [favoriteTexts, setFavoriteTexts] = useState<FavoriteTextMaterialDto[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [busyAssets, setBusyAssets] = useState<Set<string>>(() => new Set());
  const [busyFavoriteMaterialId, setBusyFavoriteMaterialId] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(location.selectedMaterialKey);
  const [requestedRevision, setRequestedRevision] = useState(0);
  const [requestedMaterial, setRequestedMaterial] = useState<{
    libraryKey: string;
    targetKey: string;
    item: MaterialLibraryItem;
  } | null>(null);
  const [checkedKeys, setCheckedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [collectBusy, setCollectBusy] = useState(false);
  const rangeAnchorKey = useRef<string | null>(null);
  const [category, setCategory] = useState<MaterialLibraryCategory>(() => categoryForCollection(location.collection));
  const [sourceFilter, setSourceFilter] = useState<MaterialSourceFilter>(() =>
    location.collection.kind === 'album'
      ? (location.browse?.source ?? 'ALL')
      : sourceForCollection(location.collection),
  );
  const [activeAlbumId, setActiveAlbumId] = useState<string | null>(
    location.collection.kind === 'album' ? location.collection.albumId : null,
  );
  const [creationRelation, setCreationRelation] = useState<CreationRelationFilter>(
    location.collection.kind === 'album' ? (location.collection.creationRelation ?? 'ALL') : 'ALL',
  );
  const [dictionarySelection, setDictionarySelection] = useState<GalleryDictionaryCollection | null>(
    location.collection.kind === 'dictionary' ? location.collection : null,
  );
  const dictionaryActive = dictionarySelection !== null;
  const [albumRetryKey, setAlbumRetryKey] = useState(0);
  const {
    albums,
    loading: albumsLoading,
    loaded: albumsLoaded,
    error: albumError,
    read: readAlbumDirectory,
    reload: reloadAlbums,
    applyMembership: applyMembershipPatch,
  } = useMaterialAlbumDirectory({ active, libraryKey, dataRevision, locale, retryKey: albumRetryKey });
  const [albumMutationBusy, setAlbumMutationBusy] = useState(false);

  const [displayedQueryKey, setDisplayedQueryKey] = useState('');

  useEffect(
    () => () => {
      requestId.current += 1;
      pendingGalleryQueryKey.current = null;
      loadingRef.current = false;
    },
    [],
  );

  const activeAlbum = useMemo(
    () => albums.find((album) => album.id === activeAlbumId) ?? null,
    [activeAlbumId, albums],
  );
  const favoriteOnly = dictionarySelection?.scope === 'FAVORITE' || (!dictionarySelection && scope === 'FAVORITE');
  const {
    scopeActive: creationScopeActive,
    browseActive: creationBrowseActive,
    collections: creationCollections,
    rootCollections: creationRootCollections,
    path: activeCreationPath,
  } = useCreationCollectionBrowse({
    albums,
    activeAlbum,
    favoriteOnly,
    query: debouncedQuery,
    relation: creationRelation,
    unratedActive: unratedDimensions.length > 0,
  });
  const writableAlbums = useMemo(() => albums.filter((album) => album.kind === 'USER'), [albums]);
  const creationAlbumViews = useMemo(
    () => albums.filter((album) => album.systemKey?.startsWith('CREATION_')),
    [albums],
  );
  const creationAlbumTree = useMemo(() => buildMaterialAlbumTree(creationAlbumViews), [creationAlbumViews]);
  const materialAlbumBrowse = useMemo(() => buildMaterialAlbumBrowseIndex(writableAlbums), [writableAlbums]);
  const activeDirectMaterialIds = useMemo(
    () => new Set(activeAlbum?.kind === 'USER' ? activeAlbum.members.map((member) => member.materialId) : []),
    [activeAlbum],
  );
  const uncategorizedLabel = messages.dictionary.wordPalette.uncategorized;
  const dictionaryTree = useMemo(
    () => buildDictionaryMaterialTree(terms, facets, uncategorizedLabel, locale),
    [facets, locale, terms, uncategorizedLabel],
  );
  const dictionaryPathLabels = useMemo(() => {
    if (!dictionarySelection) return [] as string[];
    const domainFacet = facets.find((facet) => facet.systemRole === 'PRIMARY_CLASSIFICATION');
    const typeFacet = facets.find((facet) => facet.systemRole === 'SECONDARY_CLASSIFICATION');
    const labels = [messages.gallery.library.relationshipDictionary];
    if (dictionarySelection.domainId) {
      labels.push(
        dictionarySelection.domainId === OTHER_DOMAIN
          ? uncategorizedLabel
          : (domainFacet?.values.find((value) => value.id === dictionarySelection.domainId)?.name ??
              uncategorizedLabel),
      );
    }
    if (dictionarySelection.typeId) {
      labels.push(
        dictionarySelection.typeId === OTHER_TYPE
          ? uncategorizedLabel
          : (typeFacet?.values.find((value) => value.id === dictionarySelection.typeId)?.name ?? uncategorizedLabel),
      );
    }
    if (dictionarySelection.termId) {
      const term = terms.find((candidate) => candidate.id === dictionarySelection.termId);
      if (term) labels.push(term.title);
    }
    return labels;
  }, [dictionarySelection, facets, messages.gallery.library.relationshipDictionary, terms, uncategorizedLabel]);

  function currentBrowseState(): GalleryBrowseState {
    return {
      query,
      scope,
      contentTypes,
      unratedDimensions,
      source: sourceFilter,
      viewport: {
        top: viewportSnapshotRef.current?.top ?? viewportRef.current?.scrollTop ?? 0,
        imageCount: items.length,
      },
    };
  }

  function resetBrowseViewport() {
    viewportSnapshotRef.current = undefined;
    setViewportRestoreRevision((current) => current + 1);
  }

  function commitGalleryLocation(nextLocation: GalleryLocation, mode: NavigationMode = 'push') {
    const next = { ...nextLocation, browse: nextLocation.browse ?? currentBrowseState() };
    appliedLocationKeyRef.current = navigationLocationKey(next);
    onNavigate(next, mode);
  }

  function currentCollection(): GalleryCollection {
    if (activeAlbumId) {
      return {
        kind: 'album',
        albumId: activeAlbumId,
        ...(creationScopeActive ? { creationRelation } : {}),
      };
    }
    if (dictionarySelection) return dictionarySelection;
    if (sourceFilter === 'CREATION') return { kind: 'creation' };
    if (sourceFilter === 'IMPORT') return { kind: 'import' };
    return { kind: 'all' };
  }

  function closeMaterialInspector() {
    setSelectedKey(null);
    commitGalleryLocation(
      {
        collection: currentCollection(),
        selectedMaterialKey: null,
        requestedMaterialId: null,
      },
      'replace',
    );
  }

  function navigateCollection(collection: GalleryCollection, mode: NavigationMode = 'push') {
    resetBrowseViewport();
    changeSelectionMode(false);
    setSelectedKey(null);
    setActiveAlbumId(collection.kind === 'album' ? collection.albumId : null);
    setCreationRelation(collection.kind === 'album' ? (collection.creationRelation ?? 'ALL') : 'ALL');
    setDictionarySelection(collection.kind === 'dictionary' ? collection : null);
    setSourceFilter(sourceForCollection(collection));
    setCategory(categoryForCollection(collection));
    commitGalleryLocation(
      {
        collection,
        selectedMaterialKey: null,
        requestedMaterialId: null,
        browse: { ...currentBrowseState(), source: sourceForCollection(collection), viewport: undefined },
      },
      mode,
    );
  }

  useEffect(() => {
    if (active) {
      onActiveAlbumChange(activeAlbum?.systemKey === 'CREATION_GROUP' ? activeAlbum.sourceAlbumId : null);
    }
  }, [active, activeAlbum, onActiveAlbumChange]);

  useLayoutEffect(() => {
    if (!active || appliedLocationKeyRef.current === locationKey) return;
    appliedLocationKeyRef.current = locationKey;
    setSelectionMode(false);
    setCheckedKeys(new Set());
    rangeAnchorKey.current = null;
    setPreferences({ ...loadGalleryPreferences(), ...location.browse });
    setQuery(location.browse?.query ?? '');
    setDebouncedQuery(location.browse?.query.trim() ?? '');
    viewportSnapshotRef.current = location.browse?.viewport;
    setViewportRestoreRevision((current) => current + 1);
    setActiveAlbumId(location.collection.kind === 'album' ? location.collection.albumId : null);
    setCreationRelation(location.collection.kind === 'album' ? (location.collection.creationRelation ?? 'ALL') : 'ALL');
    setDictionarySelection(location.collection.kind === 'dictionary' ? location.collection : null);
    setSourceFilter(
      location.collection.kind === 'album'
        ? (location.browse?.source ?? 'ALL')
        : sourceForCollection(location.collection),
    );
    setCategory(categoryForCollection(location.collection));
    setSelectedKey(location.selectedMaterialKey);
  }, [active, locationKey]);

  const imageOnly = dictionaryActive || creationScopeActive || sourceFilter !== 'ALL';
  const effectiveContentTypes = imageOnly ? ['IMAGE' as const] : contentTypes;
  const imageEnabled = effectiveContentTypes.includes('IMAGE');
  const textEnabled = !imageOnly && contentTypes.includes('TEXT') && unratedDimensions.length === 0;
  const dictionaryFilter = useMemo(() => {
    if (!dictionarySelection) return undefined;
    const facetValueIds: string[] = [];
    const missingFacetSystemRoles: Array<'PRIMARY_CLASSIFICATION' | 'SECONDARY_CLASSIFICATION'> = [];
    if (dictionarySelection.domainId === OTHER_DOMAIN) missingFacetSystemRoles.push('PRIMARY_CLASSIFICATION');
    else if (dictionarySelection.domainId) facetValueIds.push(dictionarySelection.domainId);
    if (dictionarySelection.typeId === OTHER_TYPE) missingFacetSystemRoles.push('SECONDARY_CLASSIFICATION');
    else if (dictionarySelection.typeId) facetValueIds.push(dictionarySelection.typeId);
    if (!facetValueIds.length && !missingFacetSystemRoles.length && !dictionarySelection.termId) return undefined;
    return {
      facetValueIds,
      missingFacetSystemRoles,
      termId: dictionarySelection.termId,
    };
  }, [dictionarySelection]);
  const backendSource: GallerySourceFilter = dictionarySelection
    ? 'DICTIONARY'
    : sourceFilter === 'ALL'
      ? 'LIBRARY'
      : sourceFilter;
  const defaultContentTypeFilter =
    contentTypes.length === 2 && contentTypes.includes('IMAGE') && contentTypes.includes('TEXT');
  const structuralBrowseActive =
    !favoriteOnly &&
    !debouncedQuery &&
    sourceFilter === 'ALL' &&
    !dictionaryActive &&
    !creationScopeActive &&
    defaultContentTypeFilter &&
    unratedDimensions.length === 0;
  const overviewBrowseActive = structuralBrowseActive && !activeAlbumId;
  const albumBrowseActive = structuralBrowseActive && activeAlbum?.kind === 'USER';
  const galleryPlacement = overviewBrowseActive ? ('UNORGANIZED' as const) : undefined;
  const galleryAlbumScope = albumBrowseActive ? ('DIRECT' as const) : undefined;
  const rootAlbumSummaries = useMemo(
    () =>
      materialAlbumBrowse.tree.roots.flatMap((album) => {
        const summary = materialAlbumBrowse.summaryById.get(album.id);
        return summary ? [summary] : [];
      }),
    [materialAlbumBrowse],
  );
  const activeChildAlbumSummaries = useMemo(
    () =>
      activeAlbum?.kind === 'USER'
        ? (materialAlbumBrowse.tree.childrenByParentId.get(activeAlbum.id) ?? []).flatMap((album) => {
            const summary = materialAlbumBrowse.summaryById.get(album.id);
            return summary ? [summary] : [];
          })
        : [],
    [activeAlbum, materialAlbumBrowse],
  );
  const activeAlbumSummary =
    activeAlbum?.kind === 'USER' ? (materialAlbumBrowse.summaryById.get(activeAlbum.id) ?? null) : null;
  const activeAlbumAncestors = useMemo(
    () => (activeAlbum?.kind === 'USER' ? materialAlbumAncestors(activeAlbum.id, materialAlbumBrowse.tree) : []),
    [activeAlbum, materialAlbumBrowse],
  );
  const browseAlbumSummaries = overviewBrowseActive
    ? rootAlbumSummaries
    : albumBrowseActive
      ? activeChildAlbumSummaries
      : [];
  const overviewCreationCollections = overviewBrowseActive ? creationRootCollections : [];
  const creationSectionTitle = overviewBrowseActive ? messages.gallery.library.relationshipCreation : null;
  const albumSectionTitle = overviewBrowseActive
    ? messages.gallery.albums.myAlbums
    : albumBrowseActive
      ? messages.gallery.albums.subAlbums
      : null;
  const materialSectionTitle = overviewBrowseActive
    ? messages.gallery.albums.unfiledMaterials
    : albumBrowseActive
      ? messages.gallery.albums.materialsHere
      : null;
  const galleryQueryKey = useMemo(
    () =>
      JSON.stringify({
        libraryKey,
        dataRevision,
        locale,
        albumId: activeAlbumId,
        albumScope: galleryAlbumScope,
        placement: galleryPlacement,
        creationRelation: creationScopeActive ? creationRelation : undefined,
        dictionary: dictionaryFilter,
        favoriteOnly,
        source: backendSource,
        query: debouncedQuery,
        unratedDimensions: [...unratedDimensions].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
        imageEnabled,
        textEnabled,
        retryKey,
      }),
    [
      activeAlbumId,
      backendSource,
      creationRelation,
      creationScopeActive,
      dataRevision,
      debouncedQuery,
      dictionaryFilter,
      favoriteOnly,
      galleryAlbumScope,
      galleryPlacement,
      imageEnabled,
      libraryKey,
      locale,
      retryKey,
      textEnabled,
      unratedDimensions,
    ],
  );

  /**
   * Plain click opens the inspector and drops any batch. Ctrl/Cmd toggles one
   * item; Shift extends from the last anchor so a run can be swept in one go.
   */
  function selectMaterial(
    target: MaterialLibraryItem,
    modifiers?: SelectionModifiers,
    navigationMode: NavigationMode = 'push',
  ) {
    const effectiveModifiers =
      selectionMode && !modifiers?.range && !modifiers?.toggle ? { range: false, toggle: true } : modifiers;
    const next = nextGallerySelection(
      materials.map((item) => item.key),
      { selectedKey, checkedKeys, anchorKey: rangeAnchorKey.current },
      target.key,
      effectiveModifiers,
    );
    rangeAnchorKey.current = next.anchorKey;
    setCheckedKeys(next.checkedKeys);
    setSelectedKey(next.selectedKey);
    if (next.checkedKeys.size > 0) setSelectionMode(true);
    if (next.selectedKey && next.checkedKeys.size === 0) {
      commitGalleryLocation(
        {
          collection: currentCollection(),
          selectedMaterialKey: next.selectedKey,
          requestedMaterialId: null,
        },
        navigationMode,
      );
    }
  }

  function enterSelection(target: MaterialLibraryItem) {
    setSelectionMode(true);
    setSelectedKey(null);
    setCheckedKeys((current) => new Set(current).add(target.key));
    rangeAnchorKey.current = target.key;
  }

  function toggleSelection(target: MaterialLibraryItem) {
    setSelectionMode(true);
    selectMaterial(target, { range: false, toggle: true });
  }

  function changeSelectionMode(next: boolean) {
    setSelectionMode(next);
    setSelectedKey(null);
    if (!next) clearChecked();
  }

  function clearChecked() {
    setCheckedKeys(new Set());
    rangeAnchorKey.current = null;
  }

  function targetForMaterial(item: MaterialLibraryItem): MaterialSelectionTargetInput {
    if (item.kind === 'TEXT') return { kind: 'MATERIAL', materialId: item.text.id };
    return item.image.materialId
      ? { kind: 'MATERIAL', materialId: item.image.materialId }
      : { kind: 'IMAGE_ASSET', imageAssetId: item.image.asset.id };
  }

  function targetsForMaterials(source: readonly MaterialLibraryItem[]) {
    const targets: MaterialSelectionTargetInput[] = [];
    const seen = new Set<string>();
    for (const item of source) {
      const target = targetForMaterial(item);
      const key = target.kind === 'MATERIAL' ? `material:${target.materialId}` : `asset:${target.imageAssetId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push(target);
    }
    return targets;
  }

  function checkedTargets() {
    return targetsForMaterials(materials.filter((item) => checkedKeys.has(item.key)));
  }

  function startMaterialDrag(event: ReactDragEvent<HTMLElement>, item: MaterialLibraryItem) {
    event.stopPropagation();
    const source =
      checkedKeys.has(item.key) && checkedKeys.size > 0
        ? materials.filter((candidate) => checkedKeys.has(candidate.key))
        : [item];
    const targets = targetsForMaterials(source);
    const sourceAlbumId =
      activeAlbum?.kind === 'USER' &&
      targets.every((target) => target.kind === 'MATERIAL' && activeDirectMaterialIds.has(target.materialId))
        ? activeAlbum.id
        : undefined;
    // Native file exports permit copy/link only; owned items need a move-capable internal drag.
    if (!sourceAlbumId && !event.shiftKey && source.every((candidate) => candidate.kind === 'IMAGE')) {
      const images = source.flatMap((candidate) => (candidate.kind === 'IMAGE' ? [candidate] : []));
      const assetIds = [...new Set(images.map((candidate) => candidate.image.asset.id))];
      if (assetIds.length > 0) {
        try {
          startNativeAssetFilesDrag(event, assetIds, targetsForMaterials(images), sourceAlbumId);
        } catch (reason) {
          notify(`${messages.assetFile.failed}: ${reason instanceof Error ? reason.message : String(reason)}`);
        }
        return;
      }
    }
    writeMaterialsDrag(event.dataTransfer, targets, sourceAlbumId);
  }

  // Card rows are memoized, so the handlers they receive must keep a stable
  // identity or every list mutation re-renders the whole grid.
  const stableSelectMaterial = useStableCallback(selectMaterial);
  const stableEnterSelection = useStableCallback(enterSelection);
  const stableToggleSelection = useStableCallback(toggleSelection);
  const stableStartMaterialDrag = useStableCallback(startMaterialDrag);
  const stableNotify = useStableCallback(notify);
  const stableCopyText = useStableCallback((text: string) => void copyText(text));
  const archiveMaterial = useStableCallback((item: MaterialLibraryItem) => requestMaterialLifecycle('ARCHIVE', item));
  const deleteMaterial = useStableCallback((item: MaterialLibraryItem) => requestMaterialLifecycle('DELETE', item));
  const archiveAlbum = useStableCallback((album: MaterialAlbumDto) => requestAlbumLifecycle('ARCHIVE', album));
  const deleteAlbum = useStableCallback((album: MaterialAlbumDto) => requestAlbumLifecycle('DELETE', album));

  async function addCheckedToDestinations(albumIds: string[], termIds: string[]) {
    if (collectBusy || checkedKeys.size === 0) return;
    setCollectBusy(true);
    try {
      const targets = checkedTargets();
      await Promise.all([
        ...albumIds.map((albumId) => window.desktopApi.materialAlbumsAddMany({ albumId, targets, locale })),
        ...(termIds.length ? [window.desktopApi.materialsAddToDestinations({ targets, albumIds: [], termIds })] : []),
      ]);
      galleryCacheRef.current.clear();
      await reloadAlbums();
      setRetryKey((value) => value + 1);
      if (termIds.length > 0) await refresh();
      notify(messages.gallery.batch.addedToDestinations(albumIds.length + termIds.length));
    } catch (reason) {
      notify(
        `${messages.gallery.albums.operationFailed}: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
      throw reason;
    } finally {
      setCollectBusy(false);
    }
  }

  async function createAlbumAndCollect(title: string) {
    if (collectBusy || checkedKeys.size === 0) return;
    setCollectBusy(true);
    try {
      const album = await window.desktopApi.materialAlbumsCreate({ title, locale });
      await window.desktopApi.materialAlbumsAddMany({ albumId: album.id, targets: checkedTargets(), locale });
      await reloadAlbums();
      galleryCacheRef.current.clear();
      setRetryKey((value) => value + 1);
      notify(messages.gallery.batch.addedToDestinations(1));
    } catch (reason) {
      notify(
        `${messages.gallery.albums.operationFailed}: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
      throw reason;
    } finally {
      setCollectBusy(false);
    }
  }

  function updatePreferences(next: typeof preferences) {
    saveGalleryPreferences(next);
    setPreferences(next);
    changeSelectionMode(false);
    resetBrowseViewport();
    commitGalleryLocation(
      {
        collection: currentCollection(),
        selectedMaterialKey: null,
        requestedMaterialId: null,
        browse: {
          ...currentBrowseState(),
          scope: next.scope,
          contentTypes: next.contentTypes,
          unratedDimensions: next.unratedDimensions,
          viewport: undefined,
        },
      },
      'replace',
    );
  }

  function changeQuery(next: string) {
    setQuery(next);
    changeSelectionMode(false);
    resetBrowseViewport();
    commitGalleryLocation(
      {
        collection: currentCollection(),
        selectedMaterialKey: null,
        requestedMaterialId: null,
        browse: { ...currentBrowseState(), query: next, viewport: undefined },
      },
      'replace',
    );
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!active || !albumsLoaded || location.collection.kind !== 'album') return;
    const albumId = location.collection.albumId;
    if (albums.some((album) => album.id === albumId)) return;
    notify(messages.gallery.albums.unavailable);
    navigateCollection({ kind: 'all' }, 'replace');
  }, [active, albums, albumsLoaded, locationKey]);

  useEffect(() => {
    if (!active) {
      requestId.current += 1;
      pendingGalleryQueryKey.current = null;
      loadingRef.current = false;
      setLoading(false);
      return;
    }
    if (activeAlbumId && !albumsLoaded) {
      requestId.current += 1;
      pendingGalleryQueryKey.current = null;
      loadingRef.current = false;
      setLoading(albumsLoading);
      return;
    }
    if (pendingGalleryQueryKey.current === galleryQueryKey) return;
    const activeRequest = ++requestId.current;
    const cached = galleryCacheRef.current.get(galleryQueryKey);
    const replacingUncachedContent = !cached && displayedQueryKey !== galleryQueryKey;
    if (displayedLibraryKeyRef.current !== libraryKey) {
      setItems([]);
      setFavoriteTexts([]);
      setTotal(0);
      setNextCursor(null);
      setDisplayedQueryKey('');
    } else if (cached) {
      setItems(cached.items);
      setFavoriteTexts(cached.favoriteTexts);
      setTotal(cached.total);
      setNextCursor(cached.nextCursor);
      setDisplayedQueryKey(galleryQueryKey);
      pendingGalleryQueryKey.current = null;
      loadingRef.current = false;
      setLoading(false);
      setError('');
      return;
    }
    setError('');
    loadingRef.current = true;
    pendingGalleryQueryKey.current = galleryQueryKey;
    setLoading(true);

    const imageRequest =
      imageEnabled && !creationBrowseActive
        ? window.desktopApi.galleryList({
            locale,
            source: backendSource,
            favoriteOnly: favoriteOnly || undefined,
            dictionary: dictionaryFilter,
            query: debouncedQuery,
            placement: galleryPlacement,
            albumId: activeAlbumId ?? undefined,
            albumScope: galleryAlbumScope,
            creationRelation: creationScopeActive ? creationRelation : undefined,
            unratedDimensions,
            cursor: null,
            limit: pageSize,
          })
        : Promise.resolve(emptyPage);
    const textRequest = textEnabled
      ? activeAlbum?.kind === 'USER'
        ? window.desktopApi.albumsListTextMaterials(activeAlbum.id)
        : window.desktopApi.favoriteTextsList()
      : Promise.resolve([] as FavoriteTextMaterialDto[]);
    const directoryRequest =
      overviewBrowseActive && textEnabled ? readAlbumDirectory() : Promise.resolve<MaterialAlbumDto[]>([]);

    void Promise.all([imageRequest, textRequest, directoryRequest])
      .then(([page, allTexts, directory]) => {
        if (requestId.current !== activeRequest) return;
        const organizedIds = new Set(
          directory.flatMap((album) => (album.kind === 'USER' ? album.members.map((member) => member.materialId) : [])),
        );
        const texts = overviewBrowseActive
          ? allTexts.filter((item) => !organizedIds.has(item.id))
          : albumBrowseActive
            ? allTexts.filter((item) => activeDirectMaterialIds.has(item.id))
            : allTexts;
        setItems(page.items);
        setFavoriteTexts(texts);
        setTotal(page.total);
        setNextCursor(page.nextCursor);
        setDisplayedQueryKey(galleryQueryKey);
        displayedLibraryKeyRef.current = libraryKey;
        rememberGallerySnapshot(galleryCacheRef.current, galleryQueryKey, {
          items: page.items,
          favoriteTexts: texts,
          total: page.total,
          nextCursor: page.nextCursor,
        });
      })
      .catch((reason) => {
        if (requestId.current !== activeRequest) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        if (replacingUncachedContent) {
          setItems([]);
          setFavoriteTexts([]);
          setTotal(0);
          setNextCursor(null);
          setDisplayedQueryKey(galleryQueryKey);
        }
      })
      .finally(() => {
        if (requestId.current === activeRequest) {
          pendingGalleryQueryKey.current = null;
          loadingRef.current = false;
          setLoading(false);
        }
      });
  }, [
    active,
    activeAlbum,
    activeAlbumId,
    activeDirectMaterialIds,
    albumBrowseActive,
    albumsLoaded,
    albumsLoading,
    backendSource,
    creationRelation,
    creationBrowseActive,
    creationScopeActive,
    debouncedQuery,
    dictionaryFilter,
    favoriteOnly,
    galleryAlbumScope,
    galleryPlacement,
    galleryQueryKey,
    imageEnabled,
    libraryKey,
    locale,
    overviewBrowseActive,
    readAlbumDirectory,
    retryKey,
    textEnabled,
    unratedDimensions,
  ]);

  const filteredTexts = useMemo(() => {
    const needle = debouncedQuery.toLocaleLowerCase();
    if (!needle) return favoriteTexts;
    return favoriteTexts.filter((item) => item.text.toLocaleLowerCase().includes(needle));
  }, [debouncedQuery, favoriteTexts]);

  const materials = useMemo(
    () =>
      [...items.map(mediaMaterial), ...filteredTexts.map(textMaterial)].sort((left, right) => {
        const timeDifference = Date.parse(right.createdAt) - Date.parse(left.createdAt);
        return timeDifference || right.key.localeCompare(left.key);
      }),
    [filteredTexts, items],
  );
  const resultTotal = total + filteredTexts.length;
  const displayedResultTotal = creationBrowseActive ? (activeAlbum?.materialCount ?? 0) : resultTotal;

  const materialRevealContext = useMemo<AssetFileRevealContext>(() => {
    if (activeAlbum?.kind === 'USER') return { kind: 'ALBUM', albumId: activeAlbum.id };
    if (dictionarySelection?.termId) return { kind: 'TERM', termId: dictionarySelection.termId };
    return dictionaryActive ? { kind: 'DICTIONARY' } : { kind: 'ALL_MATERIALS' };
  }, [activeAlbum?.id, activeAlbum?.kind, dictionaryActive, dictionarySelection?.termId]);
  const revealContextForMaterial = useCallback(
    (item: MaterialLibraryItem): AssetFileRevealContext | undefined =>
      item.kind === 'TEXT' ? undefined : materialRevealContext,
    [materialRevealContext],
  );

  useEffect(() => {
    const visibleKeys = new Set(materials.map((item) => item.key));
    setCheckedKeys((current) => {
      if ([...current].every((key) => visibleKeys.has(key))) return current;
      return new Set([...current].filter((key) => visibleKeys.has(key)));
    });
    if (rangeAnchorKey.current && !visibleKeys.has(rangeAnchorKey.current)) rangeAnchorKey.current = null;
  }, [materials]);

  const selectedItem = useMemo(
    () =>
      requestedTargetKey
        ? requestedMaterial?.libraryKey === libraryKey && requestedMaterial.targetKey === requestedTargetKey
          ? requestedMaterial.item
          : null
        : (materials.find((item) => item.key === selectedKey) ?? null),
    [libraryKey, requestedTargetKey, materials, requestedMaterial, selectedKey],
  );
  const selectedIndex =
    selectedItem && !requestedTargetKey ? materials.findIndex((item) => item.key === selectedItem.key) : -1;
  const previousItem = selectedIndex > 0 ? materials[selectedIndex - 1] : null;
  const nextItem = selectedIndex >= 0 ? (materials[selectedIndex + 1] ?? null) : null;
  const selectedFavoriteMaterialId =
    selectedItem && selectedItem.kind !== 'TEXT'
      ? (selectedItem.image.favorite?.materialId ?? null)
      : selectedItem && !activeAlbumId && selectedItem.text.favoritedAt
        ? selectedItem.text.id
        : null;
  const selectedFavoriteBusy =
    selectedItem && selectedItem.kind !== 'TEXT'
      ? busyFavoriteMaterialId === selectedItem.image.asset.id ||
        busyFavoriteMaterialId === selectedItem.image.materialId
      : Boolean(selectedItem && busyFavoriteMaterialId === selectedItem.text.id);
  const contentLifecycleActions = useContentLifecycleActions({
    notify,
    onApplied: finishGalleryContentLifecycleAction,
  });
  const contentLifecycleBusy = albumMutationBusy || contentLifecycleActions.busy;
  const searchPending = query.trim() !== debouncedQuery;
  const showingPreviousResults = Boolean(materials.length) && displayedQueryKey !== galleryQueryKey;

  useEffect(() => {
    if (
      !active ||
      loading ||
      navigationPending ||
      error ||
      albumError ||
      (nextCursor && items.length < (viewportSnapshotRef.current?.imageCount ?? 0)) ||
      requestedTargetKey ||
      displayedQueryKey !== galleryQueryKey ||
      !selectedKey ||
      selectedItem
    )
      return;
    setSelectedKey(null);
    if (location.selectedMaterialKey === selectedKey) {
      commitGalleryLocation(
        {
          collection: currentCollection(),
          selectedMaterialKey: null,
          requestedMaterialId: null,
        },
        'replace',
      );
    }
  }, [
    active,
    displayedQueryKey,
    galleryQueryKey,
    loading,
    navigationPending,
    error,
    albumError,
    nextCursor,
    items.length,
    requestedTargetKey,
    selectedItem,
    selectedKey,
  ]);

  const requestedMaterialFailed = useStableCallback((reason?: unknown) => {
    closeMaterialInspector();
    notify(
      reason === undefined
        ? messages.desktopPetals.errors.sourceUnavailable
        : `${l.failed}: ${reason instanceof Error ? reason.message : String(reason)}`,
    );
  });

  useEffect(() => {
    const requestedMaterialId = location.requestedMaterialId;
    const requestedAssetId = location.requestedAssetId;
    if (!active || !requestedTargetKey) return;
    let current = true;
    const request: Promise<GalleryMaterialDto | null> = requestedAssetId
      ? window.desktopApi
          .assetNavigationGet(requestedAssetId, locale)
          .then((result) => (result ? { kind: 'MEDIA', media: result.material } : null))
      : window.desktopApi.galleryMaterialGet(requestedMaterialId!, locale);
    void request
      .then((result) => {
        if (!current) return;
        if (!result) {
          setRequestedMaterial(null);
          requestedMaterialFailed();
          return;
        }
        const item = result.kind === 'MEDIA' ? mediaMaterial(result.media) : textMaterial(result.text);
        setRequestedMaterial({ libraryKey, targetKey: requestedTargetKey, item });
        setSelectedKey(item.key);
      })
      .catch((reason: unknown) => {
        if (current) requestedMaterialFailed(reason);
      });
    return () => {
      current = false;
    };
  }, [
    active,
    dataRevision,
    libraryKey,
    locale,
    location.requestedMaterialId,
    location.requestedAssetId,
    requestedTargetKey,
    requestedRevision,
    requestedMaterialFailed,
  ]);

  useEffect(() => {
    if (!selectionMode) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      changeSelectionMode(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectionMode]);

  function updateMaterialMetadata(metadata: ExternalMaterialMetadataDto) {
    setItems((current) =>
      current.map((item) => (item.materialId === metadata.materialId ? { ...item, metadata } : item)),
    );
    galleryCacheRef.current.clear();
    setRequestedRevision((value) => value + 1);
  }

  const loadMore = useCallback(async () => {
    if (!active || !nextCursor || loadingRef.current || !imageEnabled) return;
    const activeRequest = requestId.current;
    loadingRef.current = true;
    setLoading(true);
    setError('');
    try {
      const page = await window.desktopApi.galleryList({
        locale,
        source: backendSource,
        favoriteOnly: favoriteOnly || undefined,
        dictionary: dictionaryFilter,
        query: debouncedQuery,
        placement: galleryPlacement,
        albumId: activeAlbumId ?? undefined,
        albumScope: galleryAlbumScope,
        creationRelation: creationScopeActive ? creationRelation : undefined,
        unratedDimensions,
        cursor: nextCursor,
        knownTotal: total,
        limit: pageSize,
      });
      if (requestId.current !== activeRequest) return;
      setItems((current) => {
        const nextItems = [...current, ...page.items];
        rememberGallerySnapshot(galleryCacheRef.current, galleryQueryKey, {
          items: nextItems,
          favoriteTexts,
          total,
          nextCursor: page.nextCursor,
        });
        return nextItems;
      });
      setNextCursor(page.nextCursor);
    } catch (reason) {
      if (requestId.current === activeRequest) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (requestId.current === activeRequest) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [
    active,
    activeAlbumId,
    backendSource,
    creationRelation,
    creationScopeActive,
    debouncedQuery,
    dictionaryFilter,
    favoriteOnly,
    favoriteTexts,
    galleryAlbumScope,
    galleryPlacement,
    galleryQueryKey,
    imageEnabled,
    locale,
    nextCursor,
    total,
    unratedDimensions,
  ]);

  useGalleryViewport({
    restoreKey: `${viewportRestoreRevision}:${galleryQueryKey}`,
    resume: viewportSnapshotRef.current,
    snapshotRef: viewportSnapshotRef,
    viewportRef,
    active: active && !navigationPending,
    visible: !selectedItem,
    ready:
      displayedQueryKey === galleryQueryKey &&
      !searchPending &&
      !loading &&
      !error &&
      !albumError &&
      (!activeAlbumId || albumsLoaded),
    imageCount: items.length,
    hasMore: Boolean(nextCursor),
    loadMore,
    onChange: (viewport) => {
      commitGalleryLocation(
        {
          collection: currentCollection(),
          selectedMaterialKey: selectedKey,
          requestedMaterialId: location.requestedMaterialId,
          requestedAssetId: location.requestedAssetId,
          browse: { ...currentBrowseState(), viewport },
        },
        'replace',
      );
    },
  });

  useEffect(() => {
    if (!active) return;
    if (selectedItem && selectedIndex >= materials.length - 3 && nextCursor && !loading && !error) {
      void loadMore();
      return;
    }
    const viewport = viewportRef.current;
    const pageEnd = pageEndRef.current;
    if (!viewport || !pageEnd || !nextCursor || loading || error) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { root: viewport, rootMargin: '320px 0px' },
    );
    observer.observe(pageEnd);
    return () => observer.disconnect();
  }, [active, error, loadMore, loading, materials.length, nextCursor, selectedIndex, selectedItem]);

  async function scoreItem(item: GalleryItemDto, dimension: ImageRatingDimension, score: number | null) {
    const assetId = item.asset.id;
    if (busyAssets.has(assetId)) return;
    const ratingKey = dimension === 'AESTHETIC' ? 'aesthetic' : 'realism';
    const previousRating = item.ratings[ratingKey];
    const optimisticRating =
      score == null
        ? null
        : {
            id: previousRating?.id ?? `pending:${assetId}`,
            imageAssetId: assetId,
            dimension,
            score,
            updatedAt: new Date().toISOString(),
          };

    galleryCacheRef.current.clear();
    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id ? { ...entry, ratings: { ...entry.ratings, [ratingKey]: optimisticRating } } : entry,
      ),
    );
    setBusyAssets((current) => new Set(current).add(assetId));
    try {
      const saved = await window.desktopApi.imageRatingSet(assetId, dimension, score);
      const nextRatings = { ...item.ratings, [ratingKey]: saved };
      const noLongerMatchesUnratedFilter =
        unratedDimensions.length > 0 &&
        !unratedDimensions.some((candidate) =>
          candidate === 'AESTHETIC' ? !nextRatings.aesthetic : !nextRatings.realism,
        );
      setItems((current) =>
        current.flatMap((entry) => {
          if (entry.asset.id !== assetId) return [entry];
          const next = { ...entry, ratings: { ...entry.ratings, [ratingKey]: saved } };
          return noLongerMatchesUnratedFilter ? [] : [next];
        }),
      );
      if (noLongerMatchesUnratedFilter) setTotal((current) => Math.max(0, current - 1));
      notify(score == null ? l.cleared : l.saved);
    } catch (reason) {
      setItems((current) =>
        current.map((entry) =>
          entry.asset.id === assetId ? { ...entry, ratings: { ...entry.ratings, [ratingKey]: previousRating } } : entry,
        ),
      );
      notify(`${l.failed}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      galleryCacheRef.current.clear();
      setRequestedRevision((value) => value + 1);
      setBusyAssets((current) => {
        const next = new Set(current);
        next.delete(assetId);
        return next;
      });
    }
  }

  function changeScope(nextScope: typeof scope) {
    updatePreferences({ ...preferences, scope: nextScope });
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify(l.copied);
    } catch (reason) {
      notify(`${l.copyFailed}: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }

  async function removeFavorite(materialId: string) {
    if (busyFavoriteMaterialId) return;
    const favoriteFiltered = favoriteOnly;
    setBusyFavoriteMaterialId(materialId);
    try {
      await window.desktopApi.favoriteRemove(materialId);
      galleryCacheRef.current.clear();
      setFavoriteTexts((current) => current.filter((item) => item.id !== materialId));
      setItems((current) =>
        current.flatMap((item) => {
          if (item.favorite?.materialId !== materialId) return [item];
          if (favoriteFiltered) return [];
          return [{ ...item, favorite: null, source: item.source === 'FAVORITE' ? 'MATERIAL' : item.source }];
        }),
      );
      if (favoriteFiltered) {
        setTotal((current) => Math.max(0, current - 1));
      }
      notify(l.unfavorited);
    } catch (reason) {
      notify(`${l.unfavoriteFailed}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setRequestedRevision((value) => value + 1);
      setBusyFavoriteMaterialId(null);
    }
  }

  async function addFavorite(item: MaterialLibraryItem) {
    if (busyFavoriteMaterialId) return;
    const target: MaterialSelectionTargetInput =
      item.kind !== 'TEXT'
        ? item.image.materialId
          ? { kind: 'MATERIAL', materialId: item.image.materialId }
          : { kind: 'IMAGE_ASSET', imageAssetId: item.image.asset.id }
        : { kind: 'MATERIAL', materialId: item.text.id };
    const busyKey = target.kind === 'MATERIAL' ? target.materialId : target.imageAssetId;
    setBusyFavoriteMaterialId(busyKey);
    try {
      const result = await window.desktopApi.favoriteAdd(target);
      galleryCacheRef.current.clear();
      if (item.kind !== 'TEXT') {
        setItems((current) =>
          current.map((entry) =>
            entry.asset.id === item.image.asset.id
              ? {
                  ...entry,
                  materialId: result.materialId,
                  favorite: { materialId: result.materialId, createdAt: result.createdAt },
                }
              : entry,
          ),
        );
      }
      notify(l.favorited(result.created ? 1 : 0));
    } catch (reason) {
      notify(`${l.failed}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setRequestedRevision((value) => value + 1);
      setBusyFavoriteMaterialId(null);
    }
  }

  async function finishGalleryContentLifecycleAction({ target }: ContentLifecycleActionRequest) {
    if (target.entityType === 'ALBUM' && activeAlbumId) {
      let currentAlbumId: string | undefined = activeAlbumId;
      while (currentAlbumId) {
        if (currentAlbumId === target.entityId) {
          navigateCollection({ kind: 'all' }, 'replace');
          break;
        }
        currentAlbumId = materialAlbumBrowse.tree.parentById.get(currentAlbumId);
      }
    } else if (selectedItem) {
      const selectedTarget = contentLifecycleTargetForMaterial(selectedItem);
      if (selectedTarget.entityType === target.entityType && selectedTarget.entityId === target.entityId) {
        closeMaterialInspector();
      }
    }
    galleryCacheRef.current.clear();
    setRetryKey((value) => value + 1);
    await Promise.all([reloadAlbums(), refresh()]);
  }

  function requestMaterialLifecycle(action: 'ARCHIVE' | 'DELETE', item: MaterialLibraryItem) {
    const fallbackTitle =
      item.kind === 'TEXT'
        ? messages.gallery.card.textMaterial
        : item.image.asset.kind === 'GENERATED'
          ? messages.gallery.card.generated
          : messages.gallery.card.reference;
    return contentLifecycleActions.request({
      action,
      target: contentLifecycleTargetForMaterial(item),
      title: materialTitle(item, fallbackTitle),
    });
  }

  function requestAlbumLifecycle(action: 'ARCHIVE' | 'DELETE', album: MaterialAlbumDto) {
    return contentLifecycleActions.request({
      action,
      target: { entityType: 'ALBUM', entityId: album.id },
      title: album.title,
    });
  }

  function canMoveMaterialAlbum(albumId: string, parentAlbumId: string | null, copy = false) {
    return canMoveMaterialAlbumTo(materialAlbumBrowse.tree, albumId, parentAlbumId, copy);
  }

  function canMoveCreationAlbum(source: CreationTreeDrag, parentAlbumId: string | null, copy = false) {
    const target = parentAlbumId ? creationAlbumTree.byId.get(parentAlbumId) : null;
    if (parentAlbumId && (target?.systemKey !== 'CREATION_GROUP' || !target.sourceAlbumId)) return false;
    const destination = target?.sourceAlbumId ?? null;
    if (source.kind === 'CREATION_ITEM') {
      const item = creationItems.find((entry) => entry.id === source.id);
      return Boolean(item && item.lifecycle === 'ACTIVE' && (copy || item.albumId !== destination));
    }
    const projectedSource = creationAlbumViews.find((entry) => entry.sourceAlbumId === source.id);
    const currentParent = projectedSource?.parentId ? creationAlbumTree.byId.get(projectedSource.parentId) : null;
    if (projectedSource && !copy && (currentParent?.sourceAlbumId ?? null) === destination) return false;

    const visited = new Set<string>();
    let currentId: string | undefined = parentAlbumId ?? undefined;
    while (currentId) {
      if (creationAlbumTree.byId.get(currentId)?.sourceAlbumId === source.id || visited.has(currentId)) return false;
      visited.add(currentId);
      currentId = creationAlbumTree.parentById.get(currentId);
    }
    return true;
  }

  async function createAlbum(title: string, parentAlbumId: string | null) {
    setAlbumMutationBusy(true);
    try {
      await window.desktopApi.materialAlbumsCreate({
        title,
        locale,
        parentAlbumId: parentAlbumId ?? undefined,
      });
      await reloadAlbums();
      notify(messages.gallery.albums.created);
    } catch (reason) {
      notify(
        `${messages.gallery.albums.operationFailed}: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
      throw reason;
    } finally {
      setAlbumMutationBusy(false);
    }
  }

  async function renameAlbum(album: MaterialAlbumDto, title: string) {
    setAlbumMutationBusy(true);
    try {
      await window.desktopApi.materialAlbumsRename({ albumId: album.id, title, locale });
      await reloadAlbums();
      notify(messages.gallery.albums.renamed);
    } catch (reason) {
      notify(
        `${messages.gallery.albums.operationFailed}: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
      throw reason;
    } finally {
      setAlbumMutationBusy(false);
    }
  }

  async function moveAlbum(albumId: string, parentAlbumId: string | null, copy = false) {
    if (contentLifecycleBusy || !canMoveMaterialAlbum(albumId, parentAlbumId, copy)) return;
    setAlbumMutationBusy(true);
    try {
      if (copy) await copyCreationTarget('ALBUM', albumId, parentAlbumId);
      else await window.desktopApi.materialAlbumsMove({ albumId, parentAlbumId, locale });
      galleryCacheRef.current.clear();
      await reloadAlbums();
      setRetryKey((value) => value + 1);
      notify(copy ? messages.creator.outline.copied(1) : messages.gallery.albums.moved);
    } catch (reason) {
      notify(
        `${messages.gallery.albums.operationFailed}: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
      throw reason;
    } finally {
      setAlbumMutationBusy(false);
    }
  }

  async function moveCreationAlbum(source: CreationTreeDrag, parentAlbumId: string | null, copy = false) {
    if (contentLifecycleBusy || !canMoveCreationAlbum(source, parentAlbumId, copy)) return;
    const target = parentAlbumId ? creationAlbumTree.byId.get(parentAlbumId) : null;
    setAlbumMutationBusy(true);
    try {
      const targetSourceAlbumId = target?.sourceAlbumId ?? null;
      if (copy) await copyCreationTarget(source.kind, source.id, targetSourceAlbumId);
      else if (source.kind === 'ALBUM') {
        await window.desktopApi.albumsMove({ albumId: source.id, parentAlbumId: targetSourceAlbumId });
      } else {
        await window.desktopApi.creationItemMove({ creationItemId: source.id, albumId: targetSourceAlbumId });
      }
      galleryCacheRef.current.clear();
      await reloadAlbums();
      setRetryKey((value) => value + 1);
      notify(copy ? messages.creator.outline.copied(1) : messages.gallery.albums.moved);
    } catch (reason) {
      notify(
        `${messages.gallery.albums.operationFailed}: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
      throw reason;
    } finally {
      setAlbumMutationBusy(false);
    }
  }

  async function collectDroppedMaterials(
    albumId: string,
    targets: MaterialSelectionTargetInput[],
    sourceAlbumId?: string,
  ) {
    if (!targets.length || collectBusy) return;
    setCollectBusy(true);
    try {
      await window.desktopApi.materialsAddToDestinations({ albumIds: [albumId], termIds: [], targets, sourceAlbumId });
      galleryCacheRef.current.clear();
      await reloadAlbums();
      setRetryKey((value) => value + 1);
      notify(messages.gallery.albums.added);
    } catch (reason) {
      notify(
        `${messages.gallery.albums.operationFailed}: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
      throw reason;
    } finally {
      setCollectBusy(false);
    }
  }

  async function applyAlbumMembership(input: MaterialAlbumMembershipApplyInput) {
    const result = await window.desktopApi.materialAlbumMembershipApply(input);
    if (result.status === 'APPLIED') {
      applyMembershipPatch(result);
      // Only album-filtered cached results can change when membership changes.
      // The visible user-album contents are derived from the patched directory.
      for (const key of galleryCacheRef.current.keys()) {
        if (result.patches.some((patch) => key.includes(patch.albumId))) galleryCacheRef.current.delete(key);
      }
      // The overview is an "unfiled" projection. Whether this edit moves the
      // material depends on its memberships across every album, so refresh the
      // current query from storage.
      if (overviewBrowseActive) setRetryKey((value) => value + 1);
    }
    return result;
  }

  async function finishExternalCreation(_result: NewExternalCreationImportResult) {
    galleryCacheRef.current.clear();
    setRetryKey((value) => value + 1);
    await reloadAlbums();
    await refresh();
    notify(locale === 'zh' ? '已导入外部创作' : 'External creation imported');
  }

  async function finishGalleryIntake(result: IntakeCommitResult) {
    if (result.intent === 'START_CREATION') {
      await onIntakeCommitted(result);
      return;
    }
    // An import is not a navigation. Keep the user's album, scope, and query
    // exactly where they were and just show the freshly imported material.
    galleryCacheRef.current.clear();
    setRetryKey((value) => value + 1);
    notify(
      result.favoriteCount > 0
        ? l.favorited(result.favoriteCount)
        : messages.intake.review.imported(result.materialIds.length),
    );
    if (result.albumId) await reloadAlbums();
    await onIntakeCommitted(result);
    await refresh();
  }

  const albumLabels = materialLibraryNavigationLabels(messages);
  const activeHeaderAlbum =
    activeAlbum && activeAlbumSummary
      ? {
          ...activeAlbum,
          materialCount: activeAlbumSummary.materialCount,
          previewAssets: activeAlbumSummary.previewAssets,
        }
      : activeAlbum;
  const activeAlbumCountLabel = activeAlbumSummary
    ? [
        messages.gallery.albums.materials(activeAlbumSummary.materialCount),
        ...(activeAlbumSummary.childAlbumCount
          ? [messages.gallery.albums.childAlbums(activeAlbumSummary.childAlbumCount)]
          : []),
      ].join(' · ')
    : activeAlbum
      ? messages.gallery.albums.materials(creationScopeActive ? displayedResultTotal : activeAlbum.materialCount)
      : '';

  const library = (
    <GalleryIntakeAdapter
      ref={intakeRef}
      active={active}
      materialAlbumId={activeAlbum?.kind === 'USER' ? activeAlbum.id : null}
      creationAlbumId={activeAlbum?.systemKey === 'CREATION_GROUP' ? activeAlbum.sourceAlbumId : null}
      series={series}
      onCommitted={finishGalleryIntake}
      onExternalCreationCommitted={finishExternalCreation}
    >
      <section
        data-slot="material-library"
        data-active-album-id={activeAlbumId ?? ''}
        data-albums-state={albumsLoading ? 'loading' : albumError ? 'error' : 'ready'}
        data-search-state={searchPending ? 'pending' : loading ? 'loading' : 'ready'}
        data-results-state={displayedQueryKey === galleryQueryKey ? 'current' : 'stale'}
        data-selected-material-key={selectedKey ?? ''}
        data-selection-mode={selectionMode ? 'active' : 'inactive'}
        data-selected-count={checkedKeys.size}
        data-loaded-count={materials.length}
        className="flex size-full min-h-0 flex-col bg-background"
      >
        <div className={active && selectedItem ? 'hidden' : 'contents'}>
          <div ref={setNavigationToggleHost} className="flex shrink-0 border-b px-4 py-2 empty:hidden sm:px-6" />

          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <MaterialLibraryNavigation
              toggleHost={navigationToggleHost}
              albums={albums}
              category={category}
              activeAlbumId={activeAlbumId}
              dictionarySelection={dictionarySelection}
              dictionaryTree={dictionaryTree}
              labels={albumLabels}
              busy={contentLifecycleBusy}
              onSelectCategory={(nextCategory) => {
                if (nextCategory === 'DICTIONARY') navigateCollection({ kind: 'dictionary', scope: 'ALL' });
                else navigateCollection({ kind: 'all' });
              }}
              onSelectAlbum={(albumId) => navigateCollection({ kind: 'album', albumId })}
              onSelectDictionary={navigateCollection}
              onCreate={createAlbum}
              onRename={renameAlbum}
              onArchive={archiveAlbum}
              onDelete={deleteAlbum}
              onMove={moveAlbum}
              canMoveCreationAlbum={canMoveCreationAlbum}
              onMoveCreationAlbum={moveCreationAlbum}
              onCollectMaterials={collectDroppedMaterials}
              onImportFiles={(album, files) =>
                intakeRef.current?.reviewFiles(files, { albumId: album.id, albumName: album.title })
              }
            />

            <div
              className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
              aria-busy={loading || showingPreviousResults}
            >
              {activeHeaderAlbum && (
                <MaterialAlbumHeader
                  album={activeHeaderAlbum}
                  pathLabel={activeCreationPath}
                  countLabel={activeAlbumCountLabel}
                  ancestors={activeAlbumSummary ? activeAlbumAncestors : undefined}
                  onOpenRoot={activeAlbumSummary ? () => navigateCollection({ kind: 'all' }) : undefined}
                  onOpenAlbum={
                    activeAlbumSummary ? (albumId) => navigateCollection({ kind: 'album', albumId }) : undefined
                  }
                  busy={contentLifecycleBusy}
                  onArchive={activeHeaderAlbum.kind === 'USER' ? (album) => void archiveAlbum(album) : undefined}
                  onDelete={activeHeaderAlbum.kind === 'USER' ? (album) => void deleteAlbum(album) : undefined}
                  notify={notify}
                />
              )}
              {dictionaryActive && (
                <div className="flex min-h-20 shrink-0 items-center gap-3 border-b px-4 py-3 sm:px-6">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl border bg-surface text-selected-foreground">
                    <BookOpenIcon className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-xl font-semibold tracking-tight">
                      {dictionaryPathLabels.at(-1) ?? albumLabels.dictionary}
                    </h2>
                    {dictionaryPathLabels.length > 1 && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {dictionaryPathLabels.join(' / ')}
                      </p>
                    )}
                  </div>
                </div>
              )}
              <MaterialLibraryToolbar
                imageNamesAvailable={!creationBrowseActive}
                query={query}
                scope={dictionarySelection?.scope ?? scope}
                relationship="ANY"
                contentTypes={effectiveContentTypes}
                unratedDimensions={unratedDimensions}
                selectionMode={selectionMode}
                selectionAvailable={!creationBrowseActive && activeAlbum?.kind !== 'USER'}
                availableContentTypes={imageOnly ? ['IMAGE'] : undefined}
                relationshipLocked
                sourceFilter={dictionaryActive || creationScopeActive ? undefined : sourceFilter}
                creationRelationFilter={creationScopeActive ? creationRelation : undefined}
                onQueryChange={changeQuery}
                onScopeChange={(nextScope) => {
                  if (!dictionarySelection) {
                    changeScope(nextScope);
                    return;
                  }
                  navigateCollection({ ...dictionarySelection, scope: nextScope });
                }}
                onRelationshipChange={() => undefined}
                onContentTypesChange={(value) => updatePreferences({ ...preferences, contentTypes: value })}
                onUnratedDimensionsChange={(value) => updatePreferences({ ...preferences, unratedDimensions: value })}
                onSelectionModeChange={changeSelectionMode}
                onSourceFilterChange={(nextSource) => {
                  if (activeAlbumId) {
                    changeSelectionMode(false);
                    setSelectedKey(null);
                    setSourceFilter(nextSource);
                    resetBrowseViewport();
                    commitGalleryLocation(
                      {
                        collection: currentCollection(),
                        selectedMaterialKey: null,
                        requestedMaterialId: null,
                        browse: { ...currentBrowseState(), source: nextSource, viewport: undefined },
                      },
                      'replace',
                    );
                    return;
                  }
                  if (nextSource === 'CREATION') navigateCollection({ kind: 'creation' });
                  else if (nextSource === 'IMPORT') navigateCollection({ kind: 'import' });
                  else navigateCollection({ kind: 'all' });
                }}
                onCreationRelationFilterChange={(nextRelation) => {
                  if (!activeAlbumId || !creationScopeActive) return;
                  navigateCollection(
                    { kind: 'album', albumId: activeAlbumId, creationRelation: nextRelation },
                    'replace',
                  );
                }}
              />

              {(searchPending || (loading && materials.length > 0) || albumsLoading || albumError) && (
                <div className="flex shrink-0 items-center gap-2 px-4 py-2 text-xs text-muted-foreground sm:px-6">
                  {searchPending && <span role="status">{l.searching}</span>}
                  {loading && materials.length > 0 && (
                    <LoaderCircleIcon className="size-3.5 animate-spin" aria-label={l.loadingMore} />
                  )}
                  {albumsLoading && <span role="status">{messages.gallery.albums.loading}</span>}
                  {!albumsLoading && albumError && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-destructive"
                      onClick={() => setAlbumRetryKey((value) => value + 1)}
                    >
                      {messages.gallery.albums.loadFailed} · {l.retry}
                    </Button>
                  )}
                </div>
              )}

              {selectionMode && !creationBrowseActive && activeAlbum?.kind !== 'USER' && (
                <MaterialBatchToolbar
                  imageAssetIds={materials.flatMap((item) =>
                    checkedKeys.has(item.key) && item.kind === 'IMAGE' ? [item.image.asset.id] : [],
                  )}
                  count={checkedKeys.size}
                  albums={writableAlbums}
                  terms={terms}
                  containsText={materials.some((item) => checkedKeys.has(item.key) && item.kind === 'TEXT')}
                  busy={collectBusy}
                  labels={{
                    ...messages.gallery.batch,
                    albums: messages.gallery.albums.myAlbums,
                    empty: messages.gallery.albums.empty,
                    createTitle: messages.gallery.albums.createTitle,
                    albumName: messages.gallery.albums.name,
                    albumNamePlaceholder: messages.gallery.albums.namePlaceholder,
                    cancel: messages.gallery.albums.cancel,
                    create: messages.gallery.albums.create,
                  }}
                  onAdd={addCheckedToDestinations}
                  onCreateAndCollect={createAlbumAndCollect}
                  onClear={() => changeSelectionMode(false)}
                />
              )}

              <MaterialLibraryContent
                albums={browseAlbumSummaries}
                creationCollections={creationCollections}
                overviewCreationCollections={overviewCreationCollections}
                creationSectionTitle={creationSectionTitle}
                albumSectionTitle={albumSectionTitle}
                materialSectionTitle={materialSectionTitle}
                overviewMode={overviewBrowseActive}
                materialTotal={displayedResultTotal}
                materials={materials}
                selectedKey={selectedKey}
                checkedKeys={checkedKeys}
                selectionMode={selectionMode}
                selectionAvailable={!creationBrowseActive && activeAlbum?.kind !== 'USER'}
                loading={loading}
                error={error}
                showingPreviousResults={showingPreviousResults}
                searchActive={Boolean(debouncedQuery)}
                unratedActive={unratedDimensions.length > 0}
                albumMutationBusy={contentLifecycleBusy}
                viewportRef={viewportRef}
                pageEndRef={pageEndRef}
                onOpenAlbum={(albumId) => navigateCollection({ kind: 'album', albumId })}
                canMoveCreationAlbum={canMoveCreationAlbum}
                onMoveCreationAlbum={moveCreationAlbum}
                canMoveAlbum={canMoveMaterialAlbum}
                onMoveAlbum={moveAlbum}
                onCollectMaterials={collectDroppedMaterials}
                onImportFiles={(album, files) =>
                  intakeRef.current?.reviewFiles(files, { albumId: album.id, albumName: album.title })
                }
                onArchiveAlbum={archiveAlbum}
                onDeleteAlbum={deleteAlbum}
                onSelect={stableSelectMaterial}
                onEnterSelection={stableEnterSelection}
                onToggleSelection={stableToggleSelection}
                onCopyText={stableCopyText}
                onArchiveMaterial={archiveMaterial}
                onDeleteMaterial={deleteMaterial}
                notify={stableNotify}
                onDragStart={stableStartMaterialDrag}
                revealContextForItem={revealContextForMaterial}
                onClearSearch={() => changeQuery('')}
                onClearUnrated={() => updatePreferences({ ...preferences, unratedDimensions: [] })}
                onRetry={() => setRetryKey((value) => value + 1)}
              />
            </div>
          </div>
        </div>
        {active && selectedItem && (
          <WorkspaceDetailLoadingBoundary>
            <MaterialDetailPage
              browseItems={requestedTargetKey ? [] : materials}
              onBrowseSelect={(item) => selectMaterial(item, undefined, 'replace')}
              spaceId={spaceId}
              item={selectedItem}
              position={Math.max(0, selectedIndex) + 1}
              total={requestedTargetKey ? 1 : Math.max(resultTotal, materials.length)}
              albums={writableAlbums}
              ratingBusy={selectedItem.kind === 'IMAGE' && busyAssets.has(selectedItem.image.asset.id)}
              albumMembershipBusy={albumMutationBusy}
              albumsLoading={albumsLoading}
              albumsFailed={Boolean(albumError)}
              onRetryAlbums={reloadAlbums}
              onOpenAlbum={(albumId) => navigateCollection({ kind: 'album', albumId })}
              favorited={Boolean(selectedFavoriteMaterialId)}
              favoriteBusy={selectedFavoriteBusy}
              hasPrevious={Boolean(previousItem)}
              hasNext={Boolean(nextItem)}
              onClose={closeMaterialInspector}
              onPrevious={() => {
                if (previousItem) selectMaterial(previousItem, undefined, 'replace');
              }}
              onNext={() => {
                if (nextItem) selectMaterial(nextItem, undefined, 'replace');
              }}
              onOpenResult={onOpenResult}
              onOpenTerm={onOpenTerm}
              onCopyText={(text) => void copyText(text)}
              lifecycleBusy={contentLifecycleBusy}
              onArchive={(item) => void requestMaterialLifecycle('ARCHIVE', item)}
              onDelete={(item) => void requestMaterialLifecycle('DELETE', item)}
              onAddFavorite={() => void addFavorite(selectedItem)}
              onRemoveFavorite={() => {
                if (selectedFavoriteMaterialId) void removeFavorite(selectedFavoriteMaterialId);
              }}
              onApplyAlbumMembership={applyAlbumMembership}
              onScore={(dimension, score) => {
                if (selectedItem.kind === 'IMAGE') void scoreItem(selectedItem.image, dimension, score);
              }}
              notify={notify}
              onMetadataUpdated={updateMaterialMetadata}
              closeAfterRemoveFavorite={favoriteOnly && !requestedTargetKey}
              onHistoryNavigationGuardChange={onHistoryNavigationGuardChange}
              revealContext={revealContextForMaterial(selectedItem)}
            />
          </WorkspaceDetailLoadingBoundary>
        )}
        {contentLifecycleActions.confirmationDialog}
      </section>
    </GalleryIntakeAdapter>
  );
  return (
    <MaterialAlbumMoveProvider key={libraryKey} albums={albums} busy={contentLifecycleBusy} onMove={moveAlbum}>
      {library}
    </MaterialAlbumMoveProvider>
  );
}
