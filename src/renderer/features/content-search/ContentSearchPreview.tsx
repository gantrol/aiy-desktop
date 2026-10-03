import { useEffect, useState, type ReactNode } from 'react';
import type { ContentDocument } from '@/shared/contracts/content-library';
import type { ContentLookupResult } from '@/shared/contracts/content-search';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { contentSearchSourceKey } from '@/renderer/features/content-search/contentSearchSelection';
import { ContentSearchPreviewView } from '@/renderer/features/content-search/ContentSearchPreviewView';

export function ContentSearchPreview({
  item,
  active,
  renderEditor,
}: {
  item: ContentLookupResult['items'][number] | null;
  active: boolean;
  renderEditor(document: ContentDocument, active: boolean): ReactNode;
}) {
  const [state, setState] = useState<{ key: string; document?: ContentDocument; failed?: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  const key = item ? contentSearchSourceKey(item.source) : '';
  const source = item?.source;
  useEffect(() => {
    if (!active || !source) return;
    let cancelled = false;
    setState((current) => (current?.key === key ? current : { key }));
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
  const current = state?.key === key ? state : null;
  return (
    <ContentSearchPreviewView
      item={item}
      active={active}
      current={current}
      onRetry={() => setRetry((value) => value + 1)}
      renderEditor={renderEditor}
    />
  );
}
