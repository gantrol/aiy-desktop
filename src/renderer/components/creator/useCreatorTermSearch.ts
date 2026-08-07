import { useEffect, useRef, useState } from 'react';
import type { CreationDictionaryScopeDto, Locale, TermListItem } from '@/shared/contracts';

interface CreatorTermSearchOptions {
  active: boolean;
  locale: Locale;
  initialTerms: TermListItem[];
  dictionaryScope: CreationDictionaryScopeDto;
  packReleaseIds: string[];
  loadFailedMessage: string;
  notify(message: string): void;
}

export function useCreatorTermSearch({
  active,
  locale,
  initialTerms,
  dictionaryScope,
  packReleaseIds,
  loadFailedMessage,
  notify,
}: CreatorTermSearchOptions) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(initialTerms);
  const requestRevision = useRef(0);

  useEffect(() => {
    const revision = ++requestRevision.current;
    if (!active) return;
    if (!query.trim() && dictionaryScope.mode === 'ALL') {
      setResults(initialTerms);
      return;
    }
    const timer = window.setTimeout(() => {
      void window.desktopApi
        .dictionarySearch({
          locale,
          query,
          facetValueIds: [],
          excludeDrafts: false,
          excludeUncited: false,
          includeArchived: false,
          ...(dictionaryScope.mode === 'SELECTED'
            ? {
                packReleaseIds,
                includeLocalTerms: dictionaryScope.includeLocalTerms,
              }
            : {}),
        })
        .then((nextResults) => {
          if (requestRevision.current === revision) setResults(nextResults);
        })
        .catch((reason) => {
          if (requestRevision.current !== revision) return;
          notify(`${loadFailedMessage}: ${reason instanceof Error ? reason.message : String(reason)}`);
        });
    }, 140);
    return () => {
      window.clearTimeout(timer);
      if (requestRevision.current === revision) requestRevision.current += 1;
    };
  }, [
    active,
    query,
    locale,
    initialTerms,
    dictionaryScope.mode,
    dictionaryScope.includeLocalTerms,
    packReleaseIds.join('|'),
    loadFailedMessage,
    notify,
  ]);

  return { query, setQuery, results };
}
