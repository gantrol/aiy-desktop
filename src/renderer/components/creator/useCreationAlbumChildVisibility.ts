import { useCallback, useState } from 'react';

const recentCalendarDays = 7;
const minimumVisibleChildren = 4;
const maximumVisibleChildren = 8;
const revealBatchSize = 6;

export interface CreationAlbumChildVisibilityEntry {
  key: string;
  pinned: boolean;
  activityAt: string;
  createdAt: string;
}

export interface CreationAlbumChildVisibilityProjection {
  visibleCount: number;
  hiddenCount: number;
  canReset: boolean;
  disclosure: 'more' | 'fewer' | null;
}

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function entryActivityTimestamp(entry: CreationAlbumChildVisibilityEntry) {
  return timestamp(entry.activityAt) ?? timestamp(entry.createdAt);
}

function recentCutoffTimestamp(now: number) {
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (recentCalendarDays - 1));
  return cutoff.getTime();
}

function defaultVisibleCount(entries: readonly CreationAlbumChildVisibilityEntry[], now: number) {
  if (entries.length === 0) return 0;
  const unpinned = entries.filter((entry) => !entry.pinned);
  if (unpinned.length === 0) return entries.length;

  const recentCutoff = recentCutoffTimestamp(now);
  const recentCount = unpinned.reduce((count, entry) => {
    const activityAt = entryActivityTimestamp(entry);
    return count + Number(activityAt !== null && activityAt >= recentCutoff);
  }, 0);
  const visibleUnpinnedCount = Math.min(
    unpinned.length,
    Math.max(minimumVisibleChildren, Math.min(maximumVisibleChildren, recentCount)),
  );
  let admittedUnpinnedCount = 0;
  let visibleCount = 0;
  entries.forEach((entry, index) => {
    let admitted = entry.pinned;
    if (!entry.pinned && admittedUnpinnedCount < visibleUnpinnedCount) {
      admittedUnpinnedCount += 1;
      admitted = true;
    }
    if (admitted) visibleCount = index + 1;
  });
  return visibleCount;
}

/** Owns session-local truncation without coupling branch expansion to list length. */
export function useCreationAlbumChildVisibility() {
  const [visibleThroughKeyByAlbumId, setVisibleThroughKeyByAlbumId] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const [now] = useState(() => Date.now());

  const reset = useCallback((albumId: string) => {
    setVisibleThroughKeyByAlbumId((current) => {
      if (!current.has(albumId)) return current;
      const next = new Map(current);
      next.delete(albumId);
      return next;
    });
  }, []);

  const revealMore = useCallback(
    (albumId: string, entries: readonly CreationAlbumChildVisibilityEntry[], visibleCount: number) => {
      const nextBoundary = entries[Math.min(entries.length, visibleCount + revealBatchSize) - 1];
      if (!nextBoundary) return;
      setVisibleThroughKeyByAlbumId((current) => {
        if (current.get(albumId) === nextBoundary.key) return current;
        const next = new Map(current);
        next.set(albumId, nextBoundary.key);
        return next;
      });
    },
    [],
  );

  function project(
    albumId: string,
    entries: readonly CreationAlbumChildVisibilityEntry[],
    requiredEntryKeys: ReadonlySet<string>,
    queryActive: boolean,
  ): CreationAlbumChildVisibilityProjection {
    if (queryActive) {
      return { visibleCount: entries.length, hiddenCount: 0, canReset: false, disclosure: null };
    }

    const defaultCount = defaultVisibleCount(entries, now);
    const requiredIndex = entries.reduce(
      (largestIndex, entry, index) => (requiredEntryKeys.has(entry.key) ? Math.max(largestIndex, index) : largestIndex),
      -1,
    );
    const resetCount = Math.max(defaultCount, requiredIndex + 1);
    const visibleThroughKey = visibleThroughKeyByAlbumId.get(albumId);
    const manualIndex = visibleThroughKey ? entries.findIndex((entry) => entry.key === visibleThroughKey) : -1;
    const visibleCount = Math.min(entries.length, Math.max(resetCount, manualIndex + 1));
    const hiddenCount = entries.length - visibleCount;
    const canReset = manualIndex + 1 > resetCount;

    return {
      visibleCount,
      hiddenCount,
      canReset,
      disclosure: hiddenCount > 0 ? 'more' : canReset ? 'fewer' : null,
    };
  }

  return { project, reset, revealMore };
}
