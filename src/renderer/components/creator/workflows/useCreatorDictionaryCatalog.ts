import { useEffect, useMemo, useState } from 'react';
import type { BootstrapDto, CreationDictionaryScopeDto, Locale, WordPaletteDto } from '@/shared/contracts';
import { useCreatorTermSearch } from '@/renderer/components/creator/useCreatorTermSearch';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface Options {
  active: boolean;
  data: Pick<BootstrapDto, 'terms' | 'wordPalettes'>;
  initialScope: CreationDictionaryScopeDto;
  loadFailedMessage: string;
  locale: Locale;
  notify(message: string): void;
}

const activePalettes = (palettes: readonly WordPaletteDto[]) =>
  palettes.filter((palette) => palette.status === 'ACTIVE');

export function useCreatorDictionaryCatalog(options: Options) {
  const notify = useStableCallback(options.notify);
  const [wordPalettes, setWordPalettes] = useState(() => activePalettes(options.data.wordPalettes));
  const [dictionaryScope, setDictionaryScope] = useState(options.initialScope);
  const [scopePaletteRevisionIds, setScopePaletteRevisionIds] = useState<string[]>([]);
  const dictionaryPackReleaseIds = useMemo(
    () => dictionaryScope.sources.map((source) => source.packReleaseId),
    [dictionaryScope.sources],
  );
  const { query, results, setQuery } = useCreatorTermSearch({
    active: options.active,
    locale: options.locale,
    initialTerms: options.data.terms,
    dictionaryScope,
    packReleaseIds: dictionaryPackReleaseIds,
    loadFailedMessage: options.loadFailedMessage,
    notify: options.notify,
  });
  const scopedWordPalettes = useMemo(
    () =>
      dictionaryScope.mode === 'ALL'
        ? wordPalettes
        : wordPalettes.filter((palette) => scopePaletteRevisionIds.includes(palette.revisionId)),
    [dictionaryScope.mode, scopePaletteRevisionIds, wordPalettes],
  );

  const rememberPalette = useStableCallback((palette: WordPaletteDto) => {
    setWordPalettes((current) =>
      palette.status === 'ACTIVE'
        ? [palette, ...current.filter((item) => item.id !== palette.id)]
        : current.filter((item) => item.id !== palette.id),
    );
  });

  useEffect(() => {
    setWordPalettes(activePalettes(options.data.wordPalettes));
  }, [options.data.wordPalettes]);

  useEffect(() => {
    if (!options.active) return undefined;
    if (dictionaryScope.mode === 'ALL') {
      setScopePaletteRevisionIds([]);
      return undefined;
    }
    let current = true;
    void window.desktopApi
      .dictionaryScopeResolve({
        packReleaseIds: dictionaryPackReleaseIds,
        includeLocalTerms: dictionaryScope.includeLocalTerms,
      })
      .then((scope) => {
        if (current) setScopePaletteRevisionIds(scope.paletteRevisionIds);
      })
      .catch((reason) => {
        if (current) notify(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      current = false;
    };
  }, [dictionaryPackReleaseIds, dictionaryScope.includeLocalTerms, dictionaryScope.mode, options.active, notify]);

  return {
    dictionaryPackReleaseIds,
    dictionaryScope,
    query,
    rememberPalette,
    results,
    scopedWordPalettes,
    setDictionaryScope,
    setQuery,
  };
}
