import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesktopApi } from '@/shared/contracts';
import type {
  CodexVisualizationArtifactDto,
  CodexVisualizationDateRange,
  CodexVisualizationFilter,
  CodexVisualizationHtmlPreviewDto,
  CodexVisualizationMermaidPreviewDto,
  CodexVisualizationSnapshotDto,
} from '@/shared/contracts/codex-visualizations';
import { isCodexMermaidArtifact } from '@/renderer/features/extensions/codexVisualizationArtifacts';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  type CodexVisualizationThreadDiagramDateSelection,
  readCodexVisualizationFavoriteIds,
  readCodexVisualizationHiddenIds,
  readCodexVisualizationThreadDiagramDateSelection,
  resolveCodexVisualizationThreadDiagramDateSelection,
  setCodexVisualizationFavorite,
  setCodexVisualizationHidden,
  setCodexVisualizationThreadDiagramDateSelection,
} from '@/renderer/features/extensions/codexVisualizationPreferences';

const PAGE_SIZE = 12;

interface Options {
  active: boolean;
  authorized: boolean;
  threadContentAuthorized: boolean;
  standalone: boolean;
  notify(message: string): void;
}

interface HtmlPreviewState {
  kind: 'HTML';
  artifact: CodexVisualizationArtifactDto;
  access: CodexVisualizationHtmlPreviewDto;
}

interface MermaidPreviewState {
  kind: 'MERMAID';
  artifact: CodexVisualizationArtifactDto;
  access: CodexVisualizationMermaidPreviewDto;
}

type PreviewState = HtmlPreviewState | MermaidPreviewState;

