import { useEffect, useRef, useState } from 'react';
import type {
  AssetDto,
  CreatorPromptNodeInput,
  Locale,
  TermListItem,
  WordPaletteDto,
  WordPaletteReferenceInput,
} from '@/shared/contracts';
import type { CreatorPromptComposerHandle } from '@/renderer/components/creator/CreatorPromptComposer';
import {
  appendCreatorPromptText,
  creatorPromptText,
  normalizeCreatorPromptNodes,
  reconcileCreatorPromptNodesWithReferences,
} from '@/renderer/components/creator/creatorPromptDocument';
import type { CreationDraftPromptSnapshot } from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import { appliedWordPalettesFromReferences, type AppliedWordPalette } from '@/renderer/components/creator/utils';
import { isEditableTarget } from '@/renderer/components/creator/imageImport';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

export interface CreationMaterialsSnapshot {
  referenceAssets: AssetDto[];
  selectedTerms: TermListItem[];
  appliedPalettes: AppliedWordPalette[];
  termPromptLocale: Locale;
}

interface InitialPromptDocument extends CreationMaterialsSnapshot {
  manualPrompt: string;
  promptNodes: CreatorPromptNodeInput[];
}

export interface PromptDocumentReplacement extends CreationMaterialsSnapshot {
  promptNodes: CreatorPromptNodeInput[];
}

interface Options {
  active: boolean;
  capturePersistedPaletteReferences(): readonly WordPaletteReferenceInput[];
  initial: InitialPromptDocument;
  locale: Locale;
  palettes: readonly WordPaletteDto[];
  terms: readonly TermListItem[];
}

