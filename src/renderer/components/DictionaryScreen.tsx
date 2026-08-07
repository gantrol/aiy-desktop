import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AssetDto,
  BootstrapDto,
  DictionaryMaintenanceReportDto,
  ImportPreview,
  Locale,
  TermDraftInput,
  TermEditorDto,
  TermListItem,
  TermMediaItemDto,
} from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import { DictionaryToolbar } from '@/renderer/components/dictionary/DictionaryToolbar';
import {
  DictionaryContextSidebar,
  type DictionaryContextSidebarMode,
} from '@/renderer/components/dictionary/DictionaryContextSidebar';
import { DictionaryMaintenanceDialog } from '@/renderer/components/dictionary/DictionaryMaintenanceDialog';
import { DictionaryClassificationScreen } from '@/renderer/components/dictionary/classifications/DictionaryClassificationScreen';
import { ImportPreviewDialog } from '@/renderer/components/dictionary/ImportPreviewDialog';
import { NewTermDialog } from '@/renderer/components/dictionary/NewTermDialog';
import { TermDetailView } from '@/renderer/components/dictionary/TermDetailView';
import { TermEditor } from '@/renderer/components/dictionary/TermEditor';
import { TermOverview } from '@/renderer/components/dictionary/TermOverview';
import {
  deriveDictionaryBrowseContext,
  dictionaryBrowseBreadcrumb,
  type DictionaryBrowseContext,
} from '@/renderer/components/dictionary/dictionary-navigation';
import { dictionaryMutationError, runDictionaryMutation } from '@/renderer/components/dictionary/dictionary-mutation';
import { useDictionarySiblingPage } from '@/renderer/components/dictionary/useDictionarySiblingPage';
import {
  navigationLocationKey,
  type DictionaryLocation,
  type HistoryNavigationGuard,
  type NavigationMode,
} from '@/renderer/components/app/app-navigation';

interface Props {
  data: BootstrapDto;
  active: boolean;
  location: DictionaryLocation;
  onNavigate(location: DictionaryLocation, mode?: NavigationMode): void;
  onNavigateBack(): void;
  onHistoryNavigationGuardChange(guard: HistoryNavigationGuard | null): void;
  refresh(): Promise<void>;
  notify(message: string): void;
}

type DictionarySurface = 'overview' | 'detail' | 'edit' | 'classifications';
type DictionaryNavigationTarget =
  { kind: 'overview' } | { kind: 'detail' } | { kind: 'term'; termId: string; resetContext?: boolean };

function isDictionaryTermLocation(
  location: DictionaryLocation,
): location is Extract<DictionaryLocation, { surface: 'detail' | 'edit' }> {
  return location.surface === 'detail' || location.surface === 'edit';
}

function toDraft(term: TermEditorDto): TermDraftInput {
  return {
    termId: term.id,
    title: term.title,
    titleLocale: term.titleLocale,
    definition: term.definition,
    aliases: term.aliases,
    localizations: term.localizations,
    classificationIds: term.classificationIds,
    primaryDirectoryClassificationId: term.primaryDirectoryClassificationId,
    expressions: term.expressions,
  };
}