async function prepareArtifactPreview(api: DesktopApi, artifact: CodexVisualizationArtifactDto): Promise<PreviewState> {
  if (isCodexMermaidArtifact(artifact)) {
    return {
      kind: 'MERMAID',
      artifact,
      access: await api.codexVisualizationPrepareMermaidPreview({ artifactId: artifact.id }),
    };
  }
  return {
    kind: 'HTML',
    artifact,
    access: await api.codexVisualizationPrepareHtmlPreview({ artifactId: artifact.id }),
  };
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function sameDateRange(left: CodexVisualizationDateRange | null, right: CodexVisualizationDateRange | null) {
  return left?.from === right?.from && left?.to === right?.to;
}

function dateSelectionState(selection: CodexVisualizationThreadDiagramDateSelection, threadContentAuthorized: boolean) {
  const captured: CodexVisualizationThreadDiagramDateSelection =
    selection.kind === 'CUSTOM' ? { kind: 'CUSTOM', range: { ...selection.range } } : { ...selection };
  const range = threadContentAuthorized ? resolveCodexVisualizationThreadDiagramDateSelection(captured) : null;
  return [captured, range] as const;
}

function readDateSelectionState(threadContentAuthorized: boolean) {
  return dateSelectionState(readCodexVisualizationThreadDiagramDateSelection(), threadContentAuthorized);
}

async function performArtifactAction<T>(
  key: string,
  artifact: CodexVisualizationArtifactDto,
  action: (input: { artifactId: string }) => Promise<T>,
  setBusyKey: (value: string) => void,
  setError: (value: string) => void,
) {
  setBusyKey(key);
  setError('');
  try {
    return await action({ artifactId: artifact.id });
  } catch (reason) {
    setError(errorMessage(reason));
    return null;
  } finally {
    setBusyKey('');
  }
}

export function useCodexVisualizationDiscovery({
  active,
  authorized,
  threadContentAuthorized,
  standalone,
  notify,
}: Options) {
  const api = window.desktopApi;
  const l = useI18n().messages.extensions.codexVisualizationDiscovery;
  const [snapshot, setSnapshot] = useState<CodexVisualizationSnapshotDto | null>(null);
  const [filter, setFilter] = useState<CodexVisualizationFilter>('VISIBLE');
  const [threadDiagramDateRange, setThreadDiagramDateRange] = useState<CodexVisualizationDateRange | null>(null);
  const [threadDiagramDateSelection, setDateSelection] = useState(readCodexVisualizationThreadDiagramDateSelection);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(readCodexVisualizationFavoriteIds);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(readCodexVisualizationHiddenIds);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const pageRef = useRef(1);
  const filterRef = useRef<CodexVisualizationFilter>('VISIBLE');
  const threadDiagramDateRangeRef = useRef<CodexVisualizationDateRange | null>(null);
  const favoriteIdsRef = useRef(favoriteIds);
  const hiddenIdsRef = useRef(hiddenIds);
  const loadRequestRef = useRef(0);
  const previewRequestRef = useRef(0);
  const previewRef = useRef<PreviewState | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);

  const load = useCallback(
    async (
      requestedPage = pageRef.current,
      showLoading = true,
      refresh = false,
      requestedFilter = filterRef.current,
      requestedHiddenIds = hiddenIdsRef.current,
      requestedFavoriteIds = favoriteIdsRef.current,
      requestedThreadDiagramDateRange = threadDiagramDateRangeRef.current,
    ) => {
      if (!authorized) return;
      const requestId = ++loadRequestRef.current;
      if (showLoading) setLoading(true);
      setError('');
      try {
        const next = await api.codexVisualizationsList({
          filter: requestedFilter,
          page: requestedPage,
          pageSize: PAGE_SIZE,
          hiddenSessionIds: [...requestedHiddenIds],
          favoriteSessionIds: [...requestedFavoriteIds],
          threadDiagramDateRange: requestedThreadDiagramDateRange,
          refresh,
        });
        if (requestId !== loadRequestRef.current) return;
        setSnapshot(next);
        pageRef.current = next.page;
        filterRef.current = next.filter;
        setFilter(next.filter);
        threadDiagramDateRangeRef.current = next.threadDiagramDateRange;
        setThreadDiagramDateRange(next.threadDiagramDateRange);
      } catch (reason) {
        if (requestId === loadRequestRef.current) setError(errorMessage(reason));
      } finally {
        if (showLoading && requestId === loadRequestRef.current) setLoading(false);
      }
    },
    [api, authorized],
  );

  const releasePreview = useCallback(
    (current: PreviewState) => {
      if (current.kind === 'HTML') {
        void api.codexVisualizationReleaseHtmlPreview({ previewId: current.access.previewId }).catch(() => undefined);
      }
    },
    [api],
  );

  const closePreview = useCallback(() => {
    previewRequestRef.current += 1;
    const current = previewRef.current;
    previewRef.current = null;
    setPreview(null);
    if (current) releasePreview(current);
  }, [releasePreview]);

  useEffect(() => {
    if (!active || !authorized) {
      loadRequestRef.current += 1;
      closePreview();
      setSnapshot(null);
      setFilter('VISIBLE');
      setThreadDiagramDateRange(null);
      setLoading(false);
      setBusyKey('');
      setError('');
      pageRef.current = 1;
      filterRef.current = 'VISIBLE';
      threadDiagramDateRangeRef.current = null;
      return;
    }
    loadRequestRef.current += 1;
    closePreview();
    const [nextSelection, nextRange] = readDateSelectionState(threadContentAuthorized);
    pageRef.current = 1;
    filterRef.current = 'VISIBLE';
    threadDiagramDateRangeRef.current = nextRange;
    setSnapshot(null);
    setFilter('VISIBLE');
    setDateSelection(nextSelection);
    setThreadDiagramDateRange(nextRange);
    void load(1, true, false, 'VISIBLE', hiddenIdsRef.current, favoriteIdsRef.current, nextRange);
    const unsubscribe = api.onCodexVisualizationsChanged(() => {
      void load(pageRef.current, false, false, filterRef.current);
    });
    return () => {
      unsubscribe();
      previewRequestRef.current += 1;
      const current = previewRef.current;
      previewRef.current = null;
      if (current) releasePreview(current);
    };
  }, [active, api, authorized, closePreview, load, releasePreview, threadContentAuthorized]);

  async function runArtifactAction<T>(
    key: string,
    artifact: CodexVisualizationArtifactDto,
    action: (input: { artifactId: string }) => Promise<T>,
  ): Promise<T | null> {
    return performArtifactAction(key, artifact, action, setBusyKey, setError);
  }

  async function previewArtifact(artifact: CodexVisualizationArtifactDto) {
    const requestId = ++previewRequestRef.current;
    setBusyKey(`preview:${artifact.id}`);
    setError('');
    try {
      const next = await prepareArtifactPreview(api, artifact);
      if (requestId !== previewRequestRef.current) {
        releasePreview(next);
        return;
      }
      const previous = previewRef.current;
      previewRef.current = next;
      setPreview(next);
      if (previous) releasePreview(previous);
    } catch (reason) {
      if (requestId === previewRequestRef.current) setError(errorMessage(reason));
    } finally {
      if (requestId === previewRequestRef.current) setBusyKey('');
    }
  }

  async function openArtifact(artifact: CodexVisualizationArtifactDto) {
    await runArtifactAction(`open:${artifact.id}`, artifact, (input) => api.codexVisualizationOpen(input));
  }

  async function openCodex(sessionId: string) {
    setBusyKey(`codex:${sessionId}`);
    setError('');
    try {
      await api.codexOpenThread(sessionId);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyKey('');
    }
  }

  async function exportArtifact(artifact: CodexVisualizationArtifactDto) {
    const result = await runArtifactAction(`export:${artifact.id}`, artifact, (input) =>
      api.codexVisualizationExport(input),
    );
    if (result?.canceled === false) notify(l.notices.exportedResult);
  }

  async function exportSession(sessionId: string) {
    setBusyKey(`export-session:${sessionId}`);
    setError('');
    try {
      const result = await api.codexVisualizationExportSession({ sessionId });
      if (!result.canceled) notify(l.notices.exportedSession(result.exportedFileCount));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyKey('');
    }
  }

  function setFavorite(sessionId: string, favorite: boolean) {
    const next = new Set(favoriteIdsRef.current);
    if (favorite) next.add(sessionId);
    else next.delete(sessionId);
    favoriteIdsRef.current = next;
    setFavoriteIds(next);
    setCodexVisualizationFavorite(sessionId, favorite);
    void load(pageRef.current, false, false, filterRef.current, hiddenIdsRef.current, next);
  }

  function setHidden(sessionId: string, hidden: boolean) {
    const next = new Set(hiddenIdsRef.current);
    if (hidden) next.add(sessionId);
    else next.delete(sessionId);
    hiddenIdsRef.current = next;
    setHiddenIds(next);
    setCodexVisualizationHidden(sessionId, hidden);
    void load(pageRef.current, false, false, filterRef.current, next, favoriteIdsRef.current);
  }

  function changeFilter(nextFilter: CodexVisualizationFilter) {
    pageRef.current = 1;
    filterRef.current = nextFilter;
    setFilter(nextFilter);
    void load(1, true, false, nextFilter);
  }

  function changeThreadDiagramDateSelection(nextSelection: CodexVisualizationThreadDiagramDateSelection) {
    const [capturedSelection, capturedRange] = dateSelectionState(nextSelection, threadContentAuthorized);
    const rangeChanged = !sameDateRange(threadDiagramDateRangeRef.current, capturedRange);
    setCodexVisualizationThreadDiagramDateSelection(capturedSelection);
    setDateSelection(capturedSelection);
    if (!rangeChanged) return;
    closePreview();
    pageRef.current = 1;
    threadDiagramDateRangeRef.current = capturedRange;
    setSnapshot(null);
    setThreadDiagramDateRange(capturedRange);
    void load(1, true, true, filterRef.current, hiddenIdsRef.current, favoriteIdsRef.current, capturedRange);
  }

  async function changePage(page: number) {
    await load(page, true);
    if (standalone) contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    else sectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  return {
    snapshot,
    filter,
    threadDiagramDateRange,
    threadDiagramDateSelection,
    favoriteIds,
    hiddenIds,
    loading,
    busy: loading || Boolean(busyKey),
    error,
    preview,
    contentRef,
    sectionRef,
    visibleCount: snapshot ? snapshot.totalSessionCount - snapshot.hiddenSessionCount : 0,
    load,
    runArtifactAction,
    previewArtifact,
    closePreview,
    openArtifact,
    openCodex,
    exportArtifact,
    exportSession,
    setFavorite,
    setHidden,
    changeFilter,
    changeThreadDiagramDateSelection,
    changePage,
  };
}
