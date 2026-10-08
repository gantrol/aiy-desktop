import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContentLookupResult } from '@/shared/contracts/content-search';
import { useArticleEditorSessionFlush } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { contentSearchSourceKey } from '@/renderer/features/content-search/contentSearchSelection';

type SearchItem = ContentLookupResult['items'][number];

export function useContentSearchSelection(active: boolean, context: string, saveFailed: string, query: string) {
  const flush = useArticleEditorSessionFlush();
  const [selected, setSelected] = useState<SearchItem | null>(null);
  const [selectedQuery, setSelectedQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const request = useRef(0);
  const invalidate = useCallback(() => {
    request.current++;
  }, []);
  useEffect(() => {
    pending.current = false;
    setBusy(false);
    setError('');
    return invalidate;
  }, [active, context, invalidate]);
  const select = async (item: SearchItem) => {
    if (!active || pending.current) return false;
    if (selected && contentSearchSourceKey(selected.source) === contentSearchSourceKey(item.source)) {
      setSelectedQuery(query);
      return true;
    }
    if (!selected) {
      setSelected(item);
      setSelectedQuery(query);
      return true;
    }
    const current = ++request.current;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (!(await flush())) throw new Error('CONTENT_EDITOR_SAVE_PENDING');
      if (current !== request.current) return false;
      setSelected(item);
      setSelectedQuery(query);
      return true;
    } catch {
      if (current === request.current) setError(saveFailed);
      return false;
    } finally {
      if (current === request.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  };
  return { selected, selectedQuery, select, busy, error };
}
