import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EllipsisIcon,
  EyeIcon,
  FileDiffIcon,
  HistoryIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  RotateCcwIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ArticleDto, ArticleRevisionDto, ArticleRevisionSummaryDto } from '@/shared/contracts';
import { ArticleReferenceDocument } from '@/renderer/components/creator/article-editor/ArticleEditorComparison';
import { ArticleHeaderIconButton } from '@/renderer/components/creator/article-editor/ArticleEditorHeader';
import { useArticleEditorSession } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { diffPromptText } from '@/renderer/components/creator/generationComparisonUtils';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';

const REVISION_PAGE_SIZE = 50;

type RevisionView = 'diff' | 'preview';
type TextDiffPart = ReturnType<typeof diffPromptText>[number];
type DisplayDiffPart = TextDiffPart | { type: 'omitted' };

const DIFF_CONTEXT_CHARACTERS = 160;
const DIFF_CONTEXT_LINE_BREAKS = 2;
const MINIMUM_OMITTED_CHARACTERS = 48;

function versionLabel(revisionNo: number, zh: boolean) {
  return zh ? `版本 ${revisionNo}` : `Version ${revisionNo}`;
}

function revisionTimestamp(createdAt: string, zh: boolean) {
  const timestamp = new Date(createdAt);
  if (Number.isNaN(timestamp.getTime())) return createdAt;
  return new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
}

function mergeRevisionPages(
  current: readonly ArticleRevisionSummaryDto[],
  incoming: readonly ArticleRevisionSummaryDto[],
) {
  const revisions = new Map(current.map((revision) => [revision.revisionId, revision]));
  incoming.forEach((revision) => revisions.set(revision.revisionId, revision));
  return [...revisions.values()].sort((left, right) => right.revisionNo - left.revisionNo);
}

function useRevisionIndex(articleId: string, currentRevisionId: string, open: boolean) {
  const [revisions, setRevisions] = useState<ArticleRevisionSummaryDto[]>([]);
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const [resolvedCurrentRevisionId, setResolvedCurrentRevisionId] = useState(currentRevisionId);
  const [nextBeforeRevisionNo, setNextBeforeRevisionNo] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestRef = useRef(0);

  const loadPage = useCallback(
    async (beforeRevisionNo: number | null, selection: 'current' | 'older' | 'none') => {
      const request = ++requestRef.current;
      setLoading(true);
      setFailed(false);
      try {
        const result = await window.desktopApi.articleRevisionHistory({
          articleId,
          beforeRevisionNo,
          limit: REVISION_PAGE_SIZE,
        });
        if (requestRef.current !== request) return;
        if (result.articleId !== articleId) throw new Error('Article revision history identity mismatch');
        setRevisions((current) =>
          beforeRevisionNo === null ? result.revisions : mergeRevisionPages(current, result.revisions),
        );
        setResolvedCurrentRevisionId(result.currentRevisionId);
        setNextBeforeRevisionNo(result.nextBeforeRevisionNo);
        if (selection === 'current') {
          const current = result.revisions.find((revision) => revision.revisionId === result.currentRevisionId);
          setSelectedRevisionId(current?.revisionId ?? result.revisions[0]?.revisionId ?? null);
        } else if (selection === 'older') {
          setSelectedRevisionId(result.revisions[0]?.revisionId ?? null);
        }
      } catch {
        if (requestRef.current === request) setFailed(true);
      } finally {
        if (requestRef.current === request) setLoading(false);
      }
    },
    [articleId],
  );

  useEffect(() => {
    if (!open) {
      requestRef.current += 1;
      return;
    }
    setRevisions([]);
    setSelectedRevisionId(null);
    setResolvedCurrentRevisionId(currentRevisionId);
    setNextBeforeRevisionNo(null);
    setFailed(false);
    void loadPage(null, 'current');
    return () => {
      requestRef.current += 1;
    };
  }, [currentRevisionId, loadPage, open]);

  const selectedIndex = revisions.findIndex((revision) => revision.revisionId === selectedRevisionId);
  const loadOlder = useCallback(
    async (selectFirst: boolean) => {
      if (loading || nextBeforeRevisionNo === null) return;
      await loadPage(nextBeforeRevisionNo, selectFirst ? 'older' : 'none');
    },
    [loadPage, loading, nextBeforeRevisionNo],
  );
  const selectOlder = useCallback(async () => {
    setFailed(false);
    const older = revisions[selectedIndex + 1];
    if (older) setSelectedRevisionId(older.revisionId);
    else await loadOlder(true);
  }, [loadOlder, revisions, selectedIndex]);
  const selectNewer = useCallback(() => {
    setFailed(false);
    const newer = revisions[selectedIndex - 1];
    if (newer) setSelectedRevisionId(newer.revisionId);
  }, [revisions, selectedIndex]);
  const selectRevision = useCallback((revisionId: string) => {
    setFailed(false);
    setSelectedRevisionId(revisionId);
  }, []);

  return {
    failed,
    loading,
    nextBeforeRevisionNo,
    resolvedCurrentRevisionId,
    revisions,
    selectedRevisionId,
    selectedRevision: selectedIndex >= 0 ? (revisions[selectedIndex] ?? null) : null,
    olderRevision: selectedIndex >= 0 ? (revisions[selectedIndex + 1] ?? null) : null,
    canSelectNewer: selectedIndex > 0,
    canSelectOlder: selectedIndex >= 0 && (selectedIndex < revisions.length - 1 || nextBeforeRevisionNo !== null),
    loadOlder,
    reload: () => loadPage(null, 'current'),
    selectNewer,
    selectOlder,
    selectRevision,
  };
}

