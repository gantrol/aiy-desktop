import { useEffect } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import type { Locale, TermListItem } from '@/shared/contracts';
import { DictionaryContextSidebar } from '@/renderer/components/dictionary/DictionaryContextSidebar';
import { useDictionarySiblingPage } from '@/renderer/components/dictionary/useDictionarySiblingPage';
import type { DictionaryBrowseContext } from '@/renderer/components/dictionary/dictionary-navigation';

export function DictionaryBrowsePane({
  active,
  context,
  locale,
  origin,
  detail,
  toggle,
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
  toggle: ReactNode;
}) {
  const page = useDictionarySiblingPage(locale, context, active && !origin);
  const updateTerm = page.updateTerm;
  useEffect(() => {
    if (detail) updateTerm(detail);
  }, [detail, updateTerm]);
  const source = origin ?? page.terms;
  const terms = detail
    ? source.some((term) => term.id === detail.id)
      ? source.map((term) => (term.id === detail.id ? detail : term))
      : [detail, ...source]
    : source;
  return (
    <DictionaryContextSidebar
      {...props}
      mode="expanded"
      headerControl={toggle}
      className="size-full border-r-0"
      onModeChange={() => undefined}
      terms={terms}
      total={origin ? terms.length : Math.max(page.total, terms.length)}
      initialLoading={!origin && page.initialLoading}
      loadingMore={!origin && page.loadingMore}
      hasMore={!origin && page.hasMore}
      loadError={origin ? '' : page.error}
      onLoadMore={page.loadMore}
    />
  );
}
