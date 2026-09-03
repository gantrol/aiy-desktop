import { CaptionsIcon, Clock3Icon, ImageOffIcon } from 'lucide-react';
import { Children, isValidElement, useMemo, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import type {
  VideoDocumentMediaBinding,
  VideoDocumentRevisionContent,
  VideoDocumentRevisionDto,
  VideoDocumentRevisionMediaDto,
  VideoDocumentTimelineSegment,
  VideoDocumentTranscriptCue,
} from '@/shared/contracts';
import { parseCodexThreadHref } from '@/shared/contracts/codex-thread';
import { CodexThreadAnchor } from '@/renderer/components/content/CodexThreadAnchor';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/renderer/components/ui/hover-card';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';
import { AssetImageCopyButton } from '@/renderer/components/media/AssetImageCopyButton';
import { VideoDocumentInlineVideo } from '@/renderer/features/video-documents/VideoDocumentInlineVideo';

type MarkdownContent = Extract<VideoDocumentRevisionContent, { format: 'MARKDOWN' }>;

interface ArticleLabels {
  mediaUnavailable: string;
  sourceTime: string;
  videoSegment: string;
  openAt(time: string): string;
  openTranscriptAt(time: string): string;
  expandVideo(title: string): string;
  collapseVideo(title: string): string;
}

interface Options {
  content: MarkdownContent | null;
  media: readonly VideoDocumentRevisionMediaDto[];
  transcriptRevision?: VideoDocumentRevisionDto | null;
  labels: ArticleLabels;
  headingIdForNode(node: unknown): string | undefined;
  onOpenTranscript?(timestampMs: number): void;
  onSeek(timestampMs: number): void;
}

interface ComponentOptions {
  content: MarkdownContent | null;
  bindingByPath: ReadonlyMap<string, VideoDocumentMediaBinding>;
  mediaById: ReadonlyMap<string, VideoDocumentRevisionMediaDto>;
  transcriptCuesBySegment: ReadonlyMap<VideoDocumentTimelineSegment, readonly VideoDocumentTranscriptCue[]>;
  segmentBySourceSecond: ReadonlyMap<number, VideoDocumentTimelineSegment>;
  cueSourceIndexesByText: ReadonlyMap<string, readonly number[]>;
  directQuoteCueSourceIndexes: ReadonlySet<number>;
  originalLedCueSourceIndexes: ReadonlySet<number>;
  labels: ArticleLabels;
  headingIdForNode(node: unknown): string | undefined;
  onOpenTranscript(timestampMs: number): void;
  onSeek(timestampMs: number): void;
}

function formatTimestamp(timestampMs: number) {
  const totalSeconds = Math.max(0, Math.floor(timestampMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function normalizedMediaPath(value: string | undefined) {
  if (!value) return '';
  const path = value.split(/[?#]/, 1)[0]!.replace(/^\.\//, '');
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function sourceTimestampMs(href: string | undefined, sourceUrl: string | null) {
  if (!href) return null;
  if (href.startsWith('#t=')) {
    const seconds = Number(href.slice(3));
    return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1_000) : null;
  }
  if (!sourceUrl) return null;
  try {
    const target = new URL(href);
    const source = new URL(sourceUrl);
    if (target.protocol !== 'https:' || target.host !== source.host) return null;
    if (target.pathname.replace(/\/+$/, '') !== source.pathname.replace(/\/+$/, '')) return null;
    const rawSeconds = target.searchParams.get('t');
    if (rawSeconds === null) return null;
    const seconds = Number(rawSeconds);
    return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1_000) : null;
  } catch {
    return null;
  }
}

function elementProperty(node: unknown, property: 'src' | 'href') {
  if (!node || typeof node !== 'object') return '';
  const properties = (node as { properties?: Record<string, unknown> }).properties;
  const value = properties?.[property];
  return typeof value === 'string' ? value : '';
}

function mediaOnlyParagraph(node: unknown, bindingByPath: ReadonlyMap<string, VideoDocumentMediaBinding>) {
  if (!node || typeof node !== 'object') return false;
  const children = (node as { children?: unknown[] }).children;
  if (!Array.isArray(children)) return false;
  const meaningful = children.filter((child) => {
    if (!child || typeof child !== 'object') return false;
    const value = (child as { value?: unknown }).value;
    return typeof value !== 'string' || value.trim().length > 0;
  });
  return (
    meaningful.length > 0 &&
    meaningful.every((child) => {
      if (!child || typeof child !== 'object') return false;
      const tagName = (child as { tagName?: unknown }).tagName;
      if (tagName === 'img') return bindingByPath.has(normalizedMediaPath(elementProperty(child, 'src')));
      if (tagName !== 'a') return false;
      return bindingByPath.get(normalizedMediaPath(elementProperty(child, 'href')))?.kind === 'VIDEO';
    })
  );
}

function visibleText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(visibleText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return visibleText(node.props.children);
  return '';
}

function normalizedText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function firstSourceTimestampInNode(node: unknown, sourceUrl: string | null): number | null {
  if (!node || typeof node !== 'object') return null;
  const candidate = node as { tagName?: unknown; properties?: Record<string, unknown>; children?: unknown[] };
  if (candidate.tagName === 'a') {
    const href = candidate.properties?.href;
    const timestampMs = sourceTimestampMs(typeof href === 'string' ? href : undefined, sourceUrl);
    if (timestampMs !== null) return timestampMs;
  }
  for (const child of candidate.children ?? []) {
    const timestampMs = firstSourceTimestampInNode(child, sourceUrl);
    if (timestampMs !== null) return timestampMs;
  }
  return null;
}

function headingWithoutSourceTime(
  children: ReactNode,
  segment: VideoDocumentTimelineSegment,
  sourceUrl: string | null,
) {
  const result = Children.toArray(children).filter((child) => {
    if (!isValidElement<{ href?: string; timestampMs?: number }>(child)) return true;
    const timestampMs =
      typeof child.props.timestampMs === 'number'
        ? child.props.timestampMs
        : sourceTimestampMs(child.props.href, sourceUrl);
    if (timestampMs === null) return true;
    return (
      Math.abs(timestampMs - segment.startTimestampMs) > 1_000 && Math.abs(timestampMs - segment.endTimestampMs) > 1_000
    );
  });
  while (typeof result.at(-1) === 'string' && /^[\s–—-]*$/.test(String(result.at(-1)))) result.pop();
  const last = result.at(-1);
  if (typeof last === 'string') result[result.length - 1] = last.replace(/[\s–—-]+$/, '');
  return result;
}

function transcriptCuesForSegment(
  segment: VideoDocumentTimelineSegment,
  sortedCues: readonly VideoDocumentTranscriptCue[],
) {
  const startCueSourceIndex = segment.startCueSourceIndex;
  const endCueSourceIndex = segment.endCueSourceIndex;
  if (startCueSourceIndex === null || endCueSourceIndex === null) return [];

  let start = 0;
  let end = sortedCues.length;
  while (start < end) {
    const middle = start + Math.floor((end - start) / 2);
    if (sortedCues[middle]!.sourceIndex < startCueSourceIndex) start = middle + 1;
    else end = middle;
  }
  const firstCueIndex = start;

  end = sortedCues.length;
  while (start < end) {
    const middle = start + Math.floor((end - start) / 2);
    if (sortedCues[middle]!.sourceIndex <= endCueSourceIndex) start = middle + 1;
    else end = middle;
  }
  return sortedCues.slice(firstCueIndex, start);
}

function createComponents({
  content,
  bindingByPath,
  mediaById,
  transcriptCuesBySegment,
  segmentBySourceSecond,
  cueSourceIndexesByText,
  directQuoteCueSourceIndexes,
  originalLedCueSourceIndexes,
  labels,
  headingIdForNode,
  onOpenTranscript,
  onSeek,
}: ComponentOptions): Components {
  function TimeButton({ timestampMs, children }: { timestampMs: number; children?: ReactNode }) {
    const timestamp = formatTimestamp(timestampMs);
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-sm font-medium text-[var(--button-primary)] underline decoration-selected-border underline-offset-4 hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={labels.openAt(timestamp)}
        onClick={() => onSeek(timestampMs)}
      >
        {children ?? timestamp}
      </button>
    );
  }

  function segmentForHeading(node: unknown) {
    const timestampMs = firstSourceTimestampInNode(node, content?.sourceUrl ?? null);
    if (timestampMs === null) return null;
    const segment = segmentBySourceSecond.get(Math.floor(timestampMs / 1_000));
    if (!segment || !transcriptCuesBySegment.get(segment)?.length) return null;
    return segment;
  }

  function SourceReference({ segment }: { segment: VideoDocumentTimelineSegment }) {
    const cues = transcriptCuesBySegment.get(segment);
    if (!cues?.length) return null;
    const startTimestampMs = cues[0]?.startTimestampMs ?? segment.startTimestampMs;
    const range = `${formatTimestamp(segment.startTimestampMs)}–${formatTimestamp(segment.endTimestampMs)}`;
    return (
      <HoverCard openDelay={360} closeDelay={120}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-normal text-[var(--button-primary)] outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={labels.openTranscriptAt(range)}
            onClick={() => onOpenTranscript(startTimestampMs)}
          >
            <CaptionsIcon className="size-3.5" />
            <span>{range}</span>
          </button>
        </HoverCardTrigger>
        <HoverCardContent align="start" side="bottom" className="w-[22rem] p-3">
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {cues.map((cue) => (
              <div key={cue.sourceIndex} className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-2 text-xs leading-5">
                <span className="font-mono tabular-nums text-muted-foreground">
                  {formatTimestamp(cue.startTimestampMs)}
                </span>
                <span>{cue.text}</span>
              </div>
            ))}
          </div>
        </HoverCardContent>
      </HoverCard>
    );
  }

  function MissingMedia() {
    return (
      <span className="grid aspect-video w-full place-items-center rounded-lg border bg-surface-sunken text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <ImageOffIcon className="size-4" />
          {labels.mediaUnavailable}
        </span>
      </span>
    );
  }

  function MediaTime({ binding }: { binding: VideoDocumentMediaBinding }) {
    if (binding.timestampMs === null) return null;
    const start = formatTimestamp(binding.timestampMs);
    const range = binding.endTimestampMs === null ? start : `${start}–${formatTimestamp(binding.endTimestampMs)}`;
    return (
      <TimeButton timestampMs={binding.timestampMs}>
        <Clock3Icon className="size-3.5" />
        <span>{labels.sourceTime}</span>
        <span>{range}</span>
      </TimeButton>
    );
  }

  function Heading({ level, node, children }: { level: 2 | 3 | 4 | 5 | 6; node: unknown; children?: ReactNode }) {
    const headingId = headingIdForNode(node);
    const Tag = `h${level}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
    const segment = segmentForHeading(node);
    return (
      <Tag
        id={headingId}
        data-article-heading-id={headingId}
        className="flex scroll-mt-6 flex-wrap items-baseline gap-x-2 gap-y-1"
      >
        <span>{segment ? headingWithoutSourceTime(children, segment, content?.sourceUrl ?? null) : children}</span>
        {segment && <SourceReference segment={segment} />}
      </Tag>
    );
  }

  return {
    h1: () => null,
    h2: ({ node, children }) => <Heading level={2} node={node} children={children} />,
    h3: ({ node, children }) => <Heading level={3} node={node} children={children} />,
    h4: ({ node, children }) => <Heading level={4} node={node} children={children} />,
    h5: ({ node, children }) => <Heading level={5} node={node} children={children} />,
    h6: ({ node, children }) => <Heading level={6} node={node} children={children} />,
    p: ({ node, children }) =>
      mediaOnlyParagraph(node, bindingByPath) ? (
        <div className="my-7 grid gap-5">{children}</div>
      ) : (
        <p className="my-5 text-inherit">{children}</p>
      ),
    blockquote: ({ children }) => {
      const matchingCueSourceIndexes = cueSourceIndexesByText.get(normalizedText(visibleText(children))) ?? [];
      const preserveQuote =
        matchingCueSourceIndexes.length === 0 ||
        matchingCueSourceIndexes.some(
          (sourceIndex) => directQuoteCueSourceIndexes.has(sourceIndex) || originalLedCueSourceIndexes.has(sourceIndex),
        );
      if (content?.generation && !preserveQuote) return null;
      return <blockquote>{children}</blockquote>;
    },
    ul: ({ children }) => <ul>{children}</ul>,
    ol: ({ children }) => <ol>{children}</ol>,
    table: ({ children }) => (
      <div className="tableWrapper">
        <table>{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead>{children}</thead>,
    th: ({ children }) => <th>{children}</th>,
    td: ({ children }) => <td>{children}</td>,
    img: ({ src, alt }) => {
      const binding = bindingByPath.get(normalizedMediaPath(src));
      const media = binding ? mediaById.get(binding.assetId) : null;
      if (!binding || binding.kind !== 'IMAGE' || !media) return <MissingMedia />;
      const image = (
        <span className="relative isolate block max-h-[34rem] w-full overflow-hidden bg-surface-sunken">
          <ImageAmbientBackdrop src={media.mediaUrl} loading="lazy" />
          <img
            src={media.mediaUrl}
            alt={alt ?? ''}
            className="relative z-10 max-h-[34rem] w-full object-contain"
            loading="lazy"
          />
        </span>
      );
      return (
        <figure className="group/article-image relative overflow-hidden rounded-md bg-surface">
          {binding.timestampMs === null ? (
            image
          ) : (
            <button
              type="button"
              className="block w-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              aria-label={labels.openAt(formatTimestamp(binding.timestampMs))}
              onClick={() => onSeek(binding.timestampMs!)}
            >
              {image}
            </button>
          )}
          <AssetImageCopyButton assetId={media.assetId} />
          {binding.timestampMs !== null && (
            <figcaption className="flex items-center px-3 py-2 text-xs text-muted-foreground">
              <MediaTime binding={binding} />
            </figcaption>
          )}
        </figure>
      );
    },
    a: ({ href, children }) => {
      const threadId = parseCodexThreadHref(href);
      if (threadId) {
        return (
          <CodexThreadAnchor
            threadId={threadId}
            className="text-[var(--button-primary)] underline decoration-selected-border underline-offset-4"
          >
            {children}
          </CodexThreadAnchor>
        );
      }
      const binding = bindingByPath.get(normalizedMediaPath(href));
      if (binding?.kind === 'VIDEO') {
        const media = mediaById.get(binding.assetId);
        const poster = binding.posterAssetId ? mediaById.get(binding.posterAssetId) : null;
        if (!media) return <MissingMedia />;
        const title = visibleText(children).trim() || labels.videoSegment;
        return (
          <VideoDocumentInlineVideo
            mediaUrl={media.mediaUrl}
            posterUrl={poster?.mediaUrl ?? null}
            title={title}
            expandLabel={labels.expandVideo(title)}
            collapseLabel={labels.collapseVideo(title)}
          >
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span>{children}</span>
              <MediaTime binding={binding} />
            </span>
          </VideoDocumentInlineVideo>
        );
      }
      const timestampMs = sourceTimestampMs(href, content?.sourceUrl ?? null);
      return timestampMs === null ? (
        <span>{children}</span>
      ) : (
        <TimeButton timestampMs={timestampMs}>{children}</TimeButton>
      );
    },
  };
}

function transcriptIndexes(cues: readonly VideoDocumentTranscriptCue[]) {
  const cueBySourceIndex = new Map<number, VideoDocumentTranscriptCue>();
  const sourceIndexesByText = new Map<string, number[]>();
  for (const cue of cues) {
    cueBySourceIndex.set(cue.sourceIndex, cue);
    const text = normalizedText(cue.text);
    if (!text) continue;
    const sourceIndexes = sourceIndexesByText.get(text);
    if (sourceIndexes) sourceIndexes.push(cue.sourceIndex);
    else sourceIndexesByText.set(text, [cue.sourceIndex]);
  }
  return {
    sortedTranscriptCues: [...cueBySourceIndex.values()].sort((left, right) => left.sourceIndex - right.sourceIndex),
    cueSourceIndexesByText: sourceIndexesByText,
  };
}

function segmentIndexes(content: MarkdownContent | null, sortedCues: readonly VideoDocumentTranscriptCue[]) {
  const cuesBySegment = new Map<VideoDocumentTimelineSegment, readonly VideoDocumentTranscriptCue[]>();
  const segmentBySecond = new Map<number, VideoDocumentTimelineSegment>();
  const originalLedRanges: Array<{ start: number; end: number }> = [];
  for (const segment of content?.timelineSegments ?? []) {
    cuesBySegment.set(segment, transcriptCuesForSegment(segment, sortedCues));
    const firstSecond = Math.floor(Math.max(0, segment.startTimestampMs - 1_000) / 1_000);
    const lastSecond = Math.floor((segment.startTimestampMs + 1_000) / 1_000);
    for (let second = firstSecond; second <= lastSecond; second += 1) {
      const current = segmentBySecond.get(second);
      if (
        !current ||
        Math.abs(segment.startTimestampMs - second * 1_000) < Math.abs(current.startTimestampMs - second * 1_000)
      ) {
        segmentBySecond.set(second, segment);
      }
    }
    if (
      segment.segmentType === 'ORIGINAL_LED' &&
      segment.startCueSourceIndex !== null &&
      segment.endCueSourceIndex !== null &&
      segment.startCueSourceIndex <= segment.endCueSourceIndex
    ) {
      originalLedRanges.push({ start: segment.startCueSourceIndex, end: segment.endCueSourceIndex });
    }
  }

  originalLedRanges.sort((left, right) => left.start - right.start || left.end - right.end);
  const mergedRanges: Array<{ start: number; end: number }> = [];
  for (const range of originalLedRanges) {
    const previous = mergedRanges.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else mergedRanges.push({ ...range });
  }

  const originalLedCueSourceIndexes = new Set<number>();
  let rangeIndex = 0;
  for (const cue of sortedCues) {
    while (rangeIndex < mergedRanges.length && mergedRanges[rangeIndex]!.end < cue.sourceIndex) rangeIndex += 1;
    const range = mergedRanges[rangeIndex];
    if (range && range.start <= cue.sourceIndex) originalLedCueSourceIndexes.add(cue.sourceIndex);
  }
  return {
    transcriptCuesBySegment: cuesBySegment,
    segmentBySourceSecond: segmentBySecond,
    originalLedCueSourceIndexes,
  };
}

export function useVideoDocumentArticleMarkdown({
  content,
  media,
  transcriptRevision,
  labels,
  headingIdForNode,
  onOpenTranscript,
  onSeek,
}: Options) {
  const transcriptCues = useMemo(
    () => (transcriptRevision?.content.format === 'TIMED_TRANSCRIPT' ? transcriptRevision.content.cues : []),
    [transcriptRevision],
  );
  const bindingByPath = useMemo(
    () => new Map((content?.mediaBindings ?? []).map((binding) => [binding.path, binding])),
    [content],
  );
  const mediaById = useMemo(() => new Map(media.map((item) => [item.assetId, item])), [media]);
  const { sortedTranscriptCues, cueSourceIndexesByText } = useMemo(
    () => transcriptIndexes(transcriptCues),
    [transcriptCues],
  );
  const directQuoteCueSourceIndexes = useMemo(
    () => new Set((content?.timelineSegments ?? []).flatMap((segment) => segment.directQuoteCueSourceIndexes ?? [])),
    [content?.timelineSegments],
  );
  const { transcriptCuesBySegment, segmentBySourceSecond, originalLedCueSourceIndexes } = useMemo(
    () => segmentIndexes(content, sortedTranscriptCues),
    [content, sortedTranscriptCues],
  );

  return useMemo(
    () =>
      createComponents({
        content,
        bindingByPath,
        mediaById,
        transcriptCuesBySegment,
        segmentBySourceSecond,
        cueSourceIndexesByText,
        directQuoteCueSourceIndexes,
        originalLedCueSourceIndexes,
        labels,
        headingIdForNode,
        onOpenTranscript: onOpenTranscript ?? onSeek,
        onSeek,
      }),
    [
      bindingByPath,
      content,
      cueSourceIndexesByText,
      directQuoteCueSourceIndexes,
      headingIdForNode,
      labels,
      mediaById,
      onOpenTranscript,
      onSeek,
      originalLedCueSourceIndexes,
      segmentBySourceSecond,
      transcriptCuesBySegment,
    ],
  );
}
