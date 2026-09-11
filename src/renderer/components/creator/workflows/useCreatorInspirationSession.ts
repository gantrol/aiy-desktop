import { creatorPromptNodesFromReferences } from '@/renderer/components/creator/creatorPromptDocument';
import type { CreationDraftPromptSnapshot } from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import {
  inspirationSaveIdentity,
  useCreatorInspirationWorkflow,
} from '@/renderer/components/creator/workflows/useCreatorInspirationWorkflow';
import type { PromptDocumentReplacement } from '@/renderer/components/creator/workflows/useCreatorPromptDocument';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { blockDocumentAssetIds } from '@/shared/contracts/block-document';
import type {
  CreationItemDto,
  InspirationStashContentInput,
  InspirationStashDto,
  Locale,
  TermListItem,
  WordPaletteDto,
} from '@/shared/contracts';

interface Options {
  capturePrompt(): CreationDraftPromptSnapshot;
  settings: NonNullable<InspirationStashContentInput['settings']>;
  restoreSettings(settings: NonNullable<InspirationStashContentInput['settings']>): void;
  creationItems: readonly CreationItemDto[];
  creationMode: 'existing' | 'new';
  currentSeriesId: string | null;
  getCreationDraftId(): string | null;
  locale: Locale;
  manualPrompt: string;
  notify(message: string): void;
  onOpenStash(stash: InspirationStashDto): void;
  palettes: readonly WordPaletteDto[];
  document?: CreationDraftPromptSnapshot['document'];
  promptNodes: CreationDraftPromptSnapshot['nodes'];
  referenceAssetIds: readonly string[];
  refresh(): Promise<void>;
  replacePromptDocument(document: PromptDocumentReplacement): void;
  restartNewCreation(albumId: string | null): Promise<boolean>;
  saveCreationDraft(prompt: CreationDraftPromptSnapshot): Promise<{ id: string }>;
  selectedStashId: string | null;
  selectedStash?: InspirationStashDto | null;
  selectedTerms: readonly TermListItem[];
  synchronizePrompt(prompt: CreationDraftPromptSnapshot): void;
  targetAlbumId: string | null;
  termPromptLocale: Locale;
  terms: readonly TermListItem[];
  title: string;
  onTitleChange(title: string): void;
  wordPaletteReferences: InspirationStashContentInput['wordPaletteReferences'];
}

function currentContent(options: Options, prompt: CreationDraftPromptSnapshot): InspirationStashContentInput {
  const title = options.creationMode === 'new' ? options.title : options.selectedStash?.content.title;
  return {
    schemaVersion: 1,
    settings: options.settings,
    ...(options.selectedStash?.content.files ? { files: options.selectedStash.content.files } : {}),
    ...(title || options.selectedStash?.content.title !== undefined ? { title } : {}),
    ...(options.selectedStash?.content.format ? { format: options.selectedStash.content.format } : {}),
    ...(prompt.document ? { schemaVersion: 2, document: prompt.document } : {}),
    manualPrompt: prompt.manualPrompt,
    promptNodes: prompt.nodes,
    referenceAssetIds: [
      ...new Set([...options.referenceAssetIds, ...(prompt.document ? blockDocumentAssetIds(prompt.document) : [])]),
    ],
    termPromptLocale: options.termPromptLocale,
    termIds: [
      ...new Set([
        ...prompt.selectedTerms.map((term) => term.id),
        ...(options.selectedStash?.content.termIds.filter((id) => !options.terms.some((term) => term.id === id)) ?? []),
      ]),
    ],
    wordPaletteReferences: [
      ...options.wordPaletteReferences,
      ...(options.selectedStash?.content.wordPaletteReferences.filter(
        (reference) =>
          !options.palettes.some(
            (palette) =>
              palette.id === reference.paletteId &&
              palette.revisions.some((revision) => revision.id === reference.paletteRevisionId),
          ),
      ) ?? []),
    ].map((reference) => ({
      ...reference,
      parameterValues: { ...reference.parameterValues },
    })),
  };
}

export function useCreatorInspirationSession(options: Options) {
  const renderedPrompt: CreationDraftPromptSnapshot = {
    manualPrompt: options.manualPrompt,
    nodes: options.promptNodes,
    document: options.document,
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
    options.onTitleChange(content.title ?? '');
    if (content.settings) options.restoreSettings(content.settings);
    const selectedTerms = content.termIds.flatMap((termId) => options.terms.find((term) => term.id === termId) ?? []);
    const appliedPalettes = content.wordPaletteReferences.flatMap((reference) => {
      const palette = options.palettes.find((item) => item.id === reference.paletteId);
      const revision = palette?.revisions.find((item) => item.id === reference.paletteRevisionId);
      return palette && revision
        ? [{ palette, revision, parameterValues: reference.parameterValues, promptLocale: reference.promptLocale }]
        : [];
    });
    options.replacePromptDocument({
      document: content.document,
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
    workflow.rememberSavedContent(content, stash.contentHash, stash.revisionId);
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
