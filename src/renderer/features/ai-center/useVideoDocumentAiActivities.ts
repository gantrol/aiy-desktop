import { useCallback, useEffect, useRef, useState } from 'react';
import type { VideoDocumentAiActivityDto } from '@/shared/contracts/video-document-ai-activity';

function activityKey(item: VideoDocumentAiActivityDto) {
  return `${item.type}:${item.run.id}`;
}

export function useVideoDocumentAiActivities(active: boolean, notify: (message: string) => void) {
  const [items, setItems] = useState<VideoDocumentAiActivityDto[]>([]);
  const requestRevisionRef = useRef(0);
  const loadingRef = useRef(false);
  const lastErrorRef = useRef<string | null>(null);
  const reportFailure = useCallback(
    (reason: unknown) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (lastErrorRef.current === message) return;
      lastErrorRef.current = message;
      notify(message);
    },
    [notify],
  );

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    const requestRevision = ++requestRevisionRef.current;
    try {
      const next: VideoDocumentAiActivityDto[] = [];
      let cursor: string | null = null;
      do {
        const page = await window.desktopApi.videoDocumentAiActivitiesList({ cursor, limit: 200 });
        next.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      if (requestRevisionRef.current === requestRevision) {
        lastErrorRef.current = null;
        setItems(next);
      }
    } catch (reason) {
      if (requestRevisionRef.current === requestRevision) reportFailure(reason);
    } finally {
      loadingRef.current = false;
    }
  }, [reportFailure]);

  const refreshHead = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const page = await window.desktopApi.videoDocumentAiActivitiesList({ cursor: null, limit: 200 });
      lastErrorRef.current = null;
      const headKeys = new Set(page.items.map(activityKey));
      setItems((current) =>
        [...page.items, ...current.filter((item) => !headKeys.has(activityKey(item)))].sort(
          (left, right) =>
            right.run.startedAt.localeCompare(left.run.startedAt) ||
            activityKey(right).localeCompare(activityKey(left)),
        ),
      );
    } catch (reason) {
      reportFailure(reason);
    } finally {
      loadingRef.current = false;
    }
  }, [reportFailure]);

  useEffect(() => {
    if (!active) return;
    void load();
  }, [active, load]);

  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => void refreshHead(), 2_500);
    return () => window.clearInterval(timer);
  }, [active, refreshHead]);

  return { items, reload: load };
}
