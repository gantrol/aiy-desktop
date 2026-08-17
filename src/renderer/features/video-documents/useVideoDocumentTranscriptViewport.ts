import { useEffect, useMemo, useState, type RefObject } from 'react';

interface TranscriptViewportCue {
  sourceIndex: number;
  startTimestampMs: number;
  endTimestampMs: number;
}

export interface VideoDocumentTranscriptViewportRange {
  startTimestampMs: number;
  endTimestampMs: number;
}

interface Options {
  sectionRef: RefObject<HTMLElement | null>;
  cueRefs: RefObject<Map<number, HTMLLIElement>>;
  cues: readonly TranscriptViewportCue[];
}

function sameRange(
  current: VideoDocumentTranscriptViewportRange | null,
  next: VideoDocumentTranscriptViewportRange | null,
) {
  return current?.startTimestampMs === next?.startTimestampMs && current?.endTimestampMs === next?.endTimestampMs;
}

export function useVideoDocumentTranscriptViewport({ sectionRef, cueRefs, cues }: Options) {
  const [range, setRange] = useState<VideoDocumentTranscriptViewportRange | null>(null);
  const cueBySourceIndex = useMemo(() => new Map(cues.map((cue) => [cue.sourceIndex, cue])), [cues]);

  useEffect(() => {
    const section = sectionRef.current;
    const scrollRoot = section?.closest<HTMLElement>('[data-slot="tabs-content"]') ?? section?.parentElement;
    if (!section || !scrollRoot) return undefined;
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const viewport = scrollRoot.getBoundingClientRect();
        let first: TranscriptViewportCue | null = null;
        let last: TranscriptViewportCue | null = null;
        for (const [sourceIndex, element] of cueRefs.current) {
          const bounds = element.getBoundingClientRect();
          if (bounds.bottom < viewport.top) continue;
          if (bounds.top > viewport.bottom) break;
          const cue = cueBySourceIndex.get(sourceIndex);
          if (!cue) continue;
          first ??= cue;
          last = cue;
        }
        const next =
          first && last ? { startTimestampMs: first.startTimestampMs, endTimestampMs: last.endTimestampMs } : null;
        setRange((current) => (sameRange(current, next) ? current : next));
      });
    };
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    resizeObserver?.observe(scrollRoot);
    scrollRoot.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      scrollRoot.removeEventListener('scroll', update);
    };
  }, [cueBySourceIndex, cueRefs, sectionRef]);

  return range;
}