export function DictionaryScreen({
  data,
  active,
  location,
  onNavigate,
  onNavigateBack,
  onHistoryNavigationGuardChange,
  refresh,
  notify,
}: Props) {
  const { locale, messages } = useI18n();
  const c = messages.dictionary.editor;
  const notices = messages.dictionary.notices;
  const locationKey = navigationLocationKey(location);
  const appliedLocationKeyRef = useRef(locationKey);
  const [surface, setSurface] = useState<DictionarySurface>(location.surface);
  const [query, setQuery] = useState('');
  const [selectedFacets, setSelectedFacets] = useState<string[]>([]);
  const [selectedTermIds, setSelectedTermIds] = useState<string[]>([]);
  const [selectionTermIds, setSelectionTermIds] = useState<string[]>([]);
  const [excludeDrafts, setExcludeDrafts] = useState(false);
  const [excludeUncited, setExcludeUncited] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [overviewTerms, setOverviewTerms] = useState<TermListItem[]>(data.terms);
  const [overviewTermsLoading, setOverviewTermsLoading] = useState(false);
  const [overviewTermLoadError, setOverviewTermLoadError] = useState('');
  const [selectedId, setSelectedId] = useState(isDictionaryTermLocation(location) ? location.termId : '');
  const [browseContext, setBrowseContext] = useState<DictionaryBrowseContext | null>(
    isDictionaryTermLocation(location) ? location.browseContext : null,
  );
  const [detail, setDetail] = useState<TermEditorDto | null>(null);
  const [detailLocale, setDetailLocale] = useState<Locale | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailLoadError, setDetailLoadError] = useState('');
  const [detailReloadKey, setDetailReloadKey] = useState(0);
  const [draft, setDraft] = useState<TermDraftInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importPreparing, setImportPreparing] = useState(false);
  const [newTermOpen, setNewTermOpen] = useState(false);
  const [newTermClassification, setNewTermClassification] = useState<{ id: string; path: string } | null>(null);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [maintenanceReports, setMaintenanceReports] = useState<DictionaryMaintenanceReportDto[]>([]);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const [maintenanceError, setMaintenanceError] = useState('');
  const [discardOpen, setDiscardOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<DictionaryNavigationTarget | null>(null);
  const [contextSidebarMode, setContextSidebarMode] = useState<DictionaryContextSidebarMode>(() =>
    window.matchMedia('(max-width: 1199px)').matches ? 'compact' : 'expanded',
  );
  const overviewRequestIdRef = useRef(0);
  const pendingHistoryNavigationRef = useRef<(() => void) | null>(null);
  const dirty = useMemo(
    () => (detail && draft ? JSON.stringify(toDraft(detail)) !== JSON.stringify(draft) : false),
    [detail, draft],
  );
  useEffect(() => {
    if (!active || appliedLocationKeyRef.current === locationKey) return;
    appliedLocationKeyRef.current = locationKey;
    if (location.surface === 'overview') {
      setSurface('overview');
      setSelectedId('');
      setBrowseContext(null);
      setDetail(null);
      setDetailLocale(null);
      setDraft(null);
      return;
    }
    if (location.surface === 'classifications') {
      setSurface('classifications');
      setSelectedId('');
      setBrowseContext(null);
      setDetail(null);
      setDetailLocale(null);
      setDraft(null);
      return;
    }
    const keepLoadedTerm = detail?.id === location.termId;
    setSelectedId(location.termId);
    setBrowseContext(location.browseContext);
    if (!keepLoadedTerm) {
      setDetail(null);
      setDetailLocale(null);
    }
    setDetailLoadError('');
    setDetailLoading(true);
    setDraft((current) => (location.surface === 'edit' && current?.termId === location.termId ? current : null));
    setSurface(location.surface);
  }, [active, locationKey]);

  useEffect(() => {
    if (!active || surface !== 'edit' || !dirty) {
      onHistoryNavigationGuardChange(null);
      return undefined;
    }
    const guard: HistoryNavigationGuard = (_direction, continueNavigation) => {
      pendingHistoryNavigationRef.current = continueNavigation;
      setPendingNavigation(null);
      setDiscardOpen(true);
      return true;
    };
    onHistoryNavigationGuardChange(guard);
    return () => onHistoryNavigationGuardChange(null);
  }, [active, dirty, onHistoryNavigationGuardChange, surface]);

  useEffect(() => {
    const requestId = ++overviewRequestIdRef.current;
    if (!active || surface !== 'overview') {
      setOverviewTermsLoading(false);
      setOverviewTermLoadError('');
      return;
    }
    setOverviewTermLoadError('');
    const timer = window.setTimeout(async () => {
      setOverviewTermsLoading(true);
      try {
        const items = await window.desktopApi.dictionarySearch({
          locale,
          query,
          facetValueIds: selectedFacets,
          termIds: selectedTermIds,
          excludeDrafts,
          excludeUncited,
          includeArchived,
        });
        if (requestId === overviewRequestIdRef.current) setOverviewTerms(items);
      } catch (reason) {
        if (requestId === overviewRequestIdRef.current) {
          setOverviewTermLoadError(reason instanceof Error ? reason.message : String(reason));
        }
      } finally {
        if (requestId === overviewRequestIdRef.current) setOverviewTermsLoading(false);
      }
    }, 160);
    return () => {
      window.clearTimeout(timer);
      if (requestId === overviewRequestIdRef.current) overviewRequestIdRef.current += 1;
    };
  }, [
    active,
    data,
    excludeDrafts,
    excludeUncited,
    includeArchived,
    locale,
    query,
    selectedFacets,
    selectedTermIds,
    surface,
  ]);

  useEffect(() => {
    if (!active || surface === 'overview' || surface === 'classifications' || !selectedId) {
      setDetailLoading(false);
      setDetailLoadError('');
      return;
    }
    if (detail?.id === selectedId && detailLocale === locale) {
      setDetailLoading(false);
      setDetailLoadError('');
      if (surface === 'edit' && (!draft || draft.termId !== selectedId)) setDraft(toDraft(detail));
      return;
    }
    let alive = true;
    setDetailLoading(true);
    setDetailLoadError('');
    void window.desktopApi
      .dictionaryGet(selectedId, locale)
      .then((term) => {
        if (!alive) return;
        setDetail(term);
        setDetailLocale(locale);
        if (surface === 'edit') {
          setDraft((current) => (current?.termId === term.id ? current : toDraft(term)));
        }
      })
      .catch((reason) => {
        if (alive) setDetailLoadError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (alive) setDetailLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [active, detailReloadKey, locale, selectedId, surface]);

  useEffect(() => {
    if (surface === 'overview' || surface === 'classifications' || !detail || browseContext) return;
    setBrowseContext(deriveDictionaryBrowseContext(detail, data.categories));
  }, [browseContext, data.categories, detail, surface]);

  const siblingPage = useDictionarySiblingPage(locale, browseContext);
  const siblingBreadcrumb = useMemo(
    () =>
      browseContext
        ? dictionaryBrowseBreadcrumb(browseContext, data.categories, messages.dictionary.wordPalette.uncategorized)
        : null,
    [browseContext, data.categories, messages.dictionary.wordPalette.uncategorized],
  );
  const siblingTerms = useMemo(
    () =>
      detail && !siblingPage.terms.some((term) => term.id === detail.id)
        ? [detail, ...siblingPage.terms]
        : siblingPage.terms,
    [detail, siblingPage.terms],
  );
  const siblingTotal = Math.max(siblingPage.total, siblingTerms.length);
  const siblingCopy = messages.dictionary.relatedTerms;

  useEffect(() => {
    if (detail) siblingPage.updateTerm(detail);
  }, [detail, siblingPage.updateTerm]);

  const availableAssets = useMemo(() => {
    const byId = new Map<string, AssetDto>();
    for (const series of data.series) {
      for (const version of series.versions) {
        for (const run of version.runs) if (run.asset) byId.set(run.asset.id, run.asset);
      }
    }
    return [...byId.values()];
  }, [data.series]);

  const dictionaryTerms = useMemo(() => {
    const byId = new Map<string, TermListItem>();
    for (const term of data.terms) byId.set(term.id, term);
    for (const term of overviewTerms) byId.set(term.id, term);
    if (detail) byId.set(detail.id, detail);
    return [...byId.values()];
  }, [data.terms, detail, overviewTerms]);

  const filterCount =
    selectedFacets.length +
    Number(excludeDrafts) +
    Number(excludeUncited) +
    Number(includeArchived) +
    Number(selectedTermIds.length > 0);
  const setDraftField = <K extends keyof TermDraftInput>(key: K, value: TermDraftInput[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  const toggleFacet = (valueId: string) =>
    setSelectedFacets((current) =>
      current.includes(valueId) ? current.filter((id) => id !== valueId) : [...current, valueId],
    );

  function commitDictionaryLocation(nextLocation: DictionaryLocation, mode: NavigationMode = 'push') {
    appliedLocationKeyRef.current = navigationLocationKey(nextLocation);
    onNavigate(nextLocation, mode);
  }

  function openClassifications() {
    setSurface('classifications');
    commitDictionaryLocation({ surface: 'classifications', classificationId: null });
  }

  function selectClassification(classificationId: string | null, mode: NavigationMode = 'push') {
    commitDictionaryLocation({ surface: 'classifications', classificationId }, mode);
  }

  function openTermFromOverview(term: TermListItem, context: DictionaryBrowseContext) {
    setSelectedId(term.id);
    setBrowseContext(context);
    setDetail(null);
    setDetailLocale(null);
    setDetailLoadError('');
    setDetailLoading(true);
    setDraft(null);
    setSurface('detail');
    commitDictionaryLocation({ surface: 'detail', termId: term.id, browseContext: context });
  }

  function openSiblingTerm(termId: string) {
    if (termId === selectedId || busy) return;
    requestNavigation({ kind: 'term', termId });
  }

  function openTerm(termId: string, resetContext = false) {
    const nextBrowseContext = resetContext ? null : browseContext;
    setSelectedId(termId);
    if (resetContext) setBrowseContext(null);
    setSurface('detail');
    setDetail(null);
    setDetailLocale(null);
    setDetailLoadError('');
    setDetailLoading(true);
    setDraft(null);
    commitDictionaryLocation({ surface: 'detail', termId, browseContext: nextBrowseContext });
  }

  function performNavigation(target: DictionaryNavigationTarget) {
    if (target.kind === 'overview') {
      setSurface('overview');
      commitDictionaryLocation({ surface: 'overview' });
      return;
    }
    if (target.kind === 'detail') {
      onNavigateBack();
      return;
    }
    openTerm(target.termId, target.resetContext);
  }

  function requestNavigation(target: DictionaryNavigationTarget) {
    if (surface === 'edit' && dirty) {
      setPendingNavigation(target);
      setDiscardOpen(true);
      return;
    }
    performNavigation(target);
  }

  function retryDetail() {
    setDetailLoadError('');
    setDetailLoading(true);
    setDetailReloadKey((current) => current + 1);
  }

  function returnToDetail() {
    requestNavigation({ kind: 'detail' });
  }

  function discardEdits() {
    const target = pendingNavigation ?? { kind: 'detail' as const };
    const continueHistoryNavigation = pendingHistoryNavigationRef.current;
    pendingHistoryNavigationRef.current = null;
    if (detail) setDraft(toDraft(detail));
    setDiscardOpen(false);
    setPendingNavigation(null);
    if (continueHistoryNavigation) {
      continueHistoryNavigation();
      return;
    }
    performNavigation(target);
  }

  function toggleSelection(selected: boolean, term: TermListItem) {
    setSelectionTermIds((current) =>
      selected ? (current.includes(term.id) ? current : [...current, term.id]) : current.filter((id) => id !== term.id),
    );
  }

  function editTerm() {
    if (!detail) return;
    setDraft(toDraft(detail));
    setSurface('edit');
    commitDictionaryLocation({ surface: 'edit', termId: detail.id, browseContext });
  }

  function runBusyMutation<T>(mutate: () => Promise<T>, onSuccess: (result: T) => void | Promise<void>) {
    return runDictionaryMutation({
      setPending: setBusy,
      mutate,
      onSuccess,
      notify,
      fallbackError: c.operationFailed,
    });
  }

  async function save() {
    if (!draft) return false;
    return runBusyMutation(
      () => window.desktopApi.dictionarySaveDraft({ draft, locale }),
      async (result) => {
        setDetail(result);
        setDetailLocale(locale);
        setDraft(toDraft(result));
        await refresh();
        notify(c.saved);
      },
    );
  }

  async function saveAndNavigate() {
    const target = pendingNavigation;
    const continueHistoryNavigation = pendingHistoryNavigationRef.current;
    if ((!target && !continueHistoryNavigation) || !(await save())) return;
    pendingHistoryNavigationRef.current = null;
    setDiscardOpen(false);
    setPendingNavigation(null);
    if (continueHistoryNavigation) continueHistoryNavigation();
    else if (target) performNavigation(target);
  }

  async function approve() {
    if (!draft) return;
    await runBusyMutation(
      async () => {
        if (dirty || (!detail?.hasDraft && detail?.editorialState === 'DRAFT')) {
          await window.desktopApi.dictionarySaveDraft({ draft, locale });
        }
        return window.desktopApi.dictionaryApprove(draft.termId, locale);
      },
      async (result) => {
        const nextBrowseContext = deriveDictionaryBrowseContext(result, data.categories);
        setDetail(result);
        setDetailLocale(locale);
        setDraft(toDraft(result));
        setBrowseContext(nextBrowseContext);
        await refresh();
        notify(c.approvedNotice);
        setSurface('detail');
        commitDictionaryLocation({ surface: 'detail', termId: result.id, browseContext: nextBrowseContext }, 'replace');
      },
    );
  }

  async function withdrawApproval() {
    if (!detail) return;
    await runBusyMutation(
      () => window.desktopApi.dictionaryWithdrawApproval(detail.id, locale),
      async (result) => {
        setDetail(result);
        setDetailLocale(locale);
        setDraft(toDraft(result));
        await refresh();
        notify(c.withdrawnNotice);
      },
    );
  }

  async function setArchived(archived: boolean) {
    if (!detail) return;
    await runBusyMutation(
      () => window.desktopApi.dictionarySetArchived(detail.id, archived, locale),
      async (result) => {
        setDetail(result);
        setDetailLocale(locale);
        setDraft(toDraft(result));
        await refresh();
        notify(archived ? c.deletedNotice : c.restoredNotice);
      },
    );
  }

  async function chooseImport() {
    if (importPreparing) return;
    setImportPreparing(true);
    try {
      const result = await window.desktopApi.dictionaryChooseImport();
      if (result) setPreview(result);
    } catch (reason) {
      notify(dictionaryMutationError(reason, c.operationFailed));
    } finally {
      setImportPreparing(false);
    }
  }

  async function commitImport() {
    if (!preview) return;
    await runBusyMutation(
      () => window.desktopApi.dictionaryCommitImport(preview.batchId),
      async (result) => {
        setPreview(null);
        await refresh();
        notify(`${result.imported} ${c.imported}`);
      },
    );
  }

  async function openMaintenance() {
    setMaintenanceOpen(true);
    setMaintenanceBusy(true);
    setMaintenanceError('');
    try {
      const reports = await window.desktopApi.dictionaryMaintenanceList({ locale, limit: 8 });
      if (reports.length) {
        setMaintenanceReports(reports);
      } else {
        const report = await window.desktopApi.dictionaryMaintenanceCreate({ locale });
        setMaintenanceReports([report]);
      }
    } catch (reason) {
      setMaintenanceError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setMaintenanceBusy(false);
    }
  }

  async function refreshMaintenance() {
    if (maintenanceBusy) return;
    setMaintenanceBusy(true);
    setMaintenanceError('');
    try {
      const report = await window.desktopApi.dictionaryMaintenanceCreate({ locale });
      setMaintenanceReports((current) => [report, ...current.filter((item) => item.id !== report.id)].slice(0, 8));
    } catch (reason) {
      setMaintenanceError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setMaintenanceBusy(false);
    }
  }

  async function createdTerm(term: TermEditorDto) {
    const nextDraft = toDraft(term);
    const nextBrowseContext = deriveDictionaryBrowseContext(term, data.categories);
    setQuery('');
    setSelectedFacets([]);
    setSelectedTermIds([]);
    setExcludeDrafts(false);
    setExcludeUncited(false);
    setIncludeArchived(false);
    setFilterOpen(false);
    setSelectedId(term.id);
    setBrowseContext(nextBrowseContext);
    setDetail(term);
    setDetailLocale(locale);
    setDraft(nextDraft);
    setSurface('edit');
    commitDictionaryLocation({
      surface: 'edit',
      termId: term.id,
      browseContext: nextBrowseContext,
    });
    await refresh();
    notify(notices.newDraft);
  }

  function updateMedia(termId: string, media: TermMediaItemDto[]) {
    const mediaPreview = { totalCount: media.length, items: media.slice(0, 3) };
    setDetail((current) => (current?.id === termId ? { ...current, media, mediaPreview } : current));
    setOverviewTerms((current) => current.map((term) => (term.id === termId ? { ...term, mediaPreview } : term)));
  }

  async function mutateMedia(termId: string, operation: () => Promise<TermMediaItemDto[]>, notice: string) {
    await runDictionaryMutation({
      setPending: setMediaBusy,
      mutate: operation,
      onSuccess: async (media) => {
        updateMedia(termId, media);
        await refresh();
        notify(notice);
      },
      notify,
      fallbackError: c.operationFailed,
    });
  }

  async function addMedia(assetIds: string[]) {
    if (!detail || !assetIds.length) return;
    const termId = detail.id;
    await mutateMedia(termId, () => window.desktopApi.dictionaryAddMedia({ termId, assetIds }), c.imageAdded);
  }

  async function importMedia() {
    try {
      const selection = await window.desktopApi.assetsChooseReferences();
      if (selection.assets.length) await addMedia(selection.assets.map((asset) => asset.id));
    } catch (reason) {
      notify(dictionaryMutationError(reason, c.operationFailed));
    }
  }

  async function setMediaCover(mediaId: string) {
    if (!detail) return;
    const termId = detail.id;
    await mutateMedia(termId, () => window.desktopApi.dictionarySetMediaCover(mediaId), c.imageAdded);
  }

  async function removeMedia(mediaId: string) {
    if (!detail) return;
    const termId = detail.id;
    await mutateMedia(termId, () => window.desktopApi.dictionaryRemoveMedia(mediaId), c.imageRemoved);
  }

  async function reorderMedia(mediaIds: string[]) {
    if (!detail) return;
    const termId = detail.id;
    await mutateMedia(termId, () => window.desktopApi.dictionaryReorderMedia({ termId, mediaIds }), c.imageAdded);
  }

  return (
    <div className="relative size-full min-h-0 overflow-hidden bg-background">
      <section
        className={surface === 'overview' ? 'flex size-full min-h-0 flex-col' : 'hidden'}
        aria-hidden={surface !== 'overview'}
      >
        <DictionaryToolbar
          copy={c}
          termCount={overviewTerms.length}
          query={query}
          filterOpen={filterOpen}
          filterCount={filterCount}
          facets={data.facets}
          selectedFacets={selectedFacets}
          selectedTermCount={selectedTermIds.length}
          excludeDrafts={excludeDrafts}
          excludeUncited={excludeUncited}
          includeArchived={includeArchived}
          maintenanceLabel={c.maintenanceCandidates}
          classificationsLabel={c.classificationManagement}
          importPreparing={importPreparing}
          onQueryChange={setQuery}
          onFilterOpenChange={setFilterOpen}
          onFacetToggle={toggleFacet}
          onExcludeDraftsChange={setExcludeDrafts}
          onExcludeUncitedChange={setExcludeUncited}
          onIncludeArchivedChange={setIncludeArchived}
          onClearFilters={() => {
            setSelectedFacets([]);
            setSelectedTermIds([]);
            setExcludeDrafts(false);
            setExcludeUncited(false);
            setIncludeArchived(false);
          }}
          onClearTermFilter={() => setSelectedTermIds([])}
          onNewTerm={() => {
            setNewTermClassification(null);
            setNewTermOpen(true);
          }}
          onImport={() => void chooseImport()}
          onMaintenance={() => void openMaintenance()}
          onClassifications={openClassifications}
        />
        <TermOverview
          locale={locale}
          terms={dictionaryTerms}
          visibleTerms={overviewTerms}
          focusTermId={selectedId}
          facets={data.facets}
          categories={data.categories}
          palettes={data.wordPalettes}
          selectedTermIds={selectionTermIds}
          loading={overviewTermsLoading}
          loadError={overviewTermLoadError}
          onOpenTerm={openTermFromOverview}
          onSelectionChange={setSelectionTermIds}
          onFilter={(termIds) => {
            setSelectedTermIds(termIds);
            notify(notices.filtered(termIds.length));
          }}
          onPaletteCreated={() => {
            void refresh();
            notify(notices.recipeSaved);
          }}
          onPaletteChanged={async (action) => {
            await refresh();
            const actionNotices = {
              updated: notices.recipeUpdated,
              archived: notices.recipeArchived,
              restored: notices.recipeRestored,
              deleted: notices.recipeDeleted,
            };
            notify(actionNotices[action]);
          }}
          notify={notify}
        />
      </section>

      {(surface === 'detail' || surface === 'edit') && (
        <div className="flex size-full min-h-0 overflow-hidden">
          <DictionaryContextSidebar
            mode={contextSidebarMode}
            breadcrumb={{
              overview: messages.dictionary.overview.words,
              path: siblingBreadcrumb?.path ?? [],
            }}
            copy={siblingCopy}
            terms={siblingTerms}
            total={siblingTotal}
            currentTermId={selectedId}
            initialLoading={siblingPage.initialLoading}
            loadingMore={siblingPage.loadingMore}
            hasMore={siblingPage.hasMore}
            loadError={siblingPage.error}
            onModeChange={setContextSidebarMode}
            onBack={() => requestNavigation({ kind: 'overview' })}
            onSelect={openSiblingTerm}
            onLoadMore={siblingPage.loadMore}
            notify={notify}
          />
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {surface === 'detail' && (
              <TermDetailView
                className="size-full"
                term={detail}
                locale={locale}
                selected={Boolean(detail && selectionTermIds.includes(detail.id))}
                loading={detailLoading}
                error={detailLoadError}
                onRetry={retryDetail}
                onBack={() => requestNavigation({ kind: 'overview' })}
                showBack={false}
                onSelectedChange={toggleSelection}
                onEdit={() => editTerm()}
                notify={notify}
              />
            )}

            {surface === 'edit' && (
              <TermEditor
                copy={c}
                locale={locale}
                categories={data.categories}
                detail={detail}
                draft={draft}
                dirty={Boolean(dirty)}
                busy={busy}
                mediaBusy={mediaBusy}
                mediaFocusKey={0}
                availableAssets={availableAssets}
                onSet={setDraftField}
                onBack={returnToDetail}
                onSave={() => void save()}
                onApprove={() => void approve()}
                onWithdraw={() => void withdrawApproval()}
                onArchive={() => void setArchived(true)}
                onRestore={() => void setArchived(false)}
                onAddMedia={addMedia}
                onImportMedia={importMedia}
                onSetMediaCover={setMediaCover}
                onRemoveMedia={removeMedia}
                onReorderMedia={reorderMedia}
              />
            )}
          </div>
        </div>
      )}

      {surface === 'classifications' && (
        <DictionaryClassificationScreen
          locale={locale}
          selectedClassificationId={location.surface === 'classifications' ? location.classificationId : null}
          onSelectedClassificationIdChange={selectClassification}
          onBack={() => requestNavigation({ kind: 'overview' })}
          onOpenTerm={(termId) => openTerm(termId, true)}
          onCreateTerm={(classificationId, classificationPath) => {
            setNewTermClassification({ id: classificationId, path: classificationPath });
            setNewTermOpen(true);
          }}
          refresh={refresh}
          notify={notify}
        />
      )}

      <NewTermDialog
        locale={locale}
        open={newTermOpen}
        classificationId={newTermClassification?.id}
        classificationPath={newTermClassification?.path}
        onOpenChange={(open) => {
          setNewTermOpen(open);
          if (!open) setNewTermClassification(null);
        }}
        onCreated={(term) => void createdTerm(term)}
      />
      <DictionaryMaintenanceDialog
        open={maintenanceOpen}
        locale={locale}
        reports={maintenanceReports}
        busy={maintenanceBusy}
        error={maintenanceError}
        onOpenChange={setMaintenanceOpen}
        onRefresh={refreshMaintenance}
        onOpenTerm={(termId) => {
          setMaintenanceOpen(false);
          requestNavigation({ kind: 'term', termId, resetContext: true });
        }}
      />
      <ImportPreviewDialog
        preview={preview}
        busy={busy}
        onClose={() => setPreview(null)}
        onCommit={() => void commitImport()}
      />
      <Dialog
        open={discardOpen}
        onOpenChange={(open) => {
          setDiscardOpen(open);
          if (!open) {
            pendingHistoryNavigationRef.current = null;
            setPendingNavigation(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{c.discardEditTitle}</DialogTitle>
            <DialogDescription>{c.discardEditDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                pendingHistoryNavigationRef.current = null;
                setDiscardOpen(false);
                setPendingNavigation(null);
              }}
            >
              {c.continueEditing}
            </Button>
            <Button type="button" disabled={busy} onClick={() => void saveAndNavigate()}>
              {c.saveAndContinue}
            </Button>
            <Button type="button" variant="destructive" onClick={discardEdits}>
              {c.discardChanges}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
