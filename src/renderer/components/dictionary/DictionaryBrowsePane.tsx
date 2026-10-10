import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ComponentProps } from 'react';
import type { Locale, TermListItem } from '@/shared/contracts';
import { DictionaryContextSidebar } from '@/renderer/components/dictionary/DictionaryContextSidebar';
import { useDictionarySiblingPage } from '@/renderer/components/dictionary/useDictionarySiblingPage';
import type { DictionaryBrowseContext } from '@/renderer/components/dictionary/dictionary-navigation';

const ORIGIN_PAGE_SIZE = 30;

export function DictionaryBrowsePane({
  active,
  context,
  locale,
  origin,
  detail,
  currentTermId,
  ...props
}: Omit<
  ComponentProps<typeof DictionaryContextSidebar>,
  | 'mode'
  | 'onModeChange'
  | 'terms'
  | 'total'
  | 'initialLoading'
  | 'loadingMore'
  | 'hasMore'
  | 'loadError'
  | 'onLoadMore'
> & {
  active: boolean;
  context: DictionaryBrowseContext | null;
  locale: Locale;
  origin: TermListItem[] | null;
  detail: TermListItem | null;
}) {
  const page = useDictionarySiblingPage(locale, context, active && !origin);
  const [originPage, setOriginPage] = useState({ source: origin, limit: ORIGIN_PAGE_SIZE });
  const originLimit = originPage.source === origin ? originPage.limit : ORIGIN_PAGE_SIZE;
  const updateTerm = page.updateTerm;
  useEffect(() => {
    if (detail && !origin) updateTerm(detail);
  }, [detail, origin, updateTerm]);
  // Reuse the overview's search results, but admit rows only as the user scrolls.
  const source = useMemo(() => origin?.slice(0, originLimit) ?? page.terms, [origin, originLimit, page.terms]);
  const terms = useMemo(() => {
    const current = detail ?? origin?.find((term) => term.id === currentTermId);
    if (!current) return source;
    return source.some((term) => term.id === current.id)
      ? source.map((term) => (term.id === current.id ? current : term))
      : [current, ...source];
  }, [currentTermId, detail, origin, source]);
  const loadNextPage = page.loadMore;
  const loadMore = useCallback(() => {
    if (!active) return;
    if (!origin) {
      loadNextPage();
      return;
    }
    setOriginPage((current) => {
      const limit = current.source === origin ? current.limit : ORIGIN_PAGE_SIZE;
      return limit >= origin.length
        ? current
        : { source: origin, limit: Math.min(origin.length, limit + ORIGIN_PAGE_SIZE) };
    });
  }, [active, loadNextPage, origin]);
  return (
    <DictionaryContextSidebar
      {...props}
      mode="expanded"
      headerControl={null}
      className="size-full border-r-0"
      onModeChange={() => undefined}
      terms={terms}
      currentTermId={currentTermId}
      total={origin ? origin.length : Math.max(page.total, terms.length)}
      initialLoading={!origin && page.initialLoading}
      loadingMore={!origin && page.loadingMore}
      hasMore={active && (origin ? originLimit < origin.length : page.hasMore)}
      loadError={origin ? '' : page.error}
      onLoadMore={loadMore}
    />
  );
}
