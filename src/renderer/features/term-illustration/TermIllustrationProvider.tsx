import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  AssetDto,
  GenerationQuality,
  ImageGenerationRouteDto,
  Locale,
  TermEditorDto,
  TermIllustrationBatchDto,
  TermIllustrationListDto,
  TermIllustrationPurpose,
  TermIllustrationRunDto,
} from '@/shared/contracts';
import { imageGenerationPromptProfileId } from '@/shared/image-generation-prompt-profile';
import { resolveTermExpression } from '@/shared/term-localization';
import { useI18n } from '@/renderer/i18n/useI18n';

interface TermIllustrationProviderProps {
  term: TermEditorDto;
  locale: Locale;
  routes: ImageGenerationRouteDto[];
  availableAssets: AssetDto[];
  mediaBusy: boolean;
  onAddMedia(assetIds: string[], role: TermIllustrationPurpose): Promise<void>;
  onImportMedia(role: TermIllustrationPurpose): Promise<void>;
  onTermMediaChanged(): Promise<void>;
  onOpenCreation(seriesId: string, assetId: string | null, versionId: string | null): void;
  notify(message: string): void;
  children: ReactNode;
}

interface TermIllustrationContextValue {
  term: TermEditorDto;
  locale: Locale;
  routes: ImageGenerationRouteDto[];
  selectedRoute: ImageGenerationRouteDto | null;
  routeKey: string;
  setRouteKey(value: string): void;
  quality: GenerationQuality;
  setQuality(value: GenerationQuality): void;
  qualities: GenerationQuality[];
  count: number;
  setCount(value: number): void;
  purpose: TermIllustrationPurpose;
  setPurpose(value: TermIllustrationPurpose): void;
  history: TermIllustrationListDto;
  candidates: Array<{ batch: TermIllustrationBatchDto; run: TermIllustrationRunDto }>;
  activeRuns: Array<{ batch: TermIllustrationBatchDto; run: TermIllustrationRunDto }>;
  loaded: boolean;
  loading: boolean;
  actionBusy: boolean;
  loadError: string;
  blockedReason: string | null;
  pickerOpen: boolean;
  pickerBusy: boolean;
  pickerAssets: AssetDto[];
  existingAssetIds: string[];
  notify(message: string): void;
  setPickerOpen(open: boolean): void;
  openMaterialPicker(): Promise<void>;
  addPickedMedia(assetIds: string[]): Promise<void>;
  importMedia(): Promise<void>;
  reload(): Promise<void>;
  start(): Promise<void>;
  cancel(runId: string): Promise<void>;
  adopt(batchRunId: string, role: TermIllustrationPurpose): Promise<void>;
  dismiss(batchRunId: string): Promise<void>;
  openCreation(batch: TermIllustrationBatchDto, run?: TermIllustrationRunDto): void;
}

const TermIllustrationContext = createContext<TermIllustrationContextValue | null>(null);

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function routeCandidates(routes: ImageGenerationRouteDto[]) {
  const ready = routes.filter((route) => route.state === 'READY' && route.capabilities.includes('GENERATE'));
  const publicRoutes = ready.filter((route) => !route.internal);
  return publicRoutes.length ? publicRoutes : ready;
}

function routeQualities(route: ImageGenerationRouteDto | null): GenerationQuality[] {
  if (!route || route.qualityMode === 'PROVIDER_MANAGED' || !route.supportedQualities.length) return ['low'];
  return route.supportedQualities;
}