export function useCreatorPromptDocument(options: Options) {
  const [manualPrompt, setManualPrompt] = useState(options.initial.manualPrompt);
  const [promptNodes, setPromptNodes] = useState<CreatorPromptNodeInput[]>(options.initial.promptNodes);
  const [referenceAssets, setReferenceAssets] = useState<AssetDto[]>(options.initial.referenceAssets);
  const [selectedTerms, setSelectedTerms] = useState<TermListItem[]>(options.initial.selectedTerms);
  const [termPromptLocale, setTermPromptLocale] = useState<Locale>(options.initial.termPromptLocale);
  const [appliedPalettes, setAppliedPalettes] = useState<AppliedWordPalette[]>(options.initial.appliedPalettes);
  const promptComposerRef = useRef<CreatorPromptComposerHandle>(null);
  const promptNodesRef = useRef(promptNodes);
  const appliedPaletteCacheRef = useRef(new Map(appliedPalettes.map((item) => [item.palette.id, item])));
  const materialsRef = useRef<CreationMaterialsSnapshot>({
    referenceAssets,
    selectedTerms,
    appliedPalettes,
    termPromptLocale,
  });
  const materialsUndoRef = useRef<CreationMaterialsSnapshot[]>([]);
  const capturePersistedPaletteReferences = useStableCallback(options.capturePersistedPaletteReferences);
  const getPalettes = useStableCallback(() => options.palettes);
  const getTerms = useStableCallback(() => options.terms);
  const getLocale = useStableCallback(() => options.locale);
  promptNodesRef.current = promptNodes;
  for (const reference of appliedPalettes) appliedPaletteCacheRef.current.set(reference.palette.id, reference);
  materialsRef.current = { referenceAssets, selectedTerms, appliedPalettes, termPromptLocale };

  const replaceMaterials = useStableCallback((next: CreationMaterialsSnapshot, remember = false) => {
    const current = materialsRef.current;
    if (remember) {
      materialsUndoRef.current.push(current);
      if (materialsUndoRef.current.length > 50) materialsUndoRef.current.shift();
    } else {
      materialsUndoRef.current = [];
    }
    for (const reference of next.appliedPalettes) appliedPaletteCacheRef.current.set(reference.palette.id, reference);
    materialsRef.current = next;
    setReferenceAssets(next.referenceAssets);
    setSelectedTerms(next.selectedTerms);
    setAppliedPalettes(next.appliedPalettes);
    setTermPromptLocale(next.termPromptLocale);
  });

  const updateMaterials = useStableCallback(
    (update: (current: CreationMaterialsSnapshot) => CreationMaterialsSnapshot) => {
      const current = materialsRef.current;
      const next = update(current);
      if (
        next.referenceAssets === current.referenceAssets &&
        next.selectedTerms === current.selectedTerms &&
        next.appliedPalettes === current.appliedPalettes &&
        next.termPromptLocale === current.termPromptLocale
      )
        return;
      replaceMaterials(next, true);
    },
  );

  const updateReferenceAssets = useStableCallback((update: (current: AssetDto[]) => AssetDto[]) => {
    updateMaterials((current) => {
      const nextAssets = update(current.referenceAssets);
      return nextAssets === current.referenceAssets ? current : { ...current, referenceAssets: nextAssets };
    });
  });

  const updatePromptDocument = useStableCallback((nextNodes: CreatorPromptNodeInput[]) => {
    const normalized = normalizeCreatorPromptNodes(nextNodes);
    const termIds = normalized.flatMap((node) => (node.kind === 'TERM' ? [node.termId] : []));
    const paletteIds = normalized.flatMap((node) => (node.kind === 'RECIPE' ? [node.paletteId] : []));
    const current = materialsRef.current;
    const availablePalettes = new Map(appliedPaletteCacheRef.current);
    for (const reference of current.appliedPalettes) availablePalettes.set(reference.palette.id, reference);
    const nextMaterials = {
      ...current,
      selectedTerms: termIds.flatMap((termId) => getTerms().find((term) => term.id === termId) ?? []),
      appliedPalettes: paletteIds.flatMap((paletteId) => availablePalettes.get(paletteId) ?? []),
    };
    promptNodesRef.current = normalized;
    materialsRef.current = nextMaterials;
    setPromptNodes(normalized);
    setManualPrompt(creatorPromptText(normalized));
    setSelectedTerms(nextMaterials.selectedTerms);
    setAppliedPalettes(nextMaterials.appliedPalettes);
  });

  const capture = useStableCallback((): CreationDraftPromptSnapshot => {
    const nodes = normalizeCreatorPromptNodes(promptComposerRef.current?.getNodes() ?? promptNodesRef.current);
    const termIds = nodes.flatMap((node) => (node.kind === 'TERM' ? [node.termId] : []));
    const paletteIds = nodes.flatMap((node) => (node.kind === 'RECIPE' ? [node.paletteId] : []));
    const terms = termIds.flatMap((termId) => getTerms().find((term) => term.id === termId) ?? []);
    if (terms.length !== termIds.length) {
      throw new Error(
        getLocale() === 'zh' ? '有词条已不可用，请移除后重试' : 'A term is unavailable. Remove it and try again.',
      );
    }
    const availablePalettes = new Map(appliedPaletteCacheRef.current);
    for (const reference of appliedWordPalettesFromReferences(getPalettes(), capturePersistedPaletteReferences())) {
      availablePalettes.set(reference.palette.id, reference);
    }
    for (const reference of materialsRef.current.appliedPalettes) {
      availablePalettes.set(reference.palette.id, reference);
    }
    const palettes = paletteIds.flatMap((paletteId) => availablePalettes.get(paletteId) ?? []);
    if (palettes.length !== paletteIds.length) {
      const missingId = paletteIds.find((paletteId) => !availablePalettes.has(paletteId));
      const label = getPalettes().find((palette) => palette.id === missingId)?.name ?? missingId ?? '';
      throw new Error(
        getLocale() === 'zh'
          ? `配方“${label}”的配置已失效，请重新应用`
          : `Recipe “${label}” is no longer configured. Apply it again.`,
      );
    }
    return { nodes, manualPrompt: creatorPromptText(nodes), selectedTerms: terms, appliedPalettes: palettes };
  });

  const synchronize = useStableCallback((captured: CreationDraftPromptSnapshot) => {
    for (const reference of captured.appliedPalettes)
      appliedPaletteCacheRef.current.set(reference.palette.id, reference);
    promptNodesRef.current = captured.nodes;
    materialsRef.current = {
      ...materialsRef.current,
      selectedTerms: captured.selectedTerms,
      appliedPalettes: captured.appliedPalettes,
    };
    setPromptNodes(captured.nodes);
    setManualPrompt(captured.manualPrompt);
    setSelectedTerms(captured.selectedTerms);
    setAppliedPalettes(captured.appliedPalettes);
  });

  const replaceDocument = useStableCallback((next: PromptDocumentReplacement) => {
    const nodes = normalizeCreatorPromptNodes(next.promptNodes);
    promptNodesRef.current = nodes;
    setPromptNodes(nodes);
    setManualPrompt(creatorPromptText(nodes));
    replaceMaterials({
      referenceAssets: next.referenceAssets,
      selectedTerms: next.selectedTerms,
      appliedPalettes: next.appliedPalettes,
      termPromptLocale: next.termPromptLocale,
    });
  });

  const appendText = useStableCallback((value: string) =>
    updatePromptDocument(appendCreatorPromptText(promptNodesRef.current, value)),
  );

  useEffect(() => {
    if (!options.active) return;
    function undoMaterials(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== 'z') return;
      if (isEditableTarget(event.target)) return;
      const previous = materialsUndoRef.current.pop();
      if (!previous) return;
      event.preventDefault();
      const nodes = reconcileCreatorPromptNodesWithReferences({
        nodes: promptNodesRef.current,
        termIds: previous.selectedTerms.map((term) => term.id),
        paletteIds: previous.appliedPalettes.map((reference) => reference.palette.id),
      });
      promptNodesRef.current = nodes;
      materialsRef.current = previous;
      setPromptNodes(nodes);
      setManualPrompt(creatorPromptText(nodes));
      setReferenceAssets(previous.referenceAssets);
      setSelectedTerms(previous.selectedTerms);
      setAppliedPalettes(previous.appliedPalettes);
      setTermPromptLocale(previous.termPromptLocale);
    }
    window.addEventListener('keydown', undoMaterials);
    return () => window.removeEventListener('keydown', undoMaterials);
  }, [options.active]);

  return {
    appendText,
    appliedPaletteCacheRef,
    appliedPalettes,
    capture,
    manualPrompt,
    materialsRef,
    promptComposerRef,
    promptNodes,
    promptNodesRef,
    referenceAssets,
    replaceMaterials,
    replaceDocument,
    selectedTerms,
    setAppliedPalettes,
    setManualPrompt,
    setPromptNodes,
    setReferenceAssets,
    setSelectedTerms,
    setTermPromptLocale,
    synchronize,
    termPromptLocale,
    updateMaterials,
    updatePromptDocument,
    updateReferenceAssets,
  };
}
