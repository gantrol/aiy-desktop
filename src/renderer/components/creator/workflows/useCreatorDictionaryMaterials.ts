import { useEffect, useRef, useState, type RefObject } from 'react';
import type { CreatorPromptNodeInput, Locale, TermListItem, WordPaletteDto } from '@/shared/contracts';
import type { CreatorPromptComposerHandle } from '@/renderer/components/creator/CreatorPromptComposer';
import type { CreationMaterialsSnapshot } from '@/renderer/components/creator/workflows/useCreatorPromptDocument';
import type { AppliedWordPalette } from '@/renderer/components/creator/utils';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

export type CreatorDictionaryFocusTarget = { kind: 'term' | 'palette'; id: string } | null;
export type CreatorPaletteInspector = { mode: 'view' | 'edit'; palette: WordPaletteDto } | null;

interface Options {
  defaultPromptLocale: Locale | null;
  effectiveTermIds: readonly string[];
  locale: Locale;
  materialsRef: RefObject<CreationMaterialsSnapshot>;
  notify(message: string): void;
  onPaletteSaved(palette: WordPaletteDto): void;
  promptComposerRef: RefObject<CreatorPromptComposerHandle | null>;
  promptNodes: readonly CreatorPromptNodeInput[];
  recipeAppliedMessage: string;
  recipeSavedMessage: string;
  setTermQuery(value: string): void;
  termPromptLocale: Locale;
  terms: readonly TermListItem[];
  updateMaterials(update: (current: CreationMaterialsSnapshot) => CreationMaterialsSnapshot): void;
  updatePromptDocument(nodes: CreatorPromptNodeInput[]): void;
}

