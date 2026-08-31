import type {
  CreationItemDto,
  InspirationStashContentInput,
  InspirationStashDto,
  Locale,
  TermListItem,
  WordPaletteDto,
} from '@/shared/contracts';
import { creatorPromptNodesFromReferences } from '@/renderer/components/creator/creatorPromptDocument';
import type { CreationDraftPromptSnapshot } from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import {
  inspirationSaveIdentity,
  useCreatorInspirationWorkflow,
} from '@/renderer/components/creator/workflows/useCreatorInspirationWorkflow';
import type { PromptDocumentReplacement } from '@/renderer/components/creator/workflows/useCreatorPromptDocument';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface Options {
  capturePrompt(): CreationDraftPromptSnapshot;
  creationItems: readonly CreationItemDto[];
  creationMode: 'existing' | 'new';
  currentSeriesId: string | null;
  getCreationDraftId(): string | null;
  locale: Locale;
  manualPrompt: string;
  notify(message: string): void;
  onOpenStash(stash: InspirationStashDto): void;
  palettes: readonly WordPaletteDto[];
  promptNodes: CreationDraftPromptSnapshot['nodes'];
  referenceAssetIds: readonly string[];
  refresh(): Promise<void>;
  replacePromptDocument(document: PromptDocumentReplacement): void;
  restartNewCreation(albumId: string | null): Promise<boolean>;
  saveCreationDraft(prompt: CreationDraftPromptSnapshot): Promise<{ id: string }>;
  selectedStashId: string | null;
  selectedTerms: readonly TermListItem[];
  synchronizePrompt(prompt: CreationDraftPromptSnapshot): void;
  targetAlbumId: string | null;
  termPromptLocale: Locale;
  terms: readonly TermListItem[];
  wordPaletteReferences: InspirationStashContentInput['wordPaletteReferences'];
}

function currentContent(options: Options, prompt: CreationDraftPromptSnapshot): InspirationStashContentInput {
  return {
    schemaVersion: 1,
    manualPrompt: prompt.manualPrompt,
    promptNodes: prompt.nodes,
    referenceAssetIds: [...options.referenceAssetIds],
    termPromptLocale: options.termPromptLocale,
    termIds: prompt.selectedTerms.map((term) => term.id),
    wordPaletteReferences: options.wordPaletteReferences.map((reference) => ({
      ...reference,
      parameterValues: { ...reference.parameterValues },
    })),
  };
}

export function useCreatorInspirationSession(options: Options) {
  const renderedPrompt: CreationDraftPromptSnapshot = {
    manualPrompt: options.manualPrompt,
    nodes: options.promptNodes,
    selectedTerms: [...options.selectedTerms],
    appliedPalettes: [],
  };
  const renderedContent = currentContent(options, renderedPrompt);
  const currentContentKey = JSON.stringify(renderedContent);
  const workflow = useCreatorInspirationWorkflow({
    captureSaveIdentity: () =>
      inspirationSaveIdentity({
        content: renderedContent,
        creationDraftId: options.creationMode === 'new' ? options.getCreationDraftId() : null,
        currentSeriesId: options.currentSeriesId,
        restartNewCreation: options.creationMode === 'new',
        selectedStashId: options.selectedStashId,
        targetAlbumId: options.targetAlbumId,
      }),
    creationItems: options.creationItems,
    locale: options.locale,
    notify: options.notify,
    onOpenStash: options.onOpenStash,
    refresh: options.refresh,
    restartNewCreation: options.restartNewCreation,
  });

  const restore = useStableCallback((stash: InspirationStashDto) => {
    const { referenceAssets, ...content } = stash.content;
    const selectedTerms = content.termIds.flatMap((termId) => options.terms.find((term) => term.id === termId) ?? []);
    const appliedPalettes = content.wordPaletteReferences.flatMap((reference) => {
      const palette = options.palettes.find((item) => item.id === reference.paletteId);
      const revision = palette?.revisions.find((item) => item.id === reference.paletteRevisionId);
      return palette && revision
        ? [{ palette, revision, parameterValues: reference.parameterValues, promptLocale: reference.promptLocale }]
        : [];
    });
    options.replacePromptDocument({
      promptNodes: creatorPromptNodesFromReferences({
        manualPrompt: content.manualPrompt,
        termIds: content.termIds,
        wordPaletteReferences: content.wordPaletteReferences,
        nodes: content.promptNodes,
      }),
      referenceAssets,
      selectedTerms,
      appliedPalettes,
      termPromptLocale: content.termPromptLocale,
    });
    workflow.rememberSavedContent(content);
  });

  const stash = useStableCallback(async () => {
    if (workflow.busy) return;
    let prompt: CreationDraftPromptSnapshot;
    try {
      prompt = options.capturePrompt();
    } catch (reason) {
      options.notify(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    let creationDraftId: string | null = null;
    if (options.creationMode === 'new') {
      try {
        creationDraftId = (await options.saveCreationDraft(prompt)).id;
      } catch (reason) {
        options.notify(reason instanceof Error ? reason.message : String(reason));
        return;
      }
    }
    const content = currentContent(options, prompt);
    options.synchronizePrompt(prompt);
    await workflow.saveInspiration({
      content,
      creationDraftId,
      currentSeriesId: options.currentSeriesId,
      restartNewCreation: options.creationMode === 'new',
      selectedStashId: options.selectedStashId,
      targetAlbumId: options.targetAlbumId,
    });
  });

  return {
    busy: workflow.busy,
    clearSavedContent: workflow.clearSavedContent,
    currentContentKey,
    rememberSavedContent: workflow.rememberSavedContent,
    restore,
    savedContentKey: workflow.savedContentKey,
    stash,
  };
}
