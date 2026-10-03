import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArticleRevisionSummaryDto } from '@/shared/contracts';

const REVISION_PAGE_SIZE = 50;

function mergeRevisionPages(
  current: readonly ArticleRevisionSummaryDto[],
  incoming: readonly ArticleRevisionSummaryDto[],
) {
  const revisions = new Map(current.map((revision) => [revision.revisionId, revision]));
  incoming.forEach((revision) => revisions.set(revision.revisionId, revision));
  return [...revisions.values()].sort((left, right) => right.revisionNo - left.revisionNo);
}

export function useArticleRevisionIndex(
  articleId: string,
  currentRevisionId: string,
  open: boolean,
  initialRevision?: Pick<ArticleRevisionSummaryDto, 'revisionId' | 'revisionNo'>,
) {
  const initialId = initialRevision?.revisionId;
  const initialBeforeNo = initialRevision ? initialRevision.revisionNo + 1 : null;
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
        const selectedId = initialId ?? result.currentRevisionId;
        if (selection === 'current' && initialId && !result.revisions.some((r) => r.revisionId === initialId)) {
          throw new Error('Requested article revision is unavailable');
        }
        setRevisions((current) =>
          beforeRevisionNo === null ? result.revisions : mergeRevisionPages(current, result.revisions),
        );
        setResolvedCurrentRevisionId(result.currentRevisionId);
        setNextBeforeRevisionNo(result.nextBeforeRevisionNo);
        if (selection === 'current') {
          const current = result.revisions.find((revision) => revision.revisionId === selectedId);
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
    [articleId, initialId],
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
    void loadPage(initialBeforeNo, 'current');
    return () => {
      requestRef.current += 1;
    };
  }, [currentRevisionId, initialBeforeNo, loadPage, open]);

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
    reload: () => loadPage(initialBeforeNo, 'current'),
    selectNewer,
    selectOlder,
    selectRevision,
  };
}