function useRevisionSnapshot(articleId: string, revisionId: string | null, open: boolean) {
  const [snapshot, setSnapshot] = useState<ArticleRevisionDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retryRevision, setRetryRevision] = useState(0);
  const requestRef = useRef(0);
  const cacheRef = useRef(new Map<string, ArticleRevisionDto>());

  useEffect(() => {
    cacheRef.current.clear();
  }, [articleId]);

  useEffect(() => {
    if (!open || !revisionId) {
      requestRef.current += 1;
      setSnapshot(null);
      return;
    }
    const cached = cacheRef.current.get(revisionId);
    if (cached) {
      setSnapshot(cached);
      setFailed(false);
      setLoading(false);
      return;
    }
    const request = ++requestRef.current;
    setSnapshot(null);
    setFailed(false);
    setLoading(true);
    void window.desktopApi
      .articleRevisionGet({ articleId, revisionId })
      .then((revision) => {
        if (requestRef.current !== request) return;
        if (revision.articleId !== articleId || revision.revisionId !== revisionId) {
          throw new Error('Article revision identity mismatch');
        }
        cacheRef.current.set(revisionId, revision);
        setSnapshot(revision);
      })
      .catch(() => {
        if (requestRef.current === request) setFailed(true);
      })
      .finally(() => {
        if (requestRef.current === request) setLoading(false);
      });
    return () => {
      if (requestRef.current === request) requestRef.current += 1;
    };
  }, [articleId, open, retryRevision, revisionId]);

  return { failed, loading, snapshot, retry: () => setRetryRevision((current) => current + 1) };
}

type RevisionIndex = ReturnType<typeof useRevisionIndex>;
type RevisionSnapshot = ReturnType<typeof useRevisionSnapshot>;

function RevisionPicker({ disabled, index, zh }: { disabled: boolean; index: RevisionIndex; zh: boolean }) {
  const selected = index.selectedRevision;
  const previousLabel = zh ? '上一版本' : 'Previous version';
  const nextLabel = zh ? '下一版本' : 'Next version';
  return (
    <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled || !index.canSelectOlder || index.loading}
        aria-label={previousLabel}
        title={previousLabel}
        onClick={() => void index.selectOlder()}
      >
        <ChevronLeftIcon className="size-5" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="min-w-32 px-3 text-base font-semibold"
            disabled={disabled || !selected}
            aria-label={zh ? '选择历史版本' : 'Select version'}
          >
            {selected ? versionLabel(selected.revisionNo, zh) : zh ? '历史版本' : 'Version history'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="max-h-80 w-52 overflow-y-auto">
          {index.revisions.map((revision) => (
            <DropdownMenuItem key={revision.revisionId} onSelect={() => index.selectRevision(revision.revisionId)}>
              <DropdownMenuIcon>
                {revision.revisionId === index.selectedRevisionId ? <CheckIcon /> : null}
              </DropdownMenuIcon>
              <span>{versionLabel(revision.revisionNo, zh)}</span>
              {revision.revisionId === index.resolvedCurrentRevisionId ? (
                <span className="ml-auto text-xs text-muted-foreground">{zh ? '当前' : 'Current'}</span>
              ) : null}
            </DropdownMenuItem>
          ))}
          {index.nextBeforeRevisionNo !== null ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={index.loading} onSelect={() => void index.loadOlder(false)}>
                <DropdownMenuIcon>
                  {index.loading ? <LoaderCircleIcon className="animate-spin" /> : <ChevronLeftIcon />}
                </DropdownMenuIcon>
                {index.failed ? (zh ? '重试' : 'Retry') : zh ? '更早版本' : 'Earlier versions'}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled || !index.canSelectNewer || index.loading}
        aria-label={nextLabel}
        title={nextLabel}
        onClick={index.selectNewer}
      >
        <ChevronRightIcon className="size-5" />
      </Button>
    </div>
  );
}

