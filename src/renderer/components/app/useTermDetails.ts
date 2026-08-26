import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { BootstrapDto, Locale } from '@/shared/contracts';
import type { AppView } from '@/renderer/components/app/AppSidebar';

interface Options {
  data: BootstrapDto | null;
  view: AppView;
  refreshRevision: { current: number };
  localeRef: { current: Locale };
  setData: Dispatch<SetStateAction<BootstrapDto | null>>;
  setDataRevision: Dispatch<SetStateAction<number>>;
  notify(message: string): void;
}

export function useTermDetails({ data, view, refreshRevision, localeRef, setData, setDataRevision, notify }: Options) {
  const inFlightRef = useRef<{ revision: number; promise: Promise<void> } | null>(null);
  const ensure = useCallback(() => {
    if (!data || data.termDetailsIncluded !== false) return Promise.resolve();

    const revision = refreshRevision.current;
    const existing = inFlightRef.current;
    if (existing?.revision === revision) return existing.promise;

    const requestedLocale = data.locale;
    const request = window.desktopApi.dictionaryDetails(requestedLocale).then((details) => {
      if (refreshRevision.current !== revision || localeRef.current !== requestedLocale) return;
      setData((current) =>
        current?.locale === requestedLocale
          ? {
              ...current,
              terms: details.terms,
              wordPalettes: details.wordPalettes,
              termDetailsIncluded: true,
            }
          : current,
      );
      setDataRevision((current) => current + 1);
    });
    const tracked = request.finally(() => {
      if (inFlightRef.current?.promise === tracked) inFlightRef.current = null;
    });
    inFlightRef.current = { revision, promise: tracked };
    return tracked;
  }, [data, localeRef, refreshRevision, setData, setDataRevision]);
  const request = useCallback(async () => {
    try {
      await ensure();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    }
  }, [ensure, notify]);

  useEffect(() => {
    if (view !== 'dictionary' && view !== 'gallery' && view !== 'transitionShowcase' && view !== 'packs') return;
    void request();
  }, [request, view]);

  return request;
}
