import { useCallback, useEffect, useRef, useState } from 'react';
import type { Locale, TermListItem } from '@/shared/contracts';
import {
  dictionaryBrowseQuery,
  type DictionaryBrowseContext,
} from '@/renderer/components/dictionary/dictionary-navigation';

const PAGE_SIZE = 30;

export interface DictionarySiblingPageState {
  terms: TermListItem[];
  total: number;
  initialLoading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string;
  loadMore(): void;
  updateTerm(term: TermListItem): void;
}

function contextKey(locale: Locale, context: DictionaryBrowseContext | null) {
  return context ? `${locale}:${context.classificationId ?? 'unclassified'}:${context.anchorTermId}` : '';
}

export function useDictionarySiblingPage(
  locale: Locale,
  context: DictionaryBrowseContext | null,
): DictionarySiblingPageState {
  const [terms, setTerms] = useState<TermListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [initialLoading, setInitialLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const requestIdRef = useRef(0);
  const termsRef = useRef<TermListItem[]>([]);
  const hasMoreRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const key = contextKey(locale, context);

  termsRef.current = terms;
  hasMoreRef.current = hasMore;
  loadingMoreRef.current = loadingMore;

  const pageInput = useCallback(
    (offset: number) => {
      if (!context) return null;
      const browseQuery = dictionaryBrowseQuery(context);
      return {
        locale,
        query: '',
        ...browseQuery,
        excludeDrafts: false,
        excludeUncited: false,
        includeArchived: false,
        prioritizeTermId: context.anchorTermId,
        offset,
        limit: PAGE_SIZE,
      };
    },
    [context, locale],
  );

  useEffect(() => {
    const input = pageInput(0);
    const requestId = ++requestIdRef.current;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setTerms([]);
    setTotal(0);
    setHasMore(false);
    setError('');
    if (!input) {
      setInitialLoading(false);
      return undefined;
    }
    let alive = true;
    setInitialLoading(true);
    void window.desktopApi
      .dictionarySearchPage(input)
      .then((page) => {
        if (!alive || requestId !== requestIdRef.current) return;
        setTerms(page.items);
        setTotal(page.total);
        setHasMore(page.hasMore);
      })
      .catch((reason) => {
        if (alive && requestId === requestIdRef.current) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (alive && requestId === requestIdRef.current) setInitialLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [key, pageInput, retryKey]);

  const loadMore = useCallback(() => {
    if (!context || initialLoading || loadingMoreRef.current) return;
    if (error && termsRef.current.length === 0) {
      setRetryKey((current) => current + 1);
      return;
    }
    if (!hasMoreRef.current) return;
    const input = pageInput(termsRef.current.length);
    if (!input) return;
    const requestId = ++requestIdRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError('');
    void window.desktopApi
      .dictionarySearchPage(input)
      .then((page) => {
        if (requestId !== requestIdRef.current) return;
        setTerms((current) => {
          const ids = new Set(current.map((term) => term.id));
          return [...current, ...page.items.filter((term) => !ids.has(term.id))];
        });
        setTotal(page.total);
        setHasMore(page.hasMore);
      })
      .catch((reason) => {
        if (requestId === requestIdRef.current) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (requestId === requestIdRef.current) {
          loadingMoreRef.current = false;
          setLoadingMore(false);
        }
      });
  }, [context, error, initialLoading, pageInput]);

  const updateTerm = useCallback((term: TermListItem) => {
    setTerms((current) => current.map((item) => (item.id === term.id ? term : item)));
  }, []);

  return { terms, total, initialLoading, loadingMore, hasMore, error, loadMore, updateTerm };
}