export function useCreatorDictionaryMaterials(options: Options) {
  const [paletteToApply, setPaletteToApply] = useState<WordPaletteDto | null>(null);
  const [paletteInspector, setPaletteInspector] = useState<CreatorPaletteInspector>(null);
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  const [dictionaryFocusTarget, setDictionaryFocusTarget] = useState<CreatorDictionaryFocusTarget>(null);
  const pendingRecipePositionRef = useRef<number | null>(null);
  const paletteFrameRef = useRef<number | null>(null);
  const handoffFrameRef = useRef<number | null>(null);

  const openTerm = useStableCallback((term: TermListItem) => {
    if (handoffFrameRef.current !== null) cancelAnimationFrame(handoffFrameRef.current);
    setDictionaryOpen(false);
    handoffFrameRef.current = requestAnimationFrame(() => {
      handoffFrameRef.current = requestAnimationFrame(() => {
        handoffFrameRef.current = null;
        options.setTermQuery(term.title);
        setDictionaryFocusTarget({ kind: 'term', id: term.id });
        setDictionaryOpen(true);
      });
    });
  });

  const openPalette = useStableCallback((paletteId: string) => {
    if (handoffFrameRef.current !== null) cancelAnimationFrame(handoffFrameRef.current);
    setDictionaryOpen(false);
    handoffFrameRef.current = requestAnimationFrame(() => {
      handoffFrameRef.current = requestAnimationFrame(() => {
        handoffFrameRef.current = null;
        setDictionaryFocusTarget({ kind: 'palette', id: paletteId });
        setDictionaryOpen(true);
      });
    });
  });

  const clearMaterials = useStableCallback(() => {
    if (options.promptComposerRef.current) options.promptComposerRef.current.clearStructuredNodes();
    else options.updatePromptDocument(options.promptNodes.filter((node) => node.kind === 'TEXT'));
  });

  const removePalette = useStableCallback((id: string) => {
    if (options.promptComposerRef.current) options.promptComposerRef.current.removeRecipe(id);
    else
      options.updatePromptDocument(
        options.promptNodes.filter((node) => node.kind !== 'RECIPE' || node.paletteId !== id),
      );
  });

  const toggleTerm = useStableCallback((term: TermListItem) => {
    if (options.materialsRef.current.selectedTerms.some((item) => item.id === term.id)) {
      if (options.promptComposerRef.current) options.promptComposerRef.current.removeTerm(term.id);
      else
        options.updatePromptDocument(
          options.promptNodes.filter((node) => node.kind !== 'TERM' || node.termId !== term.id),
        );
    } else if (options.promptComposerRef.current) options.promptComposerRef.current.insertTerm(term.id);
    else
      options.updatePromptDocument([
        ...options.promptNodes,
        { kind: 'TERM', termId: term.id, promptLocale: options.defaultPromptLocale ?? options.termPromptLocale },
      ]);
  });

  const addHistoricalTerm = useStableCallback((termId: string) => {
    const term = options.terms.find((item) => item.id === termId);
    if (!term || options.effectiveTermIds.includes(termId)) return;
    if (options.promptComposerRef.current) options.promptComposerRef.current.insertTerm(term.id);
    else
      options.updatePromptDocument([
        ...options.promptNodes,
        { kind: 'TERM', termId: term.id, promptLocale: options.defaultPromptLocale ?? options.termPromptLocale },
      ]);
  });

  const applyPalette = useStableCallback(
    (palette: WordPaletteDto, parameterValues: Record<string, string>, promptLocale: Locale) => {
      const alreadyApplied = options.materialsRef.current.appliedPalettes.some(
        (reference) => reference.palette.id === palette.id,
      );
      const applied: AppliedWordPalette = {
        palette,
        revision: palette.revisions.find((revision) => revision.id === palette.revisionId) ?? palette.revisions[0],
        parameterValues,
        promptLocale,
      };
      options.updateMaterials((current) => ({
        ...current,
        appliedPalettes: alreadyApplied
          ? current.appliedPalettes.map((reference) => (reference.palette.id === palette.id ? applied : reference))
          : [...current.appliedPalettes, applied],
      }));
      if (!alreadyApplied) {
        if (options.promptComposerRef.current)
          options.promptComposerRef.current.insertRecipe(palette.id, pendingRecipePositionRef.current ?? undefined);
        else options.updatePromptDocument([...options.promptNodes, { kind: 'RECIPE', paletteId: palette.id }]);
      } else options.promptComposerRef.current?.focusRecipe(palette.id);
      pendingRecipePositionRef.current = null;
      options.notify(options.recipeAppliedMessage);
    },
  );

  const changePaletteLocale = useStableCallback((paletteId: string, promptLocale: Locale) => {
    options.updateMaterials((current) => ({
      ...current,
      appliedPalettes: current.appliedPalettes.map((reference) =>
        reference.palette.id === paletteId ? { ...reference, promptLocale } : reference,
      ),
    }));
  });

  const requestPalette = useStableCallback((palette: WordPaletteDto, position: number | null = null) => {
    pendingRecipePositionRef.current = position;
    if (paletteFrameRef.current !== null) cancelAnimationFrame(paletteFrameRef.current);
    const alreadyApplied = options.materialsRef.current.appliedPalettes.some(
      (reference) => reference.palette.id === palette.id,
    );
    if (!alreadyApplied && options.defaultPromptLocale && palette.parameters.length === 0) {
      applyPalette(palette, {}, options.defaultPromptLocale);
      return;
    }
    paletteFrameRef.current = requestAnimationFrame(() => {
      paletteFrameRef.current = null;
      setPaletteToApply(palette);
    });
  });

  const paletteSaved = useStableCallback((palette: WordPaletteDto) => {
    options.onPaletteSaved(palette);
    options.notify(options.recipeSavedMessage);
  });

  const dismissPaletteApplication = useStableCallback(() => {
    pendingRecipePositionRef.current = null;
    setPaletteToApply(null);
  });

  const changeDictionaryOpen = useStableCallback((open: boolean) => {
    if (!open && (paletteToApply || paletteInspector)) return;
    setDictionaryOpen(open);
    if (!open) setDictionaryFocusTarget(null);
  });

  const closeDictionary = useStableCallback(() => {
    setDictionaryOpen(false);
    setDictionaryFocusTarget(null);
  });

  useEffect(
    () => () => {
      if (paletteFrameRef.current !== null) cancelAnimationFrame(paletteFrameRef.current);
      if (handoffFrameRef.current !== null) cancelAnimationFrame(handoffFrameRef.current);
    },
    [],
  );

  return {
    addHistoricalTerm,
    applyPalette,
    changeDictionaryOpen,
    changePaletteLocale,
    clearMaterials,
    closeDictionary,
    dictionaryFocusTarget,
    dictionaryOpen,
    dismissPaletteApplication,
    openPalette,
    openTerm,
    paletteInspector,
    paletteSaved,
    paletteToApply,
    removePalette,
    requestPalette,
    setDictionaryFocusTarget,
    setDictionaryOpen,
    setPaletteInspector,
    toggleTerm,
  };
}
