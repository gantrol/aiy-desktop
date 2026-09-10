import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CodexHistoryArchiveFilter,
  CodexHistoryFilterOptions,
  CodexHistoryIndexState,
  CodexHistoryRoleFilter,
  CodexHistorySearchInput,
  CodexHistorySearchPage,
  CodexHistoryThreadOption,
  CodexUsageDateRange,
  CodexUsageRange,
} from '@/shared/contracts';

const INITIAL_INDEX_STATE: CodexHistoryIndexState = {
  status: 'EMPTY',
  progress: 0,
  indexedThreads: 0,
  indexedMessages: 0,
  updatedAt: null,
  message: null,
};
const INITIAL_FILTER_OPTIONS: CodexHistoryFilterOptions = {
  projects: [],
  sections: [],
  recentThreads: [],
  threads: [],
  threadsTruncated: false,
};
const PAGE_SIZE = 20;
const QUERY_DEBOUNCE_MS = 140;
type SearchCriteria = Omit<CodexHistorySearchInput, 'page'>;

interface Options {
  active: boolean;
  authorized: boolean;
  notify(message: string): void;
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolvedDateRange(range: CodexUsageRange, customRange: CodexUsageDateRange | null) {
  if (range === 'ALL') return null;
  if (range === 'CUSTOM') return customRange;
  const to = new Date();
  to.setHours(0, 0, 0, 0);
  const from = new Date(to);
  const days =
    range === 'TODAY'
      ? 1
      : range === 'LAST_24_HOURS'
        ? 2
        : range === 'LAST_7_DAYS'
          ? 7
          : range === 'LAST_30_DAYS'
            ? 30
            : 90;
  from.setDate(from.getDate() - (days - 1));
  return { from: dateKey(from), to: dateKey(to) };
}

function mergedPage(current: CodexHistorySearchPage | null, next: CodexHistorySearchPage, append: boolean) {
  if (!append || !current || next.page === 1) return next;
  const items = [...current.items];
  const known = new Set(items.map(({ threadId }) => threadId));
  for (const item of next.items) {
    if (!known.has(item.threadId)) items.push(item);
  }
  return { ...next, items };
}

function useSearchResults(
  active: boolean,
  authorized: boolean,
  criteria: SearchCriteria,
  onIndexChange: (index: CodexHistoryIndexState) => void,
) {
  const [snapshot, setSnapshot] = useState<CodexHistorySearchPage | null>(null);
  const [snapshotCriteria, setSnapshotCriteria] = useState<SearchCriteria | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRevision = useRef(0);

  const load = useCallback(
    async (nextPage: number, append = false) => {
      if (!active || !authorized) return;
      const revision = ++requestRevision.current;
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setLoadingMore(false);
      }
      setError(null);
      try {
        const next = await window.desktopApi.codexHistorySearch({ ...criteria, page: nextPage });
        if (requestRevision.current !== revision) return;
        setSnapshot((current) => mergedPage(current, next, append));
        setSnapshotCriteria(criteria);
        onIndexChange(next.index);
      } catch (reason) {
        if (requestRevision.current !== revision) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (requestRevision.current === revision) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [active, authorized, criteria, onIndexChange],
  );

  useEffect(() => {
    if (!active || !authorized) {
      requestRevision.current += 1;
      setSnapshot(null);
      setSnapshotCriteria(null);
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    // Keep the displayed results and thread preview until their replacement is ready.
    void load(1);
    return () => {
      requestRevision.current += 1;
    };
  }, [active, authorized, load]);

  return { snapshot, snapshotCriteria, loading, loadingMore, error, setError, load };
}

export function useCodexHistorySearch({ active, authorized, notify }: Options) {
  const [draftQuery, setDraftQuery] = useState('');
  const [query, setQuery] = useState('');
  const [archive, setArchive] = useState<CodexHistoryArchiveFilter>('ALL');
  const [role, setRole] = useState<CodexHistoryRoleFilter>('ALL');
  const [includeSubagents, setIncludeSubagents] = useState(false);
  const [projectId, setProjectIdState] = useState('');
  const [sectionId, setSectionIdState] = useState('');
  const [selectedThread, setSelectedThread] = useState<CodexHistoryThreadOption | null>(null);
  const [threadQuery, setThreadQuery] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [branch, setBranch] = useState('');
  const [range, setRange] = useState<CodexUsageRange>('ALL');
  const [dateRange, setDateRange] = useState<CodexUsageDateRange | null>(null);
  const [filterOptions, setFilterOptions] = useState<CodexHistoryFilterOptions>(INITIAL_FILTER_OPTIONS);
  const [index, setIndex] = useState<CodexHistoryIndexState>(INITIAL_INDEX_STATE);
  const [filtersLoading, setFiltersLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filtersError, setFiltersError] = useState<string | null>(null);
  const filtersRequestRevision = useRef(0);
  const stateRequestRevision = useRef(0);
  const loadMorePending = useRef(false);
  const effectiveDateRange = useMemo(() => resolvedDateRange(range, dateRange), [dateRange, range]);
  const criteria = useMemo<SearchCriteria>(
    () => ({
      query,
      archive,
      role,
      includeSubagents,
      projectId,
      sectionId,
      threadId: selectedThread?.threadId ?? '',
      workspace,
      branch,
      from: effectiveDateRange?.from ?? null,
      to: effectiveDateRange?.to ?? null,
      pageSize: PAGE_SIZE,
    }),
    [
      archive,
      branch,
      effectiveDateRange,
      includeSubagents,
      projectId,
      query,
      role,
      sectionId,
      selectedThread?.threadId,
      workspace,
    ],
  );
  const { snapshot, snapshotCriteria, loading, loadingMore, error, setError, load } = useSearchResults(
    active,
    authorized,
    criteria,
    setIndex,
  );
  const queryPending = draftQuery.trim() !== query;
  const hasMore = Boolean(
    active &&
    authorized &&
    !loading &&
    !queryPending &&
    snapshotCriteria === criteria &&
    snapshot &&
    snapshot.page < snapshot.pageCount,
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(draftQuery.trim()), QUERY_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draftQuery]);

  useEffect(() => {
    if (!active || !authorized) {
      filtersRequestRevision.current += 1;
      setFilterOptions(INITIAL_FILTER_OPTIONS);
      return;
    }
    const revision = ++filtersRequestRevision.current;
    const timer = window.setTimeout(() => {
      setFiltersLoading(true);
      setFiltersError(null);
      void window.desktopApi
        .codexHistorySearchFilterOptions({
          archive,
          includeSubagents,
          projectId,
          sectionId,
          query: threadQuery.trim(),
        })
        .then((next) => {
          if (filtersRequestRevision.current === revision) setFilterOptions(next);
        })
        .catch((reason) => {
          if (filtersRequestRevision.current !== revision) return;
          setFiltersError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => {
          if (filtersRequestRevision.current === revision) setFiltersLoading(false);
        });
    }, QUERY_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [active, archive, authorized, includeSubagents, index.updatedAt, projectId, sectionId, threadQuery]);

  useEffect(() => {
    if (!active || !authorized) return;
    let disposed = false;
    const unsubscribe = window.desktopApi.onCodexHistorySearchChanged(() => {
      const revision = ++stateRequestRevision.current;
      void window.desktopApi
        .codexHistorySearchState()
        .then((nextIndex) => {
          if (disposed || stateRequestRevision.current !== revision) return;
          setIndex(nextIndex);
          if (nextIndex.status !== 'INDEXING') void load(1);
        })
        .catch(() => undefined);
    });
    return () => {
      disposed = true;
      stateRequestRevision.current += 1;
      unsubscribe();
    };
  }, [active, authorized, load]);

  const refresh = useCallback(
    async (rebuild: boolean) => {
      if (!active || !authorized || refreshing) return;
      setRefreshing(true);
      setError(null);
      try {
        setIndex(await window.desktopApi.codexHistorySearchRefresh({ rebuild }));
        await load(1);
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(message);
        notify(message);
      } finally {
        setRefreshing(false);
      }
    },
    [active, authorized, load, notify, refreshing, setError],
  );

  const openThread = useCallback(
    async (threadId: string) => {
      try {
        await window.desktopApi.codexOpenThread(threadId);
      } catch (reason) {
        notify(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [notify],
  );

  const setProjectId = useCallback((nextProjectId: string) => {
    setProjectIdState(nextProjectId);
    setSectionIdState('');
    setSelectedThread(null);
    setThreadQuery('');
  }, []);

  const setSectionId = useCallback((nextSectionId: string) => {
    setSectionIdState(nextSectionId);
    setProjectIdState('');
    setSelectedThread(null);
    setThreadQuery('');
  }, []);

  const selectThread = useCallback((thread: CodexHistoryThreadOption | null) => {
    setSelectedThread(thread);
    setThreadQuery('');
  }, []);

  const setDateSelection = useCallback((nextRange: CodexUsageRange, nextDateRange: CodexUsageDateRange | null) => {
    setRange(nextRange);
    setDateRange(nextDateRange);
  }, []);

  const resetAdvancedFilters = useCallback(() => {
    setArchive('ALL');
    setRole('ALL');
    setIncludeSubagents(false);
    setWorkspace('');
    setBranch('');
  }, []);

  const loadMore = useCallback(async () => {
    if (loadMorePending.current || !hasMore || !snapshot || loadingMore) return;
    loadMorePending.current = true;
    try {
      await load(snapshot.page + 1, true);
    } finally {
      loadMorePending.current = false;
    }
  }, [hasMore, load, loadingMore, snapshot]);

  return {
    draftQuery,
    setDraftQuery,
    archive,
    setArchive,
    role,
    setRole,
    includeSubagents,
    setIncludeSubagents,
    projectId,
    setProjectId,
    sectionId,
    setSectionId,
    selectedThread,
    selectThread,
    threadQuery,
    setThreadQuery,
    workspace,
    setWorkspace,
    branch,
    setBranch,
    range,
    dateRange,
    setDateSelection,
    resetAdvancedFilters,
    snapshot,
    filterOptions,
    index,
    loading: loading || queryPending,
    loadingMore,
    filtersLoading,
    refreshing,
    error,
    filtersError,
    hasMore,
    loadMore,
    refresh,
    openThread,
  };
}
