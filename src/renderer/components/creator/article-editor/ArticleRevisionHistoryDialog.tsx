import { ContentWriteContextCell } from '@/renderer/features/content-provenance/ContentWriteContext';
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
import { useEffect, useMemo, useRef, useState } from 'react';
import { useArticleRevisionIndex } from '@/renderer/components/creator/article-editor/useArticleRevisionIndex';
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
import { useI18n } from '@/renderer/i18n/useI18n';
import { useReferenceHistory, historicalDisplayRevision } from '@/renderer/features/content-editor/useReferenceHistory';
import { fixedHistoryRevision } from '@/shared/reference-history-restore';
import type { ReferenceHistoryResult } from '@/shared/contracts/content-library';
import { referenceHistoryMessages } from '@/shared/i18n/reference-history';

type RevisionView = 'diff' | 'preview';
type TextDiffPart = ReturnType<typeof diffPromptText>[number];
type DisplayDiffPart = TextDiffPart | { type: 'omitted' };

const DIFF_CONTEXT_CHARACTERS = 160;
const DIFF_CONTEXT_LINE_BREAKS = 2;
const MINIMUM_OMITTED_CHARACTERS = 48;

function versionLabel(revisionNo: number, copy: typeof referenceHistoryMessages) {
  return copy.version.replace('{number}', String(revisionNo));
}

