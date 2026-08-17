import { useEffect, useState } from 'react';
import type { VideoDocumentRevisionDto } from '@/shared/contracts';

export type VideoDocumentRevisionCache = Map<string, VideoDocumentRevisionDto>;

const REVISION_CACHE_LIMIT = 12;

interface Options {
  active: boolean;
  branchId: string | null;
  revisionId: string | null;
  loadFailedLabel: string;
  cache?: VideoDocumentRevisionCache;
  notify(message: string): void;
}

function cacheRevision(cache: VideoDocumentRevisionCache | undefined, revision: VideoDocumentRevisionDto) {
  if (!cache) return;
  cache.delete(revision.id);
  cache.set(revision.id, revision);
  while (cache.size > REVISION_CACHE_LIMIT) {
    const oldestRevisionId = cache.keys().next().value;
    if (!oldestRevisionId) return;
    cache.delete(oldestRevisionId);
  }
}

export function useVideoDocumentRevision({ active, branchId, revisionId, loadFailedLabel, cache, notify }: Options) {
  const [revision, setLoadedRevision] = useState<VideoDocumentRevisionDto | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!active || !branchId || !revisionId) {
      setLoadedRevision(null);
      setLoading(false);
      return undefined;
    }
    const cached = cache?.get(revisionId);
    if (cached?.branchId === branchId) {
      cacheRevision(cache, cached);
      setLoadedRevision(cached);
      setLoading(false);
      return undefined;
    }
    setLoadedRevision(null);
    let current = true;
    setLoading(true);
    void window.desktopApi
      .videoDocumentRevisionGet(branchId, revisionId)
      .then((next) => {
        if (!current) return;
        if (next) cacheRevision(cache, next);
        setLoadedRevision(next?.id === revisionId ? next : null);
        setLoading(false);
      })
      .catch(() => {
        if (!current) return;
        setLoading(false);
        notify(loadFailedLabel);
      });
    return () => {
      current = false;
    };
  }, [active, branchId, cache, loadFailedLabel, notify, revisionId]);

  return {
    revision,
    loading,
    setRevision(next: VideoDocumentRevisionDto | null) {
      if (next) cacheRevision(cache, next);
      setLoadedRevision(next);
    },
  };
}
