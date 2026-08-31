import { useEffect, useRef, useState } from 'react';
import type {
  CodexVisualizationArtifactDto,
  CodexVisualizationHtmlPreviewDto,
} from '@/shared/contracts/codex-visualizations';
import { cn } from '@/renderer/lib/utils';

// The main-process registry holds three preview grants; keep one available for the dialog.
const MAX_ACTIVE_CARD_PREVIEWS = 2;
const CARD_PREVIEW_ROOT_MARGIN = '240px 0px';

interface SlotRequest {
  signal: AbortSignal;
  resolve(release: () => void): void;
  reject(reason: Error): void;
  abort(): void;
}

let activeCardPreviewCount = 0;
const pendingCardPreviews: SlotRequest[] = [];

function drainCardPreviewQueue() {
  while (activeCardPreviewCount < MAX_ACTIVE_CARD_PREVIEWS && pendingCardPreviews.length > 0) {
    const request = pendingCardPreviews.shift()!;
    request.signal.removeEventListener('abort', request.abort);
    if (request.signal.aborted) {
      request.reject(new Error('Card preview canceled'));
      continue;
    }
    activeCardPreviewCount += 1;
    let released = false;
    request.resolve(() => {
      if (released) return;
      released = true;
      activeCardPreviewCount = Math.max(0, activeCardPreviewCount - 1);
      drainCardPreviewQueue();
    });
  }
}

function acquireCardPreviewSlot(signal: AbortSignal) {
  return new Promise<() => void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Card preview canceled'));
      return;
    }
    const request: SlotRequest = {
      signal,
      resolve,
      reject,
      abort() {
        const index = pendingCardPreviews.indexOf(request);
        if (index < 0) return;
        pendingCardPreviews.splice(index, 1);
        reject(new Error('Card preview canceled'));
      },
    };
    signal.addEventListener('abort', request.abort, { once: true });
    pendingCardPreviews.push(request);
    drainCardPreviewQueue();
  });
}

function releaseHtmlPreview(previewId: string) {
  void window.desktopApi.codexVisualizationReleaseHtmlPreview({ previewId }).catch(() => undefined);
}

export function CodexHtmlCardPreview({ artifact }: { artifact: CodexVisualizationArtifactDto }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [access, setAccess] = useState<CodexVisualizationHtmlPreviewDto | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const target = containerRef.current;
    if (!target || typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setNearViewport(Boolean(entry?.isIntersecting)), {
      rootMargin: CARD_PREVIEW_ROOT_MARGIN,
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setAccess(null);
    setLoaded(false);
    if (!nearViewport) return;

    const controller = new AbortController();
    let currentPreviewId: string | null = null;
    let releaseSlot: (() => void) | null = null;

    void (async () => {
      try {
        releaseSlot = await acquireCardPreviewSlot(controller.signal);
        if (controller.signal.aborted) {
          releaseSlot();
          releaseSlot = null;
          return;
        }
        const next = await window.desktopApi.codexVisualizationPrepareHtmlPreview({ artifactId: artifact.id });
        if (controller.signal.aborted) {
          releaseHtmlPreview(next.previewId);
          releaseSlot();
          releaseSlot = null;
          return;
        }
        currentPreviewId = next.previewId;
        setAccess(next);
      } catch {
        releaseSlot?.();
        releaseSlot = null;
      }
    })();

    return () => {
      controller.abort();
      if (currentPreviewId) releaseHtmlPreview(currentPreviewId);
      releaseSlot?.();
    };
  }, [artifact.id, nearViewport]);

  return (
    <div ref={containerRef} data-codex-html-card-preview className="pointer-events-none absolute inset-0">
      {access && (
        <iframe
          src={access.url}
          title={artifact.fileName}
          sandbox=""
          referrerPolicy="no-referrer"
          allow=""
          loading="eager"
          tabIndex={-1}
          aria-hidden="true"
          className={cn('size-full border-0 bg-background', loaded ? 'opacity-100' : 'opacity-0')}
          onLoad={() => setLoaded(true)}
        />
      )}
    </div>
  );
}
