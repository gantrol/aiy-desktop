import { useEffect, useState } from 'react';
import type { ContentDocument } from '@/shared/contracts/content-library';
import { ContentReferenceBody } from '@/renderer/features/content-editor/ContentReferenceBody';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { useWorkTableEditing } from '@/renderer/features/work-tracking/WorkTableEditing';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';

export function WorkSourcePreview({ articleId }: { articleId: string }) {
  const l = useI18n().messages.workTracking;
  const edit = useWorkTableEditing();
  const revision = edit.article(articleId)?.revisionId;
  const key = `${edit.data.spaceId}:${articleId}:${revision}`;
  const [state, setState] = useState<{ key: string; document?: ContentDocument; failed?: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void contentLibraryApi()
      .readCurrent({ kind: 'ARTICLE', id: articleId })
      .then((document) => {
        if (!cancelled) setState({ key, document });
      })
      .catch(() => {
        if (!cancelled) setState({ key, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [articleId, key, retry]);
  const current = state?.key === key ? state : null;
  if (current?.failed)
    return (
      <div role="alert" className="flex items-center gap-2 text-sm">
        {l.noSource}
        <Button size="sm" variant="ghost" onClick={() => setRetry((old) => old + 1)}>
          {l.refresh}
        </Button>
      </div>
    );
  if (!current?.document)
    return (
      <div role="status" className="text-sm text-muted-foreground">
        {l.loading}
      </div>
    );
  const doc = current.document;
  return (
    <div className="max-h-[55vh] min-w-0 overflow-y-auto overscroll-contain">
      <ContentReferenceBody markdown={doc.markdown} media={doc.media} source={doc.source} />
    </div>
  );
}