function RevisionViewControl({
  value,
  zh,
  onChange,
}: {
  value: RevisionView;
  zh: boolean;
  onChange(view: RevisionView): void;
}) {
  return (
    <Segmented
      type="single"
      value={value}
      aria-label={zh ? '版本显示方式' : 'Version display'}
      onValueChange={(next) => next && onChange(next as RevisionView)}
    >
      <SegmentedItem value="diff">
        <FileDiffIcon className="mr-1.5 size-3.5" />
        {zh ? '差异' : 'Changes'}
      </SegmentedItem>
      <SegmentedItem value="preview">
        <EyeIcon className="mr-1.5 size-3.5" />
        {zh ? '预览' : 'Preview'}
      </SegmentedItem>
    </Segmented>
  );
}

function RetryButton({ label, onRetry }: { label: string; onRetry(): void }) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center">
      <Button type="button" variant="outline" onClick={onRetry}>
        <RefreshCwIcon className="size-4" />
        {label}
      </Button>
    </div>
  );
}

function LoadingRevision() {
  return <LoaderCircleIcon className="m-auto size-5 animate-spin text-muted-foreground" />;
}

function diffChanged(parts: readonly TextDiffPart[]) {
  return parts.some((part) => part.type !== 'equal');
}

function leadingDiffContext(value: string) {
  let end = Math.min(value.length, DIFF_CONTEXT_CHARACTERS);
  let lineBreaks = 0;
  for (let index = 0; index < end; index += 1) {
    if (value[index] !== '\n') continue;
    lineBreaks += 1;
    if (lineBreaks < DIFF_CONTEXT_LINE_BREAKS) continue;
    end = index + 1;
    break;
  }
  return value.slice(0, end);
}

function trailingDiffContext(value: string) {
  let start = Math.max(0, value.length - DIFF_CONTEXT_CHARACTERS);
  let lineBreaks = 0;
  for (let index = value.length - 1; index >= start; index -= 1) {
    if (value[index] !== '\n') continue;
    lineBreaks += 1;
    if (lineBreaks < DIFF_CONTEXT_LINE_BREAKS) continue;
    start = index + 1;
    break;
  }
  return value.slice(start);
}

function compressUnchangedDiffParts(parts: readonly TextDiffPart[]): DisplayDiffPart[] {
  const firstChange = parts.findIndex((part) => part.type !== 'equal');
  if (firstChange < 0) return [...parts];

  let lastChange = firstChange;
  parts.forEach((part, index) => {
    if (part.type !== 'equal') lastChange = index;
  });

  return parts.flatMap<DisplayDiffPart>((part, index) => {
    if (part.type !== 'equal') return [part];
    const leading = leadingDiffContext(part.value);
    const trailing = trailingDiffContext(part.value);
    if (index < firstChange && part.value.length - trailing.length >= MINIMUM_OMITTED_CHARACTERS) {
      return [{ type: 'omitted' }, { type: 'equal', value: trailing }];
    }
    if (index > lastChange && part.value.length - leading.length >= MINIMUM_OMITTED_CHARACTERS) {
      return [{ type: 'equal', value: leading }, { type: 'omitted' }];
    }
    if (
      index > firstChange &&
      index < lastChange &&
      part.value.length - leading.length - trailing.length >= MINIMUM_OMITTED_CHARACTERS
    ) {
      return [{ type: 'equal', value: leading }, { type: 'omitted' }, { type: 'equal', value: trailing }];
    }
    return [part];
  });
}

