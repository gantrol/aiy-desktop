import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ImagesIcon,
  ImportIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CodexGeneratedImageDto,
  CodexImageDiscoveryFilter,
  CodexImageDiscoverySnapshotDto,
  ExtensionDto,
} from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { CodexImageTaskGroup, type CodexImageTaskGroupData } from '@/renderer/features/extensions/CodexImageTaskGroup';

interface Props {
  active: boolean;
  extension: ExtensionDto;
  standalone?: boolean;
  standaloneHeadingLevel?: 'h1' | 'h2';
  notify(message: string): void;
  onOpenCreation(seriesId: string, assetId: string | null): Promise<void>;
}

const PAGE_SIZE = 24;

export function CodexImageDiscoveryConfiguration({
  active,
  extension,
  standalone = false,
  standaloneHeadingLevel = 'h1',
  notify,
  onOpenCreation,
}: Props) {
  const { locale, messages } = useI18n();
  const l = messages.extensions.codexImageDiscovery;
  const [snapshot, setSnapshot] = useState<CodexImageDiscoverySnapshotDto | null>(null);
  const [filter, setFilter] = useState<CodexImageDiscoveryFilter>('NOT_IN_LIBRARY');
  const [includeUntitled, setIncludeUntitled] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const pageRef = useRef(1);
  const filterRef = useRef<CodexImageDiscoveryFilter>('NOT_IN_LIBRARY');
  const includeUntitledRef = useRef(false);
  const loadRequestRef = useRef(0);
  const sectionRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const authorized =
    extension.enabled &&
    extension.compatible &&
    extension.permissions.every((permission) => !permission.required || permission.granted);

  async function load(
    requestedPage = pageRef.current,
    showLoading = true,
    refresh = false,
    requestedFilter = filterRef.current,
    requestedIncludeUntitled = includeUntitledRef.current,
  ) {
    if (!authorized) return;
    const requestId = ++loadRequestRef.current;
    if (showLoading) setLoading(true);
    setError('');
    try {
      const next = await window.desktopApi.codexGeneratedImagesList({
        filter: requestedFilter,
        includeUntitled: requestedIncludeUntitled,
        page: requestedPage,
        pageSize: PAGE_SIZE,
        refresh,
      });
      if (requestId !== loadRequestRef.current) return;
      setSnapshot(next);
      pageRef.current = next.page;
      filterRef.current = next.filter;
      includeUntitledRef.current = next.includeUntitled;
      setFilter(next.filter);
      setIncludeUntitled(next.includeUntitled);
      const selectableIds = new Set(
        next.images.filter((image) => image.importable && !image.imported).map((image) => image.id),
      );
      setSelectedIds((current) => new Set([...current].filter((id) => selectableIds.has(id))));
    } catch (reason) {
      if (requestId === loadRequestRef.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (showLoading && requestId === loadRequestRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (!active || !authorized) {
      loadRequestRef.current += 1;
      setSnapshot(null);
      setFilter('NOT_IN_LIBRARY');
      setIncludeUntitled(false);
      setSelectedIds(new Set());
      setLoading(false);
      pageRef.current = 1;
      filterRef.current = 'NOT_IN_LIBRARY';
      includeUntitledRef.current = false;
      return;
    }
    pageRef.current = 1;
    filterRef.current = 'NOT_IN_LIBRARY';
    includeUntitledRef.current = false;
    setFilter('NOT_IN_LIBRARY');
    setIncludeUntitled(false);
    void load(1, true, false, 'NOT_IN_LIBRARY', false);
    return window.desktopApi.onCodexGeneratedImagesChanged(() => {
      void load(pageRef.current, false, false, filterRef.current);
    });
  }, [active, authorized]);

  const selectedImages = useMemo(
    () => snapshot?.images.filter((image) => selectedIds.has(image.id)) ?? [],
    [selectedIds, snapshot],
  );
  const taskGroups = useMemo(() => {
    const groups: CodexImageTaskGroupData[] = [];
    const byThreadId = new Map<string, CodexImageTaskGroupData>();
    for (const image of snapshot?.images ?? []) {
      const existing = byThreadId.get(image.threadId);
      if (existing) {
        existing.images.push(image);
        continue;
      }
      const group = {
        threadId: image.threadId,
        threadName: image.threadName,
        threadTitleAvailable: image.threadTitleAvailable,
        images: [image],
      };
      groups.push(group);
      byThreadId.set(image.threadId, group);
    }
    return groups;
  }, [snapshot]);

  function toggleImage(image: CodexGeneratedImageDto) {
    if (!image.importable || image.imported || importing || loading) return;
    setError('');
    if (selectedIds.has(image.id)) {
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(image.id);
        return next;
      });
      return;
    }
    const selectedThreadId = selectedImages[0]?.threadId;
    if (selectedThreadId && selectedThreadId !== image.threadId) {
      setError(l.sameTaskSelection);
      return;
    }
    if (selectedIds.size >= 8) {
      setError(l.maxSelection);
      return;
    }
    setSelectedIds(new Set([...selectedIds, image.id]));
  }

  function selectTask(images: readonly CodexGeneratedImageDto[]) {
    const ids = images.slice(0, 8).map((image) => image.id);
    if (ids.length > 0 && ids.every((id) => selectedIds.has(id))) {
      setSelectedIds(new Set());
      return;
    }
    setError('');
    const selectedThreadId = selectedImages[0]?.threadId;
    if (selectedThreadId && selectedThreadId !== images[0]?.threadId) {
      setError(l.sameTaskSelection);
      return;
    }
    setSelectedIds(new Set(ids));
  }

  async function openCodex(threadId: string) {
    setError('');
    try {
      await window.desktopApi.codexOpenThread(threadId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function openCreation(seriesId: string, assetId: string | null) {
    setError('');
    try {
      await onOpenCreation(seriesId, assetId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function importSelected() {
    if (!selectedIds.size) return;
    setImporting(true);
    setError('');
    try {
      const result = await window.desktopApi.codexGeneratedImagesImport({
        discoveryIds: [...selectedIds],
        locale,
      });
      setSelectedIds(new Set());
      await load(pageRef.current, false);
      notify(l.notices.imported(result.importedCount));
      await onOpenCreation(result.seriesId, result.assetIds[0] ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setImporting(false);
    }
  }

  async function recoverImage(image: CodexGeneratedImageDto) {
    if (!image.recoveryTarget || importing || loading) return;
    setImporting(true);
    setError('');
    try {
      const result = await window.desktopApi.codexGeneratedImagesRecover({ discoveryId: image.id });
      setSelectedIds(new Set());
      await load(pageRef.current, false);
      notify(l.notices.recovered);
      await onOpenCreation(result.seriesId, result.assetId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setImporting(false);
    }
  }

  async function changePage(nextPage: number) {
    setSelectedIds(new Set());
    await load(nextPage, true, false, filterRef.current);
    if (standalone) contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    else sectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function changeFilter(nextFilter: CodexImageDiscoveryFilter) {
    filterRef.current = nextFilter;
    pageRef.current = 1;
    setFilter(nextFilter);
    setSelectedIds(new Set());
    void load(1, true, false, nextFilter);
  }

  function changeUntitledVisibility(nextIncludeUntitled: boolean) {
    includeUntitledRef.current = nextIncludeUntitled;
    pageRef.current = 1;
    setIncludeUntitled(nextIncludeUntitled);
    setSelectedIds(new Set());
    setError('');
    void load(1, true, false, filterRef.current, nextIncludeUntitled);
  }

  const Heading = standalone ? standaloneHeadingLevel : 'h3';

  return (
    <section
      ref={sectionRef}
      data-codex-image-discovery-configuration
      data-load-state={error ? 'error' : active && authorized && (loading || !snapshot) ? 'loading' : 'ready'}
      className={cn(
        'overflow-hidden bg-background',
        standalone ? 'flex size-full min-h-0 flex-col' : 'rounded-lg border',
      )}
    >
      <header
        className={cn(
          'flex flex-wrap items-center gap-2 border-b',
          standalone ? 'min-h-14 shrink-0 px-5 py-2' : 'px-4 py-3',
        )}
      >
        <ImagesIcon className="size-4" />
        <Heading className={cn('font-semibold', standalone ? 'text-base' : 'text-sm')}>{l.title}</Heading>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={l.actions.refresh}
            title={l.actions.refresh}
            disabled={!authorized || loading || importing}
            onClick={() => void load(pageRef.current, true, true)}
          >
            {loading ? <LoaderCircleIcon className="size-4 animate-spin" /> : <RefreshCwIcon className="size-4" />}
          </Button>
          <Button
            type="button"
            size="sm"
            data-action="codex-images-import"
            disabled={!selectedIds.size || importing || loading}
            onClick={() => void importSelected()}
          >
            {importing ? <LoaderCircleIcon className="size-4 animate-spin" /> : <ImportIcon className="size-4" />}
            {importing
              ? l.actions.importing
              : selectedIds.size > 0
                ? l.actions.importToCreation(selectedIds.size)
                : l.actions.importSelected}
          </Button>
        </div>
      </header>

      {authorized && snapshot?.rootPath && (
        <div className="flex min-w-0 items-center gap-3 border-b bg-surface-sunken/40 px-4 py-2 text-xs">
          <span className="shrink-0 text-muted-foreground">{l.root}</span>
          <code className="min-w-0 flex-1 truncate" title={snapshot.rootPath}>
            {snapshot.rootPath}
          </code>
          <span className="shrink-0 tabular-nums text-muted-foreground">{l.files(snapshot.fileCount)}</span>
        </div>
      )}

      {authorized && snapshot?.available && (
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5">
          <Segmented
            type="single"
            value={filter}
            aria-label={l.filters.label}
            onValueChange={(value) => value && changeFilter(value as CodexImageDiscoveryFilter)}
          >
            <SegmentedItem value="NOT_IN_LIBRARY" disabled={loading || importing}>
              {l.filters.notInLibrary(snapshot.unimportedCount)}
            </SegmentedItem>
            <SegmentedItem value="IN_LIBRARY" disabled={loading || importing}>
              {l.filters.inLibrary(snapshot.inLibraryCount)}
            </SegmentedItem>
            <SegmentedItem value="ALL" disabled={loading || importing}>
              {l.filters.all(snapshot.totalCount)}
            </SegmentedItem>
          </Segmented>
          <div className="ml-auto flex items-center gap-3">
            {snapshot.untitledThreadCount > 0 && (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={includeUntitled}
                  disabled={loading || importing}
                  onCheckedChange={(checked) => changeUntitledVisibility(checked === true)}
                />
                <span>{l.filters.showUntitled(snapshot.untitledThreadCount)}</span>
              </label>
            )}
            <span className="text-xs tabular-nums text-muted-foreground">{l.matches(snapshot.filteredCount)}</span>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="border-b bg-destructive/5 px-4 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <div ref={contentRef} className={cn('p-4', standalone && 'min-h-0 flex-1 overflow-y-auto')}>
        {loading && !snapshot && (
          <div className="grid min-h-32 place-items-center">
            <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {!loading && (!authorized || snapshot?.available === false) && (
          <div className="grid min-h-32 place-items-center text-sm text-muted-foreground">{l.unavailable}</div>
        )}
        {!loading && authorized && snapshot?.available && snapshot.images.length === 0 && (
          <div className="grid min-h-32 place-items-center text-sm text-muted-foreground">
            {filter === 'NOT_IN_LIBRARY' ? l.emptyNotInLibrary : filter === 'IN_LIBRARY' ? l.emptyInLibrary : l.empty}
          </div>
        )}
        {authorized && snapshot?.available && taskGroups.length > 0 && (
          <div className="grid gap-4">
            {taskGroups.map((group) => (
              <CodexImageTaskGroup
                key={group.threadId}
                group={group}
                selectedIds={selectedIds}
                busy={importing || loading}
                onToggleImage={toggleImage}
                onSelectTask={selectTask}
                onOpenCodex={(threadId) => void openCodex(threadId)}
                onOpenCreation={(seriesId, assetId) => void openCreation(seriesId, assetId)}
                onRecoverImage={(image) => void recoverImage(image)}
              />
            ))}
          </div>
        )}
        {snapshot && snapshot.pageCount > 1 && (
          <div className="mt-4 flex items-center justify-center gap-3 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || importing || snapshot.page <= 1}
              onClick={() => void changePage(snapshot.page - 1)}
            >
              <ChevronLeftIcon className="size-4" />
              {l.actions.previous}
            </Button>
            <span className="min-w-32 text-center text-xs tabular-nums text-muted-foreground">
              {l.page(snapshot.page, snapshot.pageCount)} · {l.perPage(snapshot.pageSize)} ·{' '}
              {l.matches(snapshot.filteredCount)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || importing || snapshot.page >= snapshot.pageCount}
              onClick={() => void changePage(snapshot.page + 1)}
            >
              {l.actions.next}
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
