import { useEffect, useState } from 'react';
import type { ContentDocument } from '@/shared/contracts/content-library';
import type { ContentLookupResult } from '@/shared/contracts/content-search';
import { ContentReferenceBody } from '@/renderer/features/content-editor/ContentReferenceBody';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { contentSearchSourceKey } from '@/renderer/features/content-search/contentSearchSelection';
import { ContentSearchHighlight } from '@/renderer/features/content-search/ContentSearchHighlight';
import { contentSearchTerms } from '@/shared/content-search-highlights';
import { Button } from '@/renderer/components/ui/button';
import { Skeleton } from '@/renderer/components/ui/skeleton';
import { useI18n } from '@/renderer/i18n/useI18n';

export function ContentSearchPreview({
  item,
  active,
  query,
}: {
  item: ContentLookupResult['items'][number] | null;
  active: boolean;
  query: string;
}) {
  const { messages } = useI18n();
  const [state, setState] = useState<{ key: string; document?: ContentDocument; failed?: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  const key = item ? `${contentSearchSourceKey(item.source)}:${item.updatedAt}` : '';
  const source = item?.source;
  useEffect(() => {
    if (!active || !source) return;
    let cancelled = false;
    setState({ key });
    void contentLibraryApi()
      .readCurrent(source)
      .then((document) => {
        if (!cancelled) setState({ key, document });
      })
      .catch(() => {
        if (!cancelled) setState({ key, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [active, key, source, retry]);
  if (!item)
    return (
      <div className="grid min-h-32 flex-1 place-items-center text-sm text-muted-foreground">
        {messages.workbench.selectResult}
      </div>
    );
  const current = state?.key === key ? state : null;
  if (current?.failed)
    return (
      <div role="alert" className="flex items-center gap-3 p-4 text-sm">
        {messages.referenceOutline.lookup.notAvailable}
        <Button variant="secondary" size="sm" onClick={() => setRetry((value) => value + 1)}>
          {messages.workbench.retry}
        </Button>
      </div>
    );
  if (!current?.document)
    return (
      <div role="status" aria-label={messages.workbench.preview} className="space-y-3 p-5">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    );
  const doc = current.document;
  return (
    <div key={key} data-search-preview className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
      {query.trim() && item.preview && (
        <blockquote className="mb-5 border-l-2 pl-3 text-sm text-muted-foreground">
          <ContentSearchHighlight text={item.preview} terms={contentSearchTerms(query)} />
        </blockquote>
      )}
      <ContentReferenceBody markdown={doc.markdown} media={doc.media} source={doc.source} />
    </div>
  );
}