function revisionTimestamp(createdAt: string, zh: boolean) {
  const timestamp = new Date(createdAt);
  if (Number.isNaN(timestamp.getTime())) return createdAt;
  return new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
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

type RevisionIndex = ReturnType<typeof useArticleRevisionIndex>;
type RevisionSnapshot = ReturnType<typeof useRevisionSnapshot>;

function RevisionPicker({ disabled, index }: { disabled: boolean; index: RevisionIndex; zh: boolean }) {
  const historyCopy = useI18n().messages.referenceOutline.history;

  const selected = index.selectedRevision;
  const previousLabel = historyCopy.previous;
  const nextLabel = historyCopy.next;
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
            aria-label={historyCopy.select}
          >
            {selected ? versionLabel(selected.revisionNo, historyCopy) : historyCopy.title}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="max-h-80 w-52 overflow-y-auto">
          {index.revisions.map((revision) => (
            <DropdownMenuItem key={revision.revisionId} onSelect={() => index.selectRevision(revision.revisionId)}>
              <DropdownMenuIcon>
                {revision.revisionId === index.selectedRevisionId ? <CheckIcon /> : null}
              </DropdownMenuIcon>
              <span>{versionLabel(revision.revisionNo, historyCopy)}</span>
              {revision.revisionId === index.resolvedCurrentRevisionId ? (
                <span className="ml-auto text-xs text-muted-foreground">{historyCopy.current}</span>
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
                {index.failed ? historyCopy.retry : historyCopy.earlier}
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
  onChange,
}: {
  value: RevisionView;
  zh: boolean;
  onChange(view: RevisionView): void;
}) {
  const historyCopy = useI18n().messages.referenceOutline.history;
  return (
    <Segmented
      type="single"
      value={value}
      aria-label={historyCopy.display}
      onValueChange={(next) => next && onChange(next as RevisionView)}
    >
      <SegmentedItem value="diff">
        <FileDiffIcon className="mr-1.5 size-3.5" />
        {historyCopy.changes}
      </SegmentedItem>
      <SegmentedItem value="preview">
        <EyeIcon className="mr-1.5 size-3.5" />
        {historyCopy.preview}
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

function RevisionDiffSection({ label, parts }: { label: string; parts: readonly TextDiffPart[]; zh: boolean }) {
  const historyCopy = useI18n().messages.referenceOutline.history;
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
              aria-label={historyCopy.unchangedCollapsed}
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
              <span className="sr-only">{part.type === 'added' ? historyCopy.added : historyCopy.removed}</span>
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
}: {
  older: ArticleRevisionDto | null;
  selected: ArticleRevisionDto;
  zh: boolean;
}) {
  const copy = useI18n().messages.contentEditor;
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
  const olderVariants = coverVariantSummaries(older);
  const selectedVariants = coverVariantSummaries(selected);
  const removedVariants = olderVariants.filter((value) => !selectedVariants.includes(value));
  const addedVariants = selectedVariants.filter((value) => !olderVariants.includes(value));

  if (!removed.length && !added.length && !coverChanged && !removedVariants.length && !addedVariants.length)
    return null;
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{copy.media}</h3>
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
            <span className="font-sans text-xs text-muted-foreground">{copy.articleCover}</span>
            {olderCover ? <span className="text-destructive line-through">{olderCover}</span> : null}
            <span aria-hidden="true">→</span>
            <span className="text-state-changed-fg">{selectedCover ?? copy.coverEditor.none}</span>
          </div>
        ) : null}
        {(removedVariants.length > 0 || addedVariants.length > 0) && (
          <div className="pt-1">
            <span className="font-sans text-xs text-muted-foreground">{copy.coverEditor.variants}</span>
            {removedVariants.map((value) => (
              <div key={value} className="text-destructive line-through">
                − {value}
              </div>
            ))}
            {addedVariants.map((value) => (
              <div key={value} className="text-state-changed-fg">
                + {value}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function coverVariantSummaries(revision: ArticleRevisionDto | null) {
  return (revision?.content.coverVariants ?? [])
    .map((cover) => `${cover.ratio}: ${mediaPathForAsset(revision, cover.assetId)}`)
    .sort();
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
  const historyCopy = useI18n().messages.referenceOutline.history;
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
    JSON.stringify(coverVariantSummaries(older)) !== JSON.stringify(coverVariantSummaries(selected)) ||
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
    ? `${versionLabel(older.revisionNo, historyCopy)} → ${versionLabel(selected.revisionNo, historyCopy)}`
    : historyCopy.initial;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="sticky top-0 z-10 flex min-h-10 items-center justify-between gap-4 border-b bg-background/95 px-5 text-xs backdrop-blur-sm">
        <span className="font-medium tabular-nums">{comparisonLabel}</span>
        <span className="flex items-center gap-3 text-muted-foreground">
          <span className="text-state-changed-fg">+ {historyCopy.added}</span>
          <span className="text-destructive">− {historyCopy.removed}</span>
        </span>
      </div>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-7 px-6 py-7 lg:px-8">
        {!titleChanged && !bodyChanged && !mediaChanged ? (
          <div className="grid min-h-60 place-items-center text-sm text-muted-foreground">{historyCopy.noChanges}</div>
        ) : (
          <>
            {titleChanged ? <RevisionDiffSection label={historyCopy.workTitle} parts={titleParts} zh={zh} /> : null}
            {bodyChanged ? <RevisionDiffSection label={historyCopy.body} parts={bodyParts} zh={zh} /> : null}
            {mediaChanged ? <RevisionMediaDiff older={older} selected={selected} zh={zh} /> : null}
          </>
        )}
      </div>
    </div>
  );
}

function RevisionPreview({ snapshot, history }: { snapshot: ArticleRevisionDto; history?: ReferenceHistoryResult }) {
  return (
    <ArticleReferenceDocument
      articleId={snapshot.articleId}
      markdown={history?.markdown ?? snapshot.content.markdown}
      media={[
        ...snapshot.content.mediaAssets.map((asset) => ({ assetId: asset.id, mediaUrl: asset.mediaUrl })),
        ...(history?.media ?? []),
      ]}
      mediaBindings={historicalDisplayRevision(snapshot, history).content.mediaBindings}
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
  selectedDependencies,
  olderDependencies,
}: {
  selectedDependencies: ReturnType<typeof useReferenceHistory>;
  olderDependencies: ReturnType<typeof useReferenceHistory>;
  index: RevisionIndex;
  older: RevisionSnapshot;
  selected: RevisionSnapshot;
  view: RevisionView;
  zh: boolean;
}) {
  const historyCopy = useI18n().messages.referenceOutline.history;
  const retryLabel = historyCopy.retry;
  if (index.failed && !index.revisions.length) {
    return <RetryButton label={retryLabel} onRetry={() => void index.reload()} />;
  }
  if (selected.failed) return <RetryButton label={retryLabel} onRetry={selected.retry} />;
  if (index.loading && !index.selectedRevisionId) return <LoadingRevision />;
  if (selected.loading || !selected.snapshot || !index.selectedRevision) return <LoadingRevision />;
  const dependencies = view === 'preview' ? [selectedDependencies] : [selectedDependencies, olderDependencies];
  if (dependencies.some((value) => value.loading)) return <LoadingRevision />;
  const unavailable = dependencies.find(
    (value) => value.failed || (value.needed && value.history?.state !== 'COMPLETE'),
  );
  if (unavailable)
    return (
      <span role="status" className="m-auto p-4 text-sm text-muted-foreground">
        {unavailable.history?.state === 'LEGACY' ? historyCopy.legacy : historyCopy.unavailable}
      </span>
    );
  if (view === 'preview')
    return <RevisionPreview snapshot={selected.snapshot} history={selectedDependencies.history} />;

  const olderMissing = index.selectedRevision.revisionNo > 1 && !index.olderRevision;
  if (olderMissing && index.failed) {
    return <RetryButton label={retryLabel} onRetry={() => void index.loadOlder(false)} />;
  }
  if (older.failed) return <RetryButton label={retryLabel} onRetry={older.retry} />;
  if (olderMissing || older.loading || (index.olderRevision !== null && !older.snapshot)) return <LoadingRevision />;
  return (
    <ArticleRevisionTextDiff
      older={older.snapshot ? historicalDisplayRevision(older.snapshot, olderDependencies.history) : null}
      selected={historicalDisplayRevision(selected.snapshot, selectedDependencies.history)}
      zh={zh}
    />
  );
}

export function ArticleRevisionHistoryDialog({
  spaceId,
  articleId,
  currentRevisionId,
  zh,
  onRestore,
  initialRevision,
  triggerLabel,
}: {
  spaceId: string;
  articleId: string;
  currentRevisionId: string;
  zh: boolean;
  onRestore?(revision: ArticleRevisionDto): Promise<boolean>;
  initialRevision?: Pick<ArticleRevisionSummaryDto, 'revisionId' | 'revisionNo'>;
  triggerLabel?: string;
}) {
  const historyCopy = useI18n().messages.referenceOutline.history;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<RevisionView>('diff');
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const index = useArticleRevisionIndex(articleId, currentRevisionId, open, initialRevision);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = useRevisionSnapshot(articleId, index.selectedRevisionId, open);
  const older = useRevisionSnapshot(articleId, index.olderRevision?.revisionId ?? null, open && view === 'diff');
  const selectedDependencies = useReferenceHistory(open ? selected.snapshot : null, spaceId);
  const olderDependencies = useReferenceHistory(open && view === 'diff' ? older.snapshot : null, spaceId);
  const label = historyCopy.title;
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

  async function restoreSelectedRevision(fixed = false) {
    if (!onRestore || !selected.snapshot || restoring || (!fixed && selectedIsCurrent)) return;
    const history = selectedDependencies.history;
    if (fixed && (!history || history.state !== 'COMPLETE')) return;
    setRestoring(true);
    setRestoreFailed(false);
    try {
      const revision = fixed && history ? fixedHistoryRevision(selected.snapshot, history) : selected.snapshot;
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
      {triggerLabel ? (
        <Button ref={triggerRef} variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <FileDiffIcon className="size-3.5" />
          {triggerLabel}
        </Button>
      ) : (
        <ArticleHeaderIconButton type="button" variant="ghost" label={label} onClick={() => setOpen(true)}>
          <HistoryIcon className="size-4" />
        </ArticleHeaderIconButton>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="h-[min(48rem,calc(100vh-2rem))] max-w-5xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0"
          onCloseAutoFocus={(event) => {
            if (triggerRef.current) {
              event.preventDefault();
              triggerRef.current.focus();
            }
          }}
        >
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle className="sr-only">{label}</DialogTitle>
            <div className="flex items-center gap-3 pr-8">
              <RevisionPicker disabled={restoring} index={index} zh={zh} />
              <RevisionViewControl value={view} zh={zh} onChange={setView} />
            </div>
          </DialogHeader>
          <div className="flex min-h-0 min-w-0 overflow-hidden bg-background">
            <RevisionContent
              index={index}
              older={older}
              selected={selected}
              view={view}
              zh={zh}
              selectedDependencies={selectedDependencies}
              olderDependencies={olderDependencies}
            />
          </div>
          <DialogFooter className="min-h-14 flex-row items-center border-t px-4 py-3 sm:justify-between">
            {selected.snapshot && <ContentWriteContextCell value={selected.snapshot.writeContext} />}
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {index.selectedRevision
                ? `${versionLabel(index.selectedRevision.revisionNo, historyCopy)} · ${revisionTimestamp(index.selectedRevision.createdAt, zh)}`
                : label}
            </span>
            {onRestore && selectedDependencies.needed && (
              <Button
                variant="outline"
                disabled={restoring || selectedDependencies.history?.state !== 'COMPLETE'}
                onClick={() => void restoreSelectedRevision(true)}
              >
                {historyCopy.restoreFixed}
              </Button>
            )}
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
                  ? historyCopy.retryRestore
                  : selectedIsCurrent
                    ? historyCopy.currentVersion
                    : selectedDependencies.needed
                      ? historyCopy.restoreBindings
                      : historyCopy.restore}
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
  spaceId,
  notify,
  zh,
}: {
  article: Pick<ArticleDto, 'id' | 'revisionId'>;
  spaceId: string;
  notify(message: string): void;
  zh: boolean;
}) {
  const historyCopy = useI18n().messages.referenceOutline.history;
  const session = useArticleEditorSession();

  async function restoreRevision(revision: ArticleRevisionDto) {
    try {
      const restored = await session.restoreRevision(revision);
      if (!restored) return false;
      const saved = session.capturePersistedArticle();
      notify(
        historyCopy.restored.replace('{from}', String(revision.revisionNo)).replace('{to}', String(saved.revisionNo)),
      );
      return true;
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }

  return (
    <ArticleRevisionHistoryDialog
      spaceId={spaceId}
      articleId={article.id}
      currentRevisionId={article.revisionId}
      zh={zh}
      onRestore={restoreRevision}
    />
  );
}
