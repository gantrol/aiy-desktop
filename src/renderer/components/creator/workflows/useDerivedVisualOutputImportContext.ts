import { resolveCreatorPrompt } from '@/renderer/components/creator/utils';
import type { useCreationDraftSession } from '@/renderer/components/creator/workflows/useCreationDraftSession';
import type { useCreatorPromptDocument } from '@/renderer/components/creator/workflows/useCreatorPromptDocument';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import type { BootstrapDto, CreatorImageImportContext, Locale } from '@/shared/contracts';
import { blockDocumentAssetIds } from '@/shared/contracts/block-document';

type CreationDraftSession = Pick<ReturnType<typeof useCreationDraftSession>, 'getDraftId' | 'saveDraftNow'>;
type PromptDocument = Pick<
  ReturnType<typeof useCreatorPromptDocument>,
  'capture' | 'referenceAssets' | 'termPromptLocale'
>;

interface CommittedDraftTarget {
  creationDraftId: string;
  keepEditorOpen: boolean;
  seriesId: string;
  versionId: string;
}

interface PreparedOutputImportContext {
  context: CreatorImageImportContext;
  defaultPromptVersionId: string | null;
  committedDraft: CommittedDraftTarget | null;
}

interface Options {
  creationDraftSession: CreationDraftSession;
  creationMode: 'existing' | 'new';
  data: BootstrapDto;
  locale: Locale;
  newTitle: string;
  promptDocument: PromptDocument;
  promptProfileId: string | null;
}

export function creatorOutputImportTarget(
  data: BootstrapDto,
  creationMode: Options['creationMode'],
  draftId: string | null,
  seriesId: string | null,
  versionId: string | null,
) {
  if (creationMode === 'existing') return { seriesId, versionId };
  const visual = draftId
    ? (data.derivedVisuals ?? []).find((candidate) => candidate.creationDraftId === draftId)
    : undefined;
  const linkedSeries = visual?.promptSeriesId
    ? data.series.find((candidate) => candidate.id === visual.promptSeriesId)
    : undefined;
  return {
    seriesId: visual?.promptSeriesId ?? null,
    versionId: linkedSeries?.currentVersionId ?? null,
  };
}

export function useDerivedVisualOutputImportContext(options: Options) {
  const labels = useI18n().messages.creator.derivedVisual;
  return useStableCallback(
    async (context: CreatorImageImportContext, requirePromptVersion = false): Promise<PreparedOutputImportContext> => {
      if (context.seriesId || options.creationMode !== 'new') {
        return { context, defaultPromptVersionId: context.versionId, committedDraft: null };
      }
      const draftId = options.creationDraftSession.getDraftId();
      const visual = draftId
        ? (options.data.derivedVisuals ?? []).find((candidate) => candidate.creationDraftId === draftId)
        : undefined;
      if (!visual && !requirePromptVersion) {
        return { context, defaultPromptVersionId: context.versionId, committedDraft: null };
      }
      if (visual?.promptSeriesId) {
        const linkedSeries = options.data.series.find((candidate) => candidate.id === visual.promptSeriesId);
        const versionId = linkedSeries?.currentVersionId ?? null;
        return {
          context: { ...context, seriesId: visual.promptSeriesId, versionId },
          defaultPromptVersionId: versionId,
          committedDraft: null,
        };
      }

      const captured = options.promptDocument.capture();
      const termPromptLocale = options.promptDocument.termPromptLocale;
      const promptResolution = resolveCreatorPrompt({
        manualPrompt: captured.manualPrompt,
        promptNodes: captured.nodes,
        selectedTerms: captured.selectedTerms,
        appliedPalettes: captured.appliedPalettes,
        termPromptLocale,
        promptProfileId: options.promptProfileId ?? undefined,
      });
      const finalPrompt = promptResolution.livePrompt.trim();
      if (!finalPrompt) throw new Error(labels.promptRequired);
      const referenceAssetIds = [
        ...new Set([
          ...options.promptDocument.referenceAssets.map((asset) => asset.id),
          ...(captured.document ? blockDocumentAssetIds(captured.document) : []),
        ]),
      ];
      const draft = await options.creationDraftSession.saveDraftNow(undefined, captured);
      if ((visual && draft.id !== visual.creationDraftId) || options.creationDraftSession.getDraftId() !== draftId) {
        throw new Error(labels.importContextChanged);
      }
      const committed = await window.desktopApi.creationDraftCommit({
        creationDraftId: draft.id,
        title: options.newTitle.trim() || '新创作',
        manualPrompt: captured.manualPrompt,
        promptNodes: captured.nodes,
        document: captured.document,
        prompt: finalPrompt,
        resolvedPrompt: promptResolution.composition,
        changeSummary: 'MANUAL_PROMPT',
        referenceAssetIds,
        termPromptLocale,
        termIds: captured.selectedTerms.map((term) => term.id),
        wordPaletteReferences: captured.appliedPalettes.map((reference) => ({
          paletteId: reference.palette.id,
          paletteRevisionId: reference.revision.id,
          parameterValues: { ...reference.parameterValues },
          promptLocale: reference.promptLocale,
        })),
      });
      return {
        context: { ...context, seriesId: committed.seriesId, versionId: committed.versionId },
        defaultPromptVersionId: committed.versionId,
        committedDraft: {
          creationDraftId: draft.id,
          keepEditorOpen: Boolean(visual),
          seriesId: committed.seriesId,
          versionId: committed.versionId,
        },
      };
    },
  );
}