function RevisionDiffSection({ label, parts, zh }: { label: string; parts: readonly TextDiffPart[]; zh: boolean }) {
  const displayParts = compressUnchangedDiffParts(parts);
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{label}</h3>
      <div className="whitespace-pre-wrap break-words font-mono text-sm leading-7">
        {displayParts.map((part, index) =>
          part.type === 'omitted' ? (
            <span
              key={index}
              role="separator"
              aria-label={zh ? '已折叠未变化内容' : 'Unchanged content collapsed'}
              className="my-2 flex items-center gap-2 text-muted-foreground/60"
            >
              <span className="h-px flex-1 bg-border" />
              <EllipsisIcon aria-hidden="true" className="size-4 shrink-0" />
              <span className="h-px flex-1 bg-border" />
            </span>
          ) : part.type === 'equal' ? (
            <span key={index}>{part.value}</span>
          ) : (
            <span
              key={index}
              className={
                part.type === 'added'
                  ? 'rounded-sm bg-state-changed-bg text-state-changed-fg'
                  : 'rounded-sm bg-destructive/10 text-destructive line-through decoration-destructive/60'
              }
            >
              <span className="sr-only">
                {part.type === 'added' ? (zh ? '新增：' : 'Added: ') : zh ? '删除：' : 'Removed: '}
              </span>
              {part.value}
            </span>
          ),
        )}
      </div>
    </section>
  );
}

function mediaBindingKey(binding: ArticleRevisionDto['content']['mediaBindings'][number]) {
  return `${binding.path}\u0000${binding.assetId}`;
}

function mediaPathForAsset(revision: ArticleRevisionDto | null, assetId: string | null) {
  if (!assetId) return null;
  return revision?.content.mediaBindings.find((binding) => binding.assetId === assetId)?.path ?? assetId;
}

