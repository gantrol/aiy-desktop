import { BookOpenIcon, LoaderCircleIcon } from 'lucide-react';
import {
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
  GalleryPageDto,
  GallerySourceFilter,
  ImageRatingDimension,
  IntakeCommitResult,
  MaterialAlbumDto,
  MaterialAlbumMemberDto,
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
import { MaterialDetailPage } from '@/renderer/components/gallery/MaterialInspector';
import { MaterialLibraryContent } from '@/renderer/components/gallery/MaterialLibraryContent';
import {
  MaterialLibraryToolbar,
  type MaterialSourceFilter,
} from '@/renderer/components/gallery/MaterialLibraryToolbar';
import { MaterialBatchToolbar } from '@/renderer/components/gallery/MaterialBatchToolbar';
import { loadGalleryPreferences, saveGalleryPreferences } from '@/renderer/components/gallery/galleryPreferences';
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
import { buildMaterialAlbumTree } from '@/renderer/components/gallery/materialAlbumTree';
import { useCreationCollectionBrowse } from '@/renderer/components/gallery/useCreationCollectionBrowse';
import { nextGallerySelection } from '@/renderer/components/gallery/gallerySelection';
import { beginNativeMaterialsDrag, writeMaterialsDrag } from '@/renderer/components/albums/albumDrag';
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

interface Props {
  libraryKey: string;
  dataRevision: number;
  active: boolean;
  location: GalleryLocation;
  onNavigate(location: GalleryLocation, mode?: NavigationMode): void;
  onHistoryNavigationGuardChange(guard: HistoryNavigationGuard | null): void;
  onOpenResult(seriesId: string, assetId: string): void;
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
  cache.set(key, snapshot);
  while (cache.size > galleryCacheLimit) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

export function GalleryScreen({
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
  const appliedLocationKeyRef = useRef(locationKey);
  const requestId = useRef(0);
  const loadingRef = useRef(false);
  const albumRequestId = useRef(0);
  const intakeRef = useRef<GalleryIntakeAdapterHandle | null>(null);
  const galleryCacheRef = useRef<Map<string, GallerySnapshot>>(new Map());
  const displayedLibraryKeyRef = useRef(libraryKey);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pageEndRef = useRef<HTMLDivElement | null>(null);
  const [preferences, setPreferences] = useState(loadGalleryPreferences);
  const { scope, contentTypes, unratedDimensions } = preferences;
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
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
  const [checkedKeys, setCheckedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [collectBusy, setCollectBusy] = useState(false);
  const rangeAnchorKey = useRef<string | null>(null);
  const [albums, setAlbums] = useState<MaterialAlbumDto[]>([]);
  const [category, setCategory] = useState<MaterialLibraryCategory>(() => categoryForCollection(location.collection));
  const [sourceFilter, setSourceFilter] = useState<MaterialSourceFilter>(() =>
    sourceForCollection(location.collection),
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
  const [albumsLoading, setAlbumsLoading] = useState(false);
  const [albumsLoaded, setAlbumsLoaded] = useState(false);
  const [albumError, setAlbumError] = useState('');
  const [albumRetryKey, setAlbumRetryKey] = useState(0);
  const [albumMutationBusy, setAlbumMutationBusy] = useState(false);
  const [busyAlbumIds, setBusyAlbumIds] = useState<Set<string>>(() => new Set());
  const [displayedQueryKey, setDisplayedQueryKey] = useState('');

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
  const organizedMaterialIds = useMemo(() => {
    const ids = new Set<string>();
    for (const album of writableAlbums) {
      for (const member of album.members) ids.add(member.materialId);
    }
    return ids;
  }, [writableAlbums]);
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

  function commitGalleryLocation(nextLocation: GalleryLocation, mode: NavigationMode = 'push') {
    appliedLocationKeyRef.current = navigationLocationKey(nextLocation);
    onNavigate(nextLocation, mode);
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
    changeSelectionMode(false);
    setSelectedKey(null);
    setActiveAlbumId(collection.kind === 'album' ? collection.albumId : null);
    setCreationRelation(collection.kind === 'album' ? (collection.creationRelation ?? 'ALL') : 'ALL');
    setDictionarySelection(collection.kind === 'dictionary' ? collection : null);
    setSourceFilter(sourceForCollection(collection));
    setCategory(categoryForCollection(collection));
    commitGalleryLocation({ collection, selectedMaterialKey: null, requestedMaterialId: null }, mode);
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
    setActiveAlbumId(location.collection.kind === 'album' ? location.collection.albumId : null);
    setCreationRelation(location.collection.kind === 'album' ? (location.collection.creationRelation ?? 'ALL') : 'ALL');
    setDictionarySelection(location.collection.kind === 'dictionary' ? location.collection : null);
    setSourceFilter(sourceForCollection(location.collection));
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
  const creationSeriesCount = overviewBrowseActive
    ? albums.filter((album) => album.systemKey === 'CREATION_SERIES').length
    : 0;
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
    if (!event.shiftKey && item.kind === 'IMAGE') {
      const source =
        checkedKeys.has(item.key) && checkedKeys.size > 0
          ? materials.filter((candidate) => checkedKeys.has(candidate.key))
          : [item];
      const images = source.flatMap((candidate) => (candidate.kind === 'IMAGE' ? [candidate] : []));
      const assetIds = [...new Set(images.map((candidate) => candidate.image.asset.id))];
      if (assetIds.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        const finishNativeDrag = beginNativeMaterialsDrag(targetsForMaterials(images));
        void window.desktopApi
          .assetFilesStartDrag(assetIds)
          .catch((reason) => {
            notify(`${messages.assetFile.failed}: ${reason instanceof Error ? reason.message : String(reason)}`);
          })
          .finally(finishNativeDrag);
        return;
      }
    }
    const targets = checkedKeys.has(item.key) && checkedKeys.size > 0 ? checkedTargets() : [targetForMaterial(item)];
    writeMaterialsDrag(event.dataTransfer, targets);
  }

  // Card rows are memoized, so the handlers they receive must keep a stable
  // identity or every list mutation re-renders the whole grid.
  const stableSelectMaterial = useStableCallback(selectMaterial);
  const stableEnterSelection = useStableCallback(enterSelection);
  const stableToggleSelection = useStableCallback(toggleSelection);
  const stableStartMaterialDrag = useStableCallback(startMaterialDrag);
  const stableNotify = useStableCallback(notify);
  const stableCopyText = useStableCallback((text: string) => void copyText(text));

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
      setAlbums(await window.desktopApi.materialAlbumsList({ locale }));
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
      setAlbums(await window.desktopApi.materialAlbumsList({ locale }));
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
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!active) {
      setAlbumsLoading(false);
      setAlbumsLoaded(false);
      return undefined;
    }
    const activeRequest = ++albumRequestId.current;
    setAlbumsLoading(true);
    setAlbumsLoaded(false);
    setAlbumError('');
    void window.desktopApi
      .materialAlbumsList({ locale })
      .then((nextAlbums) => {
        if (albumRequestId.current !== activeRequest) return;
        setAlbums(nextAlbums);
        setAlbumsLoaded(true);
        setActiveAlbumId((current) => (current && nextAlbums.some((album) => album.id === current) ? current : null));
      })
      .catch((reason) => {
        if (albumRequestId.current === activeRequest) {
          setAlbumError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (albumRequestId.current === activeRequest) setAlbumsLoading(false);
      });
    return () => {
      if (albumRequestId.current === activeRequest) albumRequestId.current += 1;
    };
  }, [active, albumRetryKey, dataRevision, libraryKey, locale]);

  useEffect(() => {
    if (!active || !albumsLoaded || location.collection.kind !== 'album') return;
    const albumId = location.collection.albumId;
    if (albums.some((album) => album.id === albumId)) return;
    navigateCollection({ kind: 'all' }, 'replace');
  }, [active, albums, albumsLoaded, locationKey]);

  useEffect(() => {
    if (!active) {
      requestId.current += 1;
      loadingRef.current = false;
      setLoading(false);
      return;
    }
    if ((activeAlbumId || overviewBrowseActive) && !albumsLoaded) {
      requestId.current += 1;
      loadingRef.current = false;
      setLoading(albumsLoading);
      return;
    }
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
      viewportRef.current?.scrollTo({ top: 0 });
    }
    setError('');
    loadingRef.current = true;
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
    const textRequest = (
      textEnabled
        ? activeAlbum?.kind === 'USER'
          ? window.desktopApi.albumsListTextMaterials(activeAlbum.id)
          : window.desktopApi.favoriteTextsList()
        : Promise.resolve([] as FavoriteTextMaterialDto[])
    ).then((texts) => {
      if (overviewBrowseActive) return texts.filter((item) => !organizedMaterialIds.has(item.id));
      if (albumBrowseActive) return texts.filter((item) => activeDirectMaterialIds.has(item.id));
      return texts;
    });

    void Promise.all([imageRequest, textRequest])
      .then(([page, texts]) => {
        if (requestId.current !== activeRequest) return;
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
        viewportRef.current?.scrollTo({ top: 0 });
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
    organizedMaterialIds,
    overviewBrowseActive,
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

  const revealContextForMaterial = useCallback(
    (item: MaterialLibraryItem): AssetFileRevealContext | undefined => {
      if (item.kind === 'TEXT') return undefined;
      if (activeAlbum?.kind === 'USER') return { kind: 'ALBUM', albumId: activeAlbum.id };
      if (dictionarySelection?.termId) return { kind: 'TERM', termId: dictionarySelection.termId };
      if (dictionaryActive) return { kind: 'DICTIONARY' };
      return { kind: 'ALL_MATERIALS' };
    },
    [activeAlbum, dictionaryActive, dictionarySelection?.termId],
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
    () => materials.find((item) => item.key === selectedKey) ?? null,
    [materials, selectedKey],
  );
  const selectedIndex = selectedItem ? materials.findIndex((item) => item.key === selectedItem.key) : -1;
  const previousItem = selectedIndex > 0 ? materials[selectedIndex - 1] : null;
  const nextItem = selectedIndex >= 0 ? (materials[selectedIndex + 1] ?? null) : null;
  const selectedFavoriteMaterialId =
    selectedItem && selectedItem.kind !== 'TEXT'
      ? (selectedItem.image.favorite?.materialId ?? null)
      : selectedItem && !activeAlbumId
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
    if (loading || displayedQueryKey !== galleryQueryKey || !selectedKey || selectedItem) return;
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
  }, [displayedQueryKey, galleryQueryKey, loading, selectedItem, selectedKey]);

  useEffect(() => {
    const requestedMaterialId = location.requestedMaterialId;
    if (!active || !requestedMaterialId || activeAlbumId || dictionaryActive) return;
    const imported = materials.find((item) =>
      item.kind !== 'TEXT' ? item.image.materialId === requestedMaterialId : item.text.id === requestedMaterialId,
    );
    if (!imported) return;
    setSelectedKey(imported.key);
    commitGalleryLocation(
      {
        collection: { kind: 'all' },
        selectedMaterialKey: imported.key,
        requestedMaterialId: null,
      },
      'replace',
    );
  }, [active, activeAlbumId, dictionaryActive, location.requestedMaterialId, materials]);

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
  }

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingRef.current || !imageEnabled) return;
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

  useEffect(() => {
    if (active && selectedItem && selectedIndex >= materials.length - 3 && nextCursor && !loading && !error) {
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

  async function reloadAlbums() {
    setAlbums(await window.desktopApi.materialAlbumsList({ locale }));
  }

  function canMoveMaterialAlbum(albumId: string, parentAlbumId: string | null) {
    const tree = materialAlbumBrowse.tree;
    const source = tree.byId.get(albumId);
    if (!source) return false;
    if (parentAlbumId === null) return source.parentId !== null;
    if (parentAlbumId === albumId || source.parentId === parentAlbumId || !tree.byId.has(parentAlbumId)) return false;

    const visited = new Set<string>();
    let currentId: string | undefined = parentAlbumId;
    while (currentId) {
      if (currentId === albumId || visited.has(currentId)) return false;
      visited.add(currentId);
      currentId = tree.parentById.get(currentId);
    }
    return true;
  }

  function canMoveCreationAlbum(albumId: string, parentAlbumId: string | null) {
    const source = creationAlbumTree.byId.get(albumId);
    const movableAlbum = source?.systemKey === 'CREATION_GROUP' && Boolean(source.sourceAlbumId);
    const movableSeries = source?.systemKey === 'CREATION_SERIES' && Boolean(source.sourceSeriesId);
    if (!source || (!movableAlbum && !movableSeries)) return false;
    const target = parentAlbumId ? creationAlbumTree.byId.get(parentAlbumId) : null;
    if (parentAlbumId && (target?.systemKey !== 'CREATION_GROUP' || !target.sourceAlbumId)) return false;
    const currentParent = source.parentId ? creationAlbumTree.byId.get(source.parentId) : null;
    const currentParentAlbumId = currentParent?.systemKey === 'CREATION_GROUP' ? currentParent.id : null;
    if (currentParentAlbumId === parentAlbumId) return false;
    if (!movableAlbum || parentAlbumId === null) return true;

    const visited = new Set<string>();
    let currentId: string | undefined = parentAlbumId;
    while (currentId) {
      if (currentId === albumId || visited.has(currentId)) return false;
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

  async function moveAlbum(albumId: string, parentAlbumId: string | null) {
    if (contentLifecycleBusy || !canMoveMaterialAlbum(albumId, parentAlbumId)) return;
    setAlbumMutationBusy(true);
    try {
      await window.desktopApi.materialAlbumsMove({ albumId, parentAlbumId, locale });
      galleryCacheRef.current.clear();
      await reloadAlbums();
      setRetryKey((value) => value + 1);
      notify(messages.gallery.albums.moved);
    } catch (reason) {
      notify(
        `${messages.gallery.albums.operationFailed}: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
      throw reason;
    } finally {
      setAlbumMutationBusy(false);
    }
  }

  async function moveCreationAlbum(albumId: string, parentAlbumId: string | null) {
    if (contentLifecycleBusy || !canMoveCreationAlbum(albumId, parentAlbumId)) return;
    const source = creationAlbumTree.byId.get(albumId);
    const target = parentAlbumId ? creationAlbumTree.byId.get(parentAlbumId) : null;
    if (!source) return;
    setAlbumMutationBusy(true);
    try {
      const targetSourceAlbumId = target?.sourceAlbumId ?? null;
      if (source.systemKey === 'CREATION_GROUP' && source.sourceAlbumId) {
        await window.desktopApi.albumsMove({ albumId: source.sourceAlbumId, parentAlbumId: targetSourceAlbumId });
      } else if (source.systemKey === 'CREATION_SERIES' && source.sourceSeriesId) {
        const item = creationItems.find((candidate) =>
          candidate.forms.some(
            (form) => form.entity.kind === 'PROMPT_SERIES' && form.entity.id === source.sourceSeriesId,
          ),
        );
        if (!item) throw new Error('The containing creation item is unavailable');
        await window.desktopApi.creationItemMove({ creationItemId: item.id, albumId: targetSourceAlbumId });
      } else {
        return;
      }
      galleryCacheRef.current.clear();
      await reloadAlbums();
      setRetryKey((value) => value + 1);
      notify(messages.gallery.albums.moved);
    } catch (reason) {
      notify(
        `${messages.gallery.albums.operationFailed}: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
      throw reason;
    } finally {
      setAlbumMutationBusy(false);
    }
  }

  async function deleteAlbum(album: MaterialAlbumDto) {
    await requestAlbumLifecycle('DELETE', album);
  }

  async function archiveAlbum(album: MaterialAlbumDto) {
    await requestAlbumLifecycle('ARCHIVE', album);
  }

  async function collectDroppedMaterials(albumId: string, targets: MaterialSelectionTargetInput[]) {
    if (!targets.length || collectBusy) return;
    setCollectBusy(true);
    try {
      await window.desktopApi.materialAlbumsAddMany({ albumId, targets, locale });
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

  async function toggleAlbumMembership(
    album: MaterialAlbumDto,
    member: MaterialAlbumMemberDto | null,
    checked: boolean,
  ) {
    if (!selectedItem || busyAlbumIds.has(album.id)) return;
    setBusyAlbumIds((current) => new Set(current).add(album.id));
    try {
      if (checked) {
        await window.desktopApi.materialAlbumsAddMany({
          albumId: album.id,
          locale,
          targets: [
            selectedItem.kind === 'TEXT'
              ? { kind: 'MATERIAL', materialId: selectedItem.text.id }
              : selectedItem.image.materialId
                ? { kind: 'MATERIAL', materialId: selectedItem.image.materialId }
                : { kind: 'IMAGE_ASSET', imageAssetId: selectedItem.image.asset.id },
          ],
        });
      } else if (member) {
        await window.desktopApi.materialAlbumsRemove({
          albumId: album.id,
          materialIds: [member.materialId],
          locale,
        });
      }
      galleryCacheRef.current.clear();
      await reloadAlbums();
      setRetryKey((value) => value + 1);
      notify(checked ? messages.gallery.albums.added : messages.gallery.albums.removed);
    } catch (reason) {
      notify(
        `${messages.gallery.albums.operationFailed}: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
      throw reason;
    } finally {
      setBusyAlbumIds((current) => {
        const next = new Set(current);
        next.delete(album.id);
        return next;
      });
    }
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
  const resultCountLabel = overviewBrowseActive
    ? [
        messages.gallery.albums.creations(creationSeriesCount),
        messages.gallery.albums.albumCount(rootAlbumSummaries.length),
        messages.gallery.albums.materials(resultTotal),
      ].join(' · ')
    : albumBrowseActive
      ? `${messages.gallery.albums.albumCount(activeChildAlbumSummaries.length)} · ${messages.gallery.albums.materials(resultTotal)}`
      : `${displayedResultTotal} ${l.unit}`;
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

  return (
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
          <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 sm:px-6">
            <h1 className="text-lg font-semibold tracking-tight">{l.title}</h1>
            <span data-slot="material-result-count" className="text-xs text-muted-foreground" aria-live="polite">
              {searchPending ? l.searching : resultCountLabel}
            </span>
            {loading && materials.length > 0 && (
              <LoaderCircleIcon className="size-3.5 animate-spin text-muted-foreground" aria-label={l.loadingMore} />
            )}
            {albumsLoading && <span className="text-xs text-muted-foreground">{messages.gallery.albums.loading}</span>}
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
          </header>

          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <MaterialLibraryNavigation
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
                onQueryChange={setQuery}
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

              {selectionMode && !creationBrowseActive && activeAlbum?.kind !== 'USER' && (
                <MaterialBatchToolbar
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
                onArchiveAlbum={(album) => void archiveAlbum(album)}
                onDeleteAlbum={(album) => void deleteAlbum(album)}
                onSelect={stableSelectMaterial}
                onEnterSelection={stableEnterSelection}
                onToggleSelection={stableToggleSelection}
                onCopyText={stableCopyText}
                onArchiveMaterial={(item) => void requestMaterialLifecycle('ARCHIVE', item)}
                onDeleteMaterial={(item) => void requestMaterialLifecycle('DELETE', item)}
                notify={stableNotify}
                onDragStart={stableStartMaterialDrag}
                revealContextForItem={revealContextForMaterial}
                onClearSearch={() => setQuery('')}
                onClearUnrated={() => updatePreferences({ ...preferences, unratedDimensions: [] })}
                onRetry={() => setRetryKey((value) => value + 1)}
              />
            </div>
          </div>
        </div>
        {active && selectedItem && (
          <MaterialDetailPage
            item={selectedItem}
            position={selectedIndex + 1}
            total={Math.max(resultTotal, materials.length)}
            albums={writableAlbums}
            ratingBusy={selectedItem.kind === 'IMAGE' && busyAssets.has(selectedItem.image.asset.id)}
            albumMembershipBusy={busyAlbumIds.size > 0}
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
            onOpenResult={(seriesId, assetId) => onOpenResult(activeAlbum?.sourceSeriesId ?? seriesId, assetId)}
            onOpenTerm={onOpenTerm}
            onCopyText={(text) => void copyText(text)}
            lifecycleBusy={contentLifecycleBusy}
            onArchive={(item) => void requestMaterialLifecycle('ARCHIVE', item)}
            onDelete={(item) => void requestMaterialLifecycle('DELETE', item)}
            onAddFavorite={() => void addFavorite(selectedItem)}
            onRemoveFavorite={() => {
              if (selectedFavoriteMaterialId) void removeFavorite(selectedFavoriteMaterialId);
            }}
            onToggleAlbumMembership={toggleAlbumMembership}
            onScore={(dimension, score) => {
              if (selectedItem.kind === 'IMAGE') void scoreItem(selectedItem.image, dimension, score);
            }}
            notify={notify}
            onMetadataUpdated={updateMaterialMetadata}
            closeAfterRemoveFavorite={favoriteOnly}
            onHistoryNavigationGuardChange={onHistoryNavigationGuardChange}
            revealContext={revealContextForMaterial(selectedItem)}
          />
        )}
        {contentLifecycleActions.confirmationDialog}
      </section>
    </GalleryIntakeAdapter>
  );
}
