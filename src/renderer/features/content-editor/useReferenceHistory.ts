import { useEffect, useState } from 'react';
import type { ArticleRevisionDto } from '@/shared/contracts';
import type { ReferenceHistoryResult } from '@/shared/contracts/content-library';
import { contentMarkdownReferences } from '@/shared/content-markdown';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';

export function useReferenceHistory(snapshot: ArticleRevisionDto | null, spaceId: string) {
  const [result, setResult] = useState<{ revisionId: string; data?: ReferenceHistoryResult; failed?: boolean } | null>(
    null,
  );
  const needed = Boolean(
    snapshot?.content.markdown.includes(':::aiy-block') && contentMarkdownReferences(snapshot.content.markdown).length,
  );
  useEffect(() => {
    if (!needed || !snapshot) return;
    let current = true;
    const { articleId, revisionId } = snapshot;
    setResult(null);
    void contentLibraryApi()
      .referenceHistory(articleId, revisionId, spaceId)
      .then((data) => {
        if (!current) return;
        if (data.articleId !== articleId || data.revisionId !== revisionId || data.spaceId !== spaceId)
          throw new Error('REFERENCE_HISTORY_UNAVAILABLE');
        setResult({ revisionId, data });
      })
      .catch(() => {
        if (current) setResult({ revisionId, failed: true });
      });
    return () => {
      current = false;
    };
  }, [snapshot, needed, spaceId]);
  const data = result?.revisionId === snapshot?.revisionId ? result : null;
  return { needed, loading: needed && !data, failed: data?.failed, history: data?.data };
}

export function historicalDisplayRevision(
  snapshot: ArticleRevisionDto,
  history?: ReferenceHistoryResult,
): ArticleRevisionDto {
  if (!history || history.state !== 'COMPLETE') return snapshot;
  return {
    ...snapshot,
    content: {
      ...snapshot.content,
      markdown: history.markdown,
      mediaBindings: [
        ...new Map(
          [...snapshot.content.mediaBindings, ...history.media.map(({ path, assetId }) => ({ path, assetId }))].map(
            (binding) => [binding.path, binding],
          ),
        ).values(),
      ],
    },
  };
}