function RevisionMediaDiff({
  older,
  selected,
  zh,
}: {
  older: ArticleRevisionDto | null;
  selected: ArticleRevisionDto;
  zh: boolean;
}) {
  const olderBindings = new Map(
    (older?.content.mediaBindings ?? []).map((binding) => [mediaBindingKey(binding), binding]),
  );
  const selectedBindings = new Map(
    selected.content.mediaBindings.map((binding) => [mediaBindingKey(binding), binding]),
  );
  const removed = [...olderBindings].filter(([key]) => !selectedBindings.has(key)).map(([, binding]) => binding.path);
  const added = [...selectedBindings].filter(([key]) => !olderBindings.has(key)).map(([, binding]) => binding.path);
  const olderCover = mediaPathForAsset(older, older?.content.coverAssetId ?? null);
  const selectedCover = mediaPathForAsset(selected, selected.content.coverAssetId);
  const coverChanged = olderCover !== selectedCover;

  if (!removed.length && !added.length && !coverChanged) return null;
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{zh ? '媒体' : 'Media'}</h3>
      <div className="space-y-1 font-mono text-sm leading-6">
        {removed.map((path) => (
          <div key={`removed:${path}`} className="text-destructive line-through decoration-destructive/60">
            − {path}
          </div>
        ))}
        {added.map((path) => (
          <div key={`added:${path}`} className="text-state-changed-fg">
            + {path}
          </div>
        ))}
        {coverChanged ? (
          <div className="flex flex-wrap items-baseline gap-2 pt-1">
            <span className="font-sans text-xs text-muted-foreground">{zh ? '题图' : 'Cover'}</span>
            {olderCover ? <span className="text-destructive line-through">{olderCover}</span> : null}
            <span aria-hidden="true">→</span>
            <span className="text-state-changed-fg">{selectedCover ?? (zh ? '无' : 'None')}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ArticleRevisionTextDiff({
  older,
  selected,
  zh,
}: {
  older: ArticleRevisionDto | null;
  selected: ArticleRevisionDto;
  zh: boolean;
}) {
  const titleParts = useMemo(
    () => diffPromptText(older?.content.title ?? '', selected.content.title),
    [older?.content.title, selected.content.title],
  );
  const bodyParts = useMemo(
    () => diffPromptText(older?.content.markdown ?? '', selected.content.markdown),
    [older?.content.markdown, selected.content.markdown],
  );
  const titleChanged = diffChanged(titleParts);
  const bodyChanged = diffChanged(bodyParts);
  const mediaChanged =
    older?.content.coverAssetId !== selected.content.coverAssetId ||
    (older?.content.mediaBindings ?? []).some(
      (binding) =>
        !selected.content.mediaBindings.some((candidate) => mediaBindingKey(candidate) === mediaBindingKey(binding)),
    ) ||
    selected.content.mediaBindings.some(
      (binding) =>
        !(older?.content.mediaBindings ?? []).some(
          (candidate) => mediaBindingKey(candidate) === mediaBindingKey(binding),
        ),
    );
  const comparisonLabel = older
    ? `${versionLabel(older.revisionNo, zh)} → ${versionLabel(selected.revisionNo, zh)}`
    : zh
      ? '初始版本'
      : 'Initial version';

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="sticky top-0 z-10 flex min-h-10 items-center justify-between gap-4 border-b bg-background/95 px-5 text-xs backdrop-blur-sm">
        <span className="font-medium tabular-nums">{comparisonLabel}</span>
        <span className="flex items-center gap-3 text-muted-foreground">
          <span className="text-state-changed-fg">+ {zh ? '新增' : 'Added'}</span>
          <span className="text-destructive">− {zh ? '删除' : 'Removed'}</span>
        </span>
      </div>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-7 px-6 py-7 lg:px-8">
        {!titleChanged && !bodyChanged && !mediaChanged ? (
          <div className="grid min-h-60 place-items-center text-sm text-muted-foreground">
            {zh ? '无可见内容变化' : 'No visible content changes'}
          </div>
        ) : (
          <>
            {titleChanged ? <RevisionDiffSection label={zh ? '标题' : 'Title'} parts={titleParts} zh={zh} /> : null}
            {bodyChanged ? <RevisionDiffSection label={zh ? '正文' : 'Body'} parts={bodyParts} zh={zh} /> : null}
            {mediaChanged ? <RevisionMediaDiff older={older} selected={selected} zh={zh} /> : null}
          </>
        )}
      </div>
    </div>
  );
}

function RevisionPreview({ snapshot }: { snapshot: ArticleRevisionDto }) {
  return (
    <ArticleReferenceDocument
      articleId={snapshot.articleId}
      markdown={snapshot.content.markdown}
      media={snapshot.content.mediaAssets.map((asset) => ({ assetId: asset.id, mediaUrl: asset.mediaUrl }))}
      mediaBindings={snapshot.content.mediaBindings}
      title={snapshot.content.title}
    />
  );
}

function RevisionContent({
  index,
  older,
  selected,
  view,
  zh,
}: {
  index: RevisionIndex;
  older: RevisionSnapshot;
  selected: RevisionSnapshot;
  view: RevisionView;
  zh: boolean;
}) {
  const retryLabel = zh ? '重试' : 'Retry';
  if (index.failed && !index.revisions.length) {
    return <RetryButton label={retryLabel} onRetry={() => void index.reload()} />;
  }
  if (selected.failed) return <RetryButton label={retryLabel} onRetry={selected.retry} />;
  if (index.loading && !index.selectedRevisionId) return <LoadingRevision />;
  if (selected.loading || !selected.snapshot || !index.selectedRevision) return <LoadingRevision />;
  if (view === 'preview') return <RevisionPreview snapshot={selected.snapshot} />;

  const olderMissing = index.selectedRevision.revisionNo > 1 && !index.olderRevision;
  if (olderMissing && index.failed) {
    return <RetryButton label={retryLabel} onRetry={() => void index.loadOlder(false)} />;
  }
  if (older.failed) return <RetryButton label={retryLabel} onRetry={older.retry} />;
  if (olderMissing || older.loading || (index.olderRevision !== null && !older.snapshot)) return <LoadingRevision />;
  return <ArticleRevisionTextDiff older={older.snapshot} selected={selected.snapshot} zh={zh} />;
}

export function ArticleRevisionHistoryDialog({
  articleId,
  currentRevisionId,
  zh,
  onRestore,
}: {
  articleId: string;
  currentRevisionId: string;
  zh: boolean;
  onRestore?(revision: ArticleRevisionDto): Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<RevisionView>('diff');
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const index = useRevisionIndex(articleId, currentRevisionId, open);
  const selected = useRevisionSnapshot(articleId, index.selectedRevisionId, open);
  const older = useRevisionSnapshot(articleId, index.olderRevision?.revisionId ?? null, open && view === 'diff');
  const label = zh ? '历史版本' : 'Version history';
  const selectedIsCurrent = index.selectedRevisionId === index.resolvedCurrentRevisionId;

  useEffect(() => setRestoreFailed(false), [index.selectedRevisionId]);
  useEffect(() => {
    if (
      !open ||
      view !== 'diff' ||
      !index.selectedRevision ||
      index.selectedRevision.revisionNo <= 1 ||
      index.olderRevision ||
      index.loading ||
      index.failed ||
      index.nextBeforeRevisionNo === null
    ) {
      return;
    }
    void index.loadOlder(false);
  }, [index, open, view]);

  async function restoreSelectedRevision() {
    if (!onRestore || !selected.snapshot || restoring || selectedIsCurrent) return;
    const revision = selected.snapshot;
    setRestoring(true);
    setRestoreFailed(false);
    try {
      const restored = await onRestore(revision);
      if (restored) setOpen(false);
      else setRestoreFailed(true);
    } catch {
      setRestoreFailed(true);
    } finally {
      setRestoring(false);
    }
  }

  return (
    <>
      <ArticleHeaderIconButton type="button" variant="ghost" label={label} onClick={() => setOpen(true)}>
        <HistoryIcon className="size-4" />
      </ArticleHeaderIconButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="h-[min(48rem,calc(100vh-2rem))] max-w-5xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle className="sr-only">{label}</DialogTitle>
            <div className="flex items-center gap-3 pr-8">
              <RevisionPicker disabled={restoring} index={index} zh={zh} />
              <RevisionViewControl value={view} zh={zh} onChange={setView} />
            </div>
          </DialogHeader>
          <div className="flex min-h-0 min-w-0 overflow-hidden bg-background">
            <RevisionContent index={index} older={older} selected={selected} view={view} zh={zh} />
          </div>
          <DialogFooter className="min-h-14 flex-row items-center border-t px-4 py-3 sm:justify-between">
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {index.selectedRevision
                ? `${versionLabel(index.selectedRevision.revisionNo, zh)} · ${revisionTimestamp(index.selectedRevision.createdAt, zh)}`
                : label}
            </span>
            {onRestore ? (
              <Button
                type="button"
                variant={restoreFailed ? 'outline' : 'default'}
                disabled={!selected.snapshot || selectedIsCurrent || restoring}
                onClick={() => void restoreSelectedRevision()}
              >
                {restoring ? (
                  <LoaderCircleIcon className="size-4 animate-spin" />
                ) : (
                  <RotateCcwIcon className="size-4" />
                )}
                {restoreFailed
                  ? zh
                    ? '重试恢复'
                    : 'Retry restore'
                  : selectedIsCurrent
                    ? zh
                      ? '当前版本'
                      : 'Current version'
                    : zh
                      ? '恢复为新版本'
                      : 'Restore as new version'}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ArticleRevisionHistoryAction({
  article,
  notify,
  zh,
}: {
  article: Pick<ArticleDto, 'id' | 'revisionId'>;
  notify(message: string): void;
  zh: boolean;
}) {
  const session = useArticleEditorSession();

  async function restoreRevision(revision: ArticleRevisionDto) {
    try {
      const restored = await session.restoreRevision(revision);
      if (!restored) return false;
      const saved = session.capturePersistedArticle();
      notify(
        zh
          ? `已恢复版本 ${revision.revisionNo}，并保存为版本 ${saved.revisionNo}`
          : `Restored version ${revision.revisionNo} as version ${saved.revisionNo}`,
      );
      return true;
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }

  return (
    <ArticleRevisionHistoryDialog
      articleId={article.id}
      currentRevisionId={article.revisionId}
      zh={zh}
      onRestore={restoreRevision}
    />
  );
}
