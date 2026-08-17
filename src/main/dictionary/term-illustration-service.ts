import type {
  TermIllustrationAdoptInput,
  TermIllustrationDismissInput,
  TermIllustrationListDto,
  TermIllustrationListInput,
  TermIllustrationStartInput,
  TermIllustrationStartResult,
} from '@/shared/contracts';
import { imageGenerationPromptProfileId } from '@/shared/image-generation-prompt-profile';
import { resolveTermContent, resolveTermExpression } from '@/shared/term-localization';
import type { LibraryDatabase } from '@/main/database';
import type { GenerationService } from '@/main/generation/service';

const TERM_ILLUSTRATION_PROFILE_ID = 'dictionary.single-image';
const TERM_ILLUSTRATION_PROFILE_REVISION = 1;
const profileInstruction =
  'Create one polished reference illustration for this dictionary concept. Make the concept immediately recognizable and visually specific.';
const profileConstraints =
  'Use one coherent image, not a collage. No captions, labels, arrows, logos, interface chrome, borders, or watermarks.';

export class TermIllustrationService {
  constructor(
    private readonly database: LibraryDatabase,
    private readonly generation: Pick<GenerationService, 'imageGenerationRoutes' | 'startBatch' | 'cancel'>,
  ) {}

  list(input: TermIllustrationListInput): TermIllustrationListDto {
    return this.database.listTermIllustrations(input);
  }

  async start(input: TermIllustrationStartInput): Promise<TermIllustrationStartResult> {
    const term = this.database.getTerm(input.termId, input.locale);
    if (term.editorialState !== 'APPROVED' || term.hasDraft) {
      throw new Error('Approve the current term and clear its pending draft before generating an illustration');
    }
    if (term.termRevisionId !== input.expectedTermRevisionId) {
      throw new Error('The term changed before generation started; reopen it and try again');
    }

    const route = this.generation.imageGenerationRoutes.find((candidate) => candidate.key === input.routeKey);
    if (!route || route.state !== 'READY' || !route.capabilities.includes('GENERATE')) {
      throw new Error('The selected image generation route is unavailable');
    }
    if (route.qualityMode === 'SELECTABLE' && !route.supportedQualities.includes(input.quality)) {
      throw new Error('The selected quality is unavailable for this image generation route');
    }

    const promptProfileId = imageGenerationPromptProfileId(route);
    const expression = resolveTermExpression(term, promptProfileId, input.locale);
    if (!expression || (!expression.positive.trim() && !expression.negative.trim())) {
      throw new Error('This term has no compatible model expression for the selected route');
    }

    const content = resolveTermContent(term, input.locale);
    const definition = content.definition.trim().slice(0, 10_000);
    const finalConstraint = definition ? `${profileConstraints} Definition: ${definition}` : profileConstraints;
    const batchId = this.database.createTermIllustrationBatch({
      termId: term.id,
      termRevisionId: term.termRevisionId,
      purpose: input.purpose,
      profileId: TERM_ILLUSTRATION_PROFILE_ID,
      profileRevision: TERM_ILLUSTRATION_PROFILE_REVISION,
      promptProfileId,
      expressionRevisionId: expression.id,
      modelKey: route.key,
      quality: input.quality,
    });

    try {
      const result = await this.generation.startBatch({
        input: {
          seriesId: null,
          creationDraftId: null,
          baseVersionId: null,
          sourceAssetId: null,
          title: content.title.slice(0, 300),
          titleLocale: input.locale,
          manualPrompt: profileInstruction,
          promptNodes: [
            { kind: 'TEXT', text: profileInstruction },
            { kind: 'TERM', termId: term.id, promptLocale: input.locale },
            { kind: 'TEXT', text: finalConstraint },
          ],
          prompt: profileInstruction,
          changeSummary: content.title.slice(0, 1_000),
          referenceAssetIds: [],
          termPromptLocale: input.locale,
          termIds: [term.id],
          wordPaletteReferences: [],
          canvasPresetKey: null,
          width: null,
          height: null,
          quality: input.quality,
        },
        targets: [{ modelKey: route.key, count: input.count, quality: input.quality }],
      });

      const frozenInput = this.database.getPromptCommonInput(result.versionId);
      const frozenTerm = frozenInput.directTerms.find((candidate) => candidate.termId === term.id);
      if (frozenTerm?.termRevisionId !== term.termRevisionId) {
        await Promise.all(result.runIds.map((runId) => Promise.resolve(this.generation.cancel(runId))));
        throw new Error('The term changed while the generation input was being frozen');
      }

      this.database.attachTermIllustrationGeneration(batchId, {
        seriesId: result.seriesId,
        versionId: result.versionId,
        runIds: result.runIds,
      });
      return {
        batchId,
        seriesId: result.seriesId,
        versionId: result.versionId,
        runIds: result.runIds,
      };
    } catch (reason) {
      this.database.failTermIllustrationBatch(batchId, reason);
      throw reason;
    }
  }

  adopt(input: TermIllustrationAdoptInput) {
    return this.database.adoptTermIllustration(input);
  }

  dismiss(input: TermIllustrationDismissInput) {
    return this.database.dismissTermIllustration(input.batchRunId);
  }
}
