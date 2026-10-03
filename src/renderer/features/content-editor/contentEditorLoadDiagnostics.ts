import { useEffect } from 'react';
import type { Editor } from '@tiptap/core';
import type { ContentSource } from '@/shared/contracts/content-library';
import { recordRendererDiagnostic } from '@/renderer/lib/rendererDiagnostics';

export function createContentEditorLoadTiming(input: {
  contentSource?: ContentSource;
  sessionIdentity?: string;
  markdown: string;
  outlineMode?: boolean;
}) {
  if (input.contentSource?.kind !== 'ARTICLE') return null;
  return {
    startedAt: performance.now(),
    initiallyHidden: document.hidden,
    preparedAt: null as number | null,
    createdAt: null as number | null,
    recorded: false,
    details: {
      articleId: input.contentSource.id,
      sessionId: input.sessionIdentity,
      bodyLength: input.markdown.length,
      view: input.outlineMode ? 'outline' : 'article',
    },
  };
}

function observeLoadWork(startedAt: number, initiallyHidden: boolean) {
  let hiddenAt: number | null = initiallyHidden ? startedAt : null;
  let hiddenDurationMs = 0;
  let longTaskCount = 0;
  let longTaskTotalMs = 0;
  let longestTaskMs = 0;
  const visibility = () => {
    if (document.hidden) hiddenAt ??= performance.now();
    else if (hiddenAt !== null) {
      hiddenDurationMs += performance.now() - hiddenAt;
      hiddenAt = null;
    }
  };
  const collect = (entries: PerformanceEntry[]) => {
    for (const entry of entries) {
      // A task can start before mounting and include the entire synchronous commit.
      const duration = entry.startTime + entry.duration - Math.max(startedAt, entry.startTime);
      if (duration <= 0) continue;
      longTaskCount += 1;
      longTaskTotalMs += duration;
      longestTaskMs = Math.max(longestTaskMs, duration);
    }
  };
  const observer =
    typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')
      ? new PerformanceObserver((list) => collect(list.getEntries()))
      : null;
  observer?.observe({ type: 'longtask', buffered: true });
  document.addEventListener('visibilitychange', visibility);
  return {
    read: () => {
      if (observer) collect(observer.takeRecords());
      return {
        hiddenDurationMs: hiddenDurationMs + (hiddenAt === null ? 0 : performance.now() - hiddenAt),
        longTaskCount,
        longTaskTotalMs,
        longestTaskMs,
      };
    },
    dispose: () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', visibility);
    },
  };
}

/** Two animation frames mark a rendering opportunity, not completion of media decoding. */
export function useContentEditorLoadFrame(
  timing: ReturnType<typeof createContentEditorLoadTiming>,
  editor: Editor | null,
) {
  useEffect(() => {
    if (!timing || !editor || timing.recorded || timing.preparedAt === null || timing.createdAt === null) return;
    const documentPrepareMs = timing.preparedAt - timing.startedAt;
    const editorCreateMs = timing.createdAt - timing.preparedAt;
    const commitMs = performance.now() - timing.createdAt;
    const work = observeLoadWork(timing.startedAt, timing.initiallyHidden);
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (editor.isDestroyed || timing.recorded) return;
        timing.recorded = true;
        recordRendererDiagnostic('article-document-frame', {
          ...timing.details,
          durationMs: performance.now() - timing.startedAt,
          documentPrepareMs,
          editorCreateMs,
          commitMs,
          ...work.read(),
        });
        work.dispose();
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      work.dispose();
    };
  }, [editor, timing]);
}