export function TermIllustrationProvider({
  term,
  locale,
  routes,
  availableAssets,
  mediaBusy,
  onAddMedia,
  onImportMedia,
  onTermMediaChanged,
  onOpenCreation,
  notify,
  children,
}: TermIllustrationProviderProps) {
  const { messages } = useI18n();
  const copy = messages.dictionary.detail.illustration;
  const selectableRoutes = useMemo(() => routeCandidates(routes), [routes]);
  const [routeKey, setRouteKey] = useState(selectableRoutes[0]?.key ?? '');
  const [quality, setQuality] = useState<GenerationQuality>('low');
  const [count, setCount] = useState(1);
  const [purpose, setPurpose] = useState<TermIllustrationPurpose>(term.media.length ? 'RELATED' : 'COVER');
  const [history, setHistory] = useState<TermIllustrationListDto>({ batches: [] });
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [libraryAssets, setLibraryAssets] = useState<AssetDto[]>([]);
  const requestRevision = useRef(0);
  const knownRunIds = useRef(new Set<string>());

  const selectedRoute = selectableRoutes.find((route) => route.key === routeKey) ?? selectableRoutes[0] ?? null;
  const qualities = useMemo(() => routeQualities(selectedRoute), [selectedRoute]);

  useEffect(() => {
    if (!selectableRoutes.some((route) => route.key === routeKey)) setRouteKey(selectableRoutes[0]?.key ?? '');
  }, [routeKey, selectableRoutes]);

  useEffect(() => {
    if (!qualities.includes(quality)) setQuality(qualities[0] ?? 'low');
  }, [qualities, quality]);

  useEffect(() => {
    setPurpose(term.media.length ? 'RELATED' : 'COVER');
    setLibraryAssets([]);
    setPickerOpen(false);
  }, [term.id, term.media.length]);

  const reload = useCallback(async () => {
    const revision = ++requestRevision.current;
    setLoaded(true);
    setLoading(true);
    setLoadError('');
    try {
      const result = await window.desktopApi.termIllustrationsList({ termId: term.id, locale, limit: 20 });
      if (requestRevision.current === revision) setHistory(result);
    } catch (reason) {
      if (requestRevision.current === revision) setLoadError(errorMessage(reason));
    } finally {
      if (requestRevision.current === revision) setLoading(false);
    }
  }, [locale, term.id]);

  useEffect(() => {
    return () => {
      requestRevision.current += 1;
    };
  }, []);

  useEffect(() => {
    knownRunIds.current = new Set(history.batches.flatMap((batch) => batch.runs.map((run) => run.generationRunId)));
  }, [history]);

  useEffect(
    () =>
      window.desktopApi.onGenerationChanged((event) => {
        if (!knownRunIds.current.has(event.runId)) return;
        if (event.terminal) {
          void reload();
          return;
        }
        const task = event.tasks.find((candidate) => candidate.runId === event.runId);
        if (!task) return;
        setHistory((current) => ({
          batches: current.batches.map((batch) => ({
            ...batch,
            runs: batch.runs.map((run) =>
              run.generationRunId === event.runId
                ? { ...run, status: task.status, phase: task.phase, progress: task.progress }
                : run,
            ),
          })),
        }));
      }),
    [reload],
  );

  const promptProfileId = selectedRoute ? imageGenerationPromptProfileId(selectedRoute) : '';
  const compatibleExpression = selectedRoute ? resolveTermExpression(term, promptProfileId, locale) : null;
  const blockedReason =
    term.editorialState !== 'APPROVED'
      ? copy.blockedApproval
      : term.hasDraft
        ? copy.blockedDraft
        : !selectedRoute
          ? copy.noReadyRoute
          : !compatibleExpression
            ? copy.blockedExpression
            : null;

  const candidates = useMemo(
    () =>
      history.batches.flatMap((batch) =>
        batch.runs.flatMap((run) =>
          batch.termRevisionId === term.termRevisionId &&
          run.status === 'SUCCEEDED' &&
          run.asset &&
          run.decision === 'PENDING'
            ? [{ batch, run }]
            : [],
        ),
      ),
    [history, term.termRevisionId],
  );
  const activeRuns = useMemo(
    () =>
      history.batches.flatMap((batch) =>
        batch.runs.flatMap((run) => (run.status === 'QUEUED' || run.status === 'RUNNING' ? [{ batch, run }] : [])),
      ),
    [history],
  );

  async function runAction(action: () => Promise<void>) {
    setActionBusy(true);
    try {
      await action();
    } catch (reason) {
      notify(`${copy.operationFailed}: ${errorMessage(reason)}`);
    } finally {
      setActionBusy(false);
    }
  }

  async function start() {
    if (!selectedRoute || blockedReason) return;
    await runAction(async () => {
      try {
        await window.desktopApi.termIllustrationsStart({
          termId: term.id,
          expectedTermRevisionId: term.termRevisionId,
          routeKey: selectedRoute.key,
          quality,
          purpose,
          count,
          locale,
        });
        notify(copy.generatedNotice);
      } finally {
        await reload();
      }
    });
  }

  async function cancel(runId: string) {
    await runAction(async () => {
      await window.desktopApi.generationCancel(runId);
      notify(copy.cancelledNotice);
    });
  }

  async function adopt(batchRunId: string, role: TermIllustrationPurpose) {
    await runAction(async () => {
      const result = await window.desktopApi.termIllustrationsAdopt({ batchRunId, role });
      await reload();
      await onTermMediaChanged();
      notify(result.decision === 'ADOPTED_COVER' ? copy.coverNotice : copy.relatedNotice);
    });
  }

  async function dismiss(batchRunId: string) {
    await runAction(async () => {
      await window.desktopApi.termIllustrationsDismiss({ batchRunId });
      await reload();
      notify(copy.dismissedNotice);
    });
  }

  async function openMaterialPicker() {
    setPickerOpen(true);
    setPickerLoading(true);
    try {
      const page = await window.desktopApi.galleryList({
        locale,
        source: 'ALL',
        unratedDimensions: [],
        cursor: null,
        limit: 60,
      });
      setLibraryAssets(page.items.map((item) => item.asset));
    } catch (reason) {
      notify(`${copy.operationFailed}: ${errorMessage(reason)}`);
    } finally {
      setPickerLoading(false);
    }
  }

  async function addPickedMedia(assetIds: string[]) {
    await onAddMedia(assetIds, purpose);
  }

  async function importMedia() {
    await onImportMedia(purpose);
  }

  const pickerAssets = useMemo(() => {
    const byId = new Map<string, AssetDto>();
    for (const asset of [...availableAssets, ...libraryAssets]) byId.set(asset.id, asset);
    return [...byId.values()];
  }, [availableAssets, libraryAssets]);

  const value: TermIllustrationContextValue = {
    term,
    locale,
    routes: selectableRoutes,
    selectedRoute,
    routeKey,
    setRouteKey,
    quality,
    setQuality,
    qualities,
    count,
    setCount,
    purpose,
    setPurpose,
    history,
    candidates,
    activeRuns,
    loaded,
    loading,
    actionBusy,
    loadError,
    blockedReason,
    pickerOpen,
    pickerBusy: mediaBusy || pickerLoading,
    pickerAssets,
    existingAssetIds: term.media.map((item) => item.asset.id),
    notify,
    setPickerOpen,
    openMaterialPicker,
    addPickedMedia,
    importMedia,
    reload,
    start,
    cancel,
    adopt,
    dismiss,
    openCreation: (batch, run) => {
      if (batch.seriesId) onOpenCreation(batch.seriesId, run?.asset?.id ?? null, batch.promptVersionId);
    },
  };

  return <TermIllustrationContext.Provider value={value}>{children}</TermIllustrationContext.Provider>;
}

export function useTermIllustration() {
  const context = useContext(TermIllustrationContext);
  if (!context) throw new Error('Term illustration components require TermIllustrationProvider');
  return context;
}
