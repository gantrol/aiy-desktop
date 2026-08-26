import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type {
  CodexImageRefinementInput,
  CodexTitleInput,
  GenerationBatchInput,
  GenerationInput,
  GenerationVersionInput,
  ImageGenerationConcurrencyDto,
  ImageCropInput,
  ImageEditBatchStartInput,
  ImageEditStartInput,
  ImageReframeStartInput,
  StyleExplorationStartInput,
  VideoDocumentArticleGenerateInput,
  VideoDocumentTranscriptTranslationWorkerInput,
} from '@/shared/contracts';
import { videoDocumentArticleGenerateInputSchema } from '@/shared/contracts/video-document';
import { videoDocumentTranscriptTranslationWorkerInputSchema } from '@/shared/contracts/video-document-translation';
import type { AssistantTitleExecution } from '@/main/assistant/assistant-service';
import type { CodexChatJob, CodexTitleExecutionOptions } from '@/main/assistant/codex-service';
import type { DeepSeekApiRuntimeConfiguration } from '@/main/extensions/deepseek-api/types';
import type { ExternalImageApiRuntimeConfiguration } from '@/main/extensions/external-image-api/types';
import type { OpenAiImageApiRuntimeConfiguration } from '@/main/extensions/openai-image-api/types';
import { EXTERNAL_IMAGE_API_EXTENSION_IDS } from '@/shared/extension-ids';
import {
  MAX_IMAGE_GENERATION_MAX_CONCURRENT,
  MIN_IMAGE_GENERATION_MAX_CONCURRENT,
} from '@/shared/image-generation-concurrency';
import type { ModelWorkerMethod } from '@/main/model-worker/protocol';

const identifier = z.string().min(1).max(200);
const boundedPath = z.string().min(1).max(32_768);
const locale = z.enum(['zh', 'en']);
const quality = z.enum(['low', 'medium', 'high']);
const reasoningEffort = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const stringList = z.array(z.string().max(500)).max(100);
const scope = z.object({ kind: z.enum(['DRAFT', 'SERIES']), id: identifier }).strict();

const wordPaletteReference = z
  .object({
    paletteId: identifier,
    paletteRevisionId: identifier,
    parameterValues: z.record(z.string().max(64), z.string().max(120)),
    promptLocale: locale,
  })
  .strict();

const creatorPromptNode = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('TEXT'), text: z.string().max(30_000) }).strict(),
  z.object({ kind: z.literal('TERM'), termId: identifier, promptLocale: locale.optional() }).strict(),
  z.object({ kind: z.literal('RECIPE'), paletteId: identifier }).strict(),
]);

const generationBase = z
  .object({
    seriesId: identifier.nullable(),
    creationDraftId: identifier.nullable().optional().default(null),
    inspirationStashId: identifier.nullable().optional().default(null),
    baseVersionId: identifier.nullable().optional().default(null),
    sourceImportId: identifier.nullable().optional().default(null),
    sourceAssetId: identifier.nullable().optional(),
    title: z.string().max(300),
    titleLocale: locale,
    manualPrompt: z.string().max(30_000),
    prompt: z.string().min(1).max(30_000),
    changeSummary: z.string().max(1_000),
    promptNodes: z.array(creatorPromptNode).max(2_000).optional(),
    referenceAssetIds: stringList,
    termPromptLocale: locale.optional().default('en'),
    termIds: stringList,
    wordPaletteReferences: z.array(wordPaletteReference).max(50).optional().default([]),
    modelKey: identifier,
    canvasPresetKey: z.string().min(1).max(100).nullable(),
    width: z.number().int().min(256).max(4_096).nullable(),
    height: z.number().int().min(256).max(4_096).nullable(),
    quality,
  })
  .strict();

function validateCanvas(
  value: { canvasPresetKey: string | null; width: number | null; height: number | null },
  context: z.RefinementCtx,
) {
  if ((value.width === null) !== (value.height === null)) {
    context.addIssue({ code: 'custom', message: 'Canvas width and height must both be set or both be omitted' });
  }
  if (value.canvasPresetKey !== null && value.width === null) {
    context.addIssue({ code: 'custom', message: 'A canvas preset requires width and height' });
  }
}

const generationInput = generationBase.superRefine(validateCanvas);
const generationTarget = z
  .object({
    modelKey: identifier,
    count: z.number().int().min(1).max(100),
    quality,
  })
  .strict();
const generationTargets = z.array(generationTarget).min(1).max(20);
const generationBatchInput = z
  .object({
    input: generationBase.omit({ modelKey: true }).superRefine(validateCanvas),
    targets: generationTargets,
  })
  .strict();

const uniqueAnnotationIds = <T extends { annotationIds: string[] }>(value: T, context: z.RefinementCtx) => {
  if (new Set(value.annotationIds).size !== value.annotationIds.length) {
    context.addIssue({ code: 'custom', message: 'Image edit comments must be unique', path: ['annotationIds'] });
  }
};

const imageEditInput = z
  .object({
    seriesId: identifier,
    sourceAssetId: identifier,
    annotationIds: z.array(identifier).min(1).max(100),
    modelKey: identifier,
    mode: z.enum(['AUTO', 'SEMANTIC', 'MASK']),
    locale,
    quality,
  })
  .strict()
  .superRefine(uniqueAnnotationIds);

const imageEditBatchInput = z
  .object({
    seriesId: identifier,
    sourceAssetId: identifier,
    annotationIds: z.array(identifier).min(1).max(100),
    targets: generationTargets,
    mode: z.enum(['AUTO', 'SEMANTIC', 'MASK']),
    locale,
  })
  .strict()
  .superRefine((value, context) => {
    uniqueAnnotationIds(value, context);
    if (new Set(value.targets.map((target) => target.modelKey)).size !== value.targets.length) {
      context.addIssue({ code: 'custom', message: 'Image edit targets must be unique', path: ['targets'] });
    }
  });

const imageCropInput = z
  .object({
    seriesId: identifier,
    sourceAssetId: identifier,
    ratioWidth: z.number().int().min(1).max(100),
    ratioHeight: z.number().int().min(1).max(100),
  })
  .strict();

const imageReframeInput = imageCropInput.extend({ modelKey: identifier, locale, quality }).strict();

const codexImageRefinementInput = z
  .object({
    seriesId: identifier,
    sourceAssetId: identifier,
    annotationIds: z.array(identifier).min(1).max(100),
    locale,
    quality,
  })
  .strict()
  .superRefine(uniqueAnnotationIds);

const styleExplorationSlot = z
  .object({
    label: z.string().min(1).max(300),
    rationale: z.string().max(2_000),
    variableAxis: z.string().max(1_000),
    risk: z.string().max(1_000),
    userInstruction: z.string().max(30_000),
    input: generationBase
      .omit({ seriesId: true, creationDraftId: true, inspirationStashId: true, modelKey: true })
      .superRefine(validateCanvas),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.userInstruction.trim() !== value.input.manualPrompt.trim()) {
      context.addIssue({ code: 'custom', message: 'Direction instruction does not match its generation input' });
    }
  });

const directionExperimentDelegation = z
  .object({
    objective: z.string().min(1).max(2_000),
    deadlineAt: z
      .string()
      .max(64)
      .refine((value) => Number.isFinite(Date.parse(value)), 'Invalid deadline')
      .nullable(),
    remoteScope: z.array(z.string().min(1).max(1_000)).min(1).max(16),
    decisions: z
      .array(
        z
          .object({
            label: z.string().min(1).max(500),
            interpretation: z.string().min(1).max(2_000),
            impact: z.string().max(2_000),
          })
          .strict(),
      )
      .max(4),
  })
  .strict();

const styleExplorationInput = z
  .object({
    scope,
    sourceAssistantRunId: identifier,
    commonConstraints: z.array(z.string().max(1_000)).max(8),
    slots: z.array(styleExplorationSlot).min(1).max(4),
    targets: generationTargets,
    delegation: directionExperimentDelegation.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const runCount = value.slots.length * value.targets.reduce((total, target) => total + target.count, 0);
    if (runCount > 16) {
      context.addIssue({ code: 'custom', message: 'A direction experiment supports at most 16 generations' });
    }
  });

const assistTerm = z
  .object({
    stableId: identifier,
    revisionId: identifier,
    expressionRevisionId: identifier.nullable(),
    displayName: z.string().max(300),
    promptFragment: z.string().max(3_000),
    negativeFragment: z.string().max(3_000),
  })
  .strict();
const assistAsset = z
  .object({
    assetId: identifier,
    kind: z.enum(['GENERATED', 'REFERENCE']),
    originType: z.string().max(120).optional(),
    width: z.number().int().nonnegative().max(65_535),
    height: z.number().int().nonnegative().max(65_535),
    mimeType: z.string().max(200),
  })
  .strict();
const assistRecipe = z
  .object({
    useId: identifier,
    stableId: identifier,
    revisionId: identifier,
    displayName: z.string().max(300),
    promptLocale: locale,
    parameterValues: z.record(z.string().max(64), z.string().max(300)),
    parameters: z
      .array(
        z
          .object({
            stableId: identifier,
            revisionId: identifier,
            displayName: z.string().max(300),
            selectedValue: z.string().max(300),
            selectedOptionId: identifier.nullable(),
            selectedOptionLabel: z.string().max(300),
            promptFragment: z.string().max(3_000),
          })
          .strict(),
      )
      .max(12),
    referenceAssets: z.array(assistAsset).max(16),
    promptFragment: z.string().max(30_000),
    negativeFragment: z.string().max(30_000),
    internalTerms: z.array(assistTerm).max(1_000),
  })
  .strict();
const assistPromptNode = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('TEXT'), text: z.string().max(30_000) }).strict(),
  z.object({ kind: z.literal('TERM'), termId: identifier, termRevisionId: identifier }).strict(),
  z.object({ kind: z.literal('RECIPE'), paletteId: identifier, paletteRevisionId: identifier }).strict(),
]);
const assistInput = z
  .object({
    mode: z.enum(['optimize', 'directions', 'chat']),
    webSearchMode: z.enum(['DISABLED', 'REQUIRED']).optional().default('DISABLED'),
    prompt: z.string().max(30_000),
    message: z.string().max(8_000).optional(),
    directionStrategy: z.enum(['DIVERGENT', 'ADJACENT']).optional().default('DIVERGENT'),
    previousDirectionCoverage: z
      .array(z.object({ label: z.string().min(1).max(160), variableAxis: z.string().min(1).max(240) }).strict())
      .max(16)
      .optional()
      .default([]),
    locale,
    directTerms: z.array(assistTerm).max(80),
    recipes: z.array(assistRecipe).max(80),
    contentNodes: z.array(assistPromptNode).max(100).optional().default([]),
    candidateTerms: z.array(assistTerm).max(40).optional().default([]),
    referenceAssets: z.array(assistAsset).max(16).optional().default([]),
    canvasPresetKey: z.string().max(200).nullable().optional().default(null),
    canvasWidth: z.number().int().min(256).max(4_096).nullable().optional().default(null),
    canvasHeight: z.number().int().min(256).max(4_096).nullable().optional().default(null),
    generationTargets: z.array(generationTarget).max(20).optional().default([]),
  })
  .strict();

const titleInput = z
  .object({ prompt: z.string().min(1).max(30_000), title: z.string().max(300), mode: z.enum(['fill', 'regenerate']) })
  .strict();

const promptEdit = z
  .object({
    summary: z.string().max(8_000),
    preserved: z.array(z.string().max(8_000)).max(100),
    changes: z
      .array(
        z
          .object({ before: z.string().max(30_000), after: z.string().max(30_000), reason: z.string().max(8_000) })
          .strict(),
      )
      .max(100),
    removed: z.array(z.string().max(8_000)).max(100),
    revisedUserInstruction: z.string().max(30_000),
  })
  .strict();
const promptDraftNode = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('TEXT'), text: z.string().max(30_000) }).strict(),
  z
    .object({
      kind: z.literal('TERM'),
      termId: identifier,
      termRevisionId: identifier,
      displayName: z.string().max(300),
    })
    .strict(),
  z
    .object({
      kind: z.literal('RECIPE'),
      paletteId: identifier,
      paletteRevisionId: identifier,
      displayName: z.string().max(300),
      parameterValues: z.record(z.string().max(64), z.string().max(300)),
      promptLocale: locale,
    })
    .strict(),
]);
const promptDraft = z
  .object({
    summary: z.string().max(8_000),
    warnings: z.array(z.string().max(8_000)).max(100),
    contentNodes: z.array(promptDraftNode).min(1).max(100),
  })
  .strict();
const assistResult = z
  .object({
    assistantMessage: z.string().max(100_000),
    optimizedPrompt: z.string().max(30_000).optional(),
    promptEdit: promptEdit.optional(),
    promptDraft: promptDraft.optional(),
    sharedConstraints: z.array(z.string().max(8_000)).max(100),
    assumptions: z
      .array(
        z
          .object({
            label: z.string().max(8_000),
            interpretation: z.string().max(8_000),
            impact: z.string().max(8_000),
          })
          .strict(),
      )
      .max(100),
    directions: z
      .array(
        z
          .object({
            label: z.string().max(8_000),
            prompt: z.string().max(30_000),
            rationale: z.string().max(8_000),
            variableAxis: z.string().max(8_000),
            risk: z.string().max(8_000),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
const historyAsset = z
  .object({
    id: identifier,
    kind: z.enum(['GENERATED', 'REFERENCE']),
    originType: z.string().max(120).optional(),
    width: z.number().int().nonnegative().max(65_535),
    height: z.number().int().nonnegative().max(65_535),
    mimeType: z.string().max(200),
    byteSize: z.number().int().nonnegative().optional(),
    mediaUrl: z.string().max(32_768),
    createdAt: z.string().max(100),
  })
  .strict();
const historyTurn = z
  .object({
    id: identifier,
    scope,
    mode: z.enum(['optimize', 'directions', 'chat']),
    prompt: z.string().max(30_000),
    message: z.string().max(8_000),
    attachments: z.array(historyAsset).max(8),
    result: assistResult,
    createdAt: z.string().max(100),
  })
  .strict();
const chatRequest = assistInput
  .extend({
    scope,
    mode: z.literal('chat'),
    message: z.string().max(8_000).default(''),
    attachmentAssetIds: z.array(identifier).max(8).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.message.trim() && value.attachmentAssetIds.length === 0) {
      context.addIssue({ code: 'custom', message: 'A conversation turn requires a message or image attachment' });
    }
  });
const codexChatJob = z
  .object({
    processId: identifier.optional(),
    scope,
    request: chatRequest,
    input: assistInput,
    history: z.array(historyTurn).max(20),
    imagePaths: z.array(boundedPath).max(8),
  })
  .strict()
  .superRefine((job, context) => {
    if (!isDeepStrictEqual(job.scope, job.request.scope)) {
      context.addIssue({
        code: 'custom',
        path: ['request', 'scope'],
        message: 'Chat request scope does not match the worker job scope',
      });
    }

    const { scope: _scope, attachmentAssetIds: _attachmentAssetIds, ...requestInput } = job.request;
    if (!isDeepStrictEqual(job.input, requestInput)) {
      context.addIssue({
        code: 'custom',
        path: ['input'],
        message: 'Chat execution input does not match the persisted request',
      });
    }

    const historyIds = new Set<string>();
    for (const [index, turn] of job.history.entries()) {
      if (!isDeepStrictEqual(turn.scope, job.scope)) {
        context.addIssue({
          code: 'custom',
          path: ['history', index, 'scope'],
          message: 'Chat history scope does not match the worker job scope',
        });
      }
      if (turn.mode !== 'chat') {
        context.addIssue({
          code: 'custom',
          path: ['history', index, 'mode'],
          message: 'Chat history contains a non-chat turn',
        });
      }
      if (historyIds.has(turn.id)) {
        context.addIssue({
          code: 'custom',
          path: ['history', index, 'id'],
          message: 'Chat history contains a duplicate turn',
        });
      }
      historyIds.add(turn.id);
    }

    if (job.imagePaths.length !== job.request.attachmentAssetIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['imagePaths'],
        message: 'Chat image paths do not match the persisted attachment list',
      });
    }
  });

const assistantTitleExecution = z
  .object({ providerKey: identifier, modelKey: identifier, reasoningEffort: reasoningEffort.nullable() })
  .strict();
const codexTitleOptions = z.object({ model: identifier.optional(), effort: reasoningEffort.optional() }).strict();
const openAiConfiguration = z
  .object({
    apiKey: z.string().min(1).max(500),
    organizationId: z.string().max(500).nullable(),
    projectId: z.string().max(500).nullable(),
    moderation: z.enum(['auto', 'low']).optional(),
    usable: z.boolean(),
    verified: z.boolean(),
    connectionMessage: z.string().max(10_000),
  })
  .strict();
const deepSeekConfiguration = z
  .object({
    apiKey: z.string().min(1).max(500),
    modelId: identifier,
    responsesUrl: z.string().url().max(2_048),
    configurationRevision: identifier,
    verified: z.boolean(),
    connectionMessage: z.string().max(10_000),
  })
  .strict();
const externalImageConfiguration = z
  .object({
    extensionId: z.enum(EXTERNAL_IMAGE_API_EXTENSION_IDS),
    apiKey: z.string().min(1).max(500),
    settings: z.record(z.string().max(100), z.string().max(2_048)),
    usable: z.boolean(),
    verified: z.boolean(),
    connectionMessage: z.string().max(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (Object.keys(value.settings).length > 100) {
      context.addIssue({ code: 'custom', message: 'Provider settings contain too many entries', path: ['settings'] });
    }
  });
const generationMaxConcurrent = z
  .number()
  .int()
  .min(MIN_IMAGE_GENERATION_MAX_CONCURRENT)
  .max(MAX_IMAGE_GENERATION_MAX_CONCURRENT);
const generationConcurrencyConfiguration: z.ZodType<ImageGenerationConcurrencyDto> = z
  .object({
    defaultMaxConcurrent: generationMaxConcurrent,
    limitsByModelKey: z.record(z.string().min(1).max(512), generationMaxConcurrent),
    updatedAt: z.string().datetime().nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Object.keys(value.limitsByModelKey).length > 10_000) {
      context.addIssue({ code: 'custom', message: 'Too many image-generation concurrency overrides' });
    }
  });

export interface ModelWorkerMethodParams {
  snapshot: [];
  'library-file-view.refresh': [];
  'dictionary.stage-import': [fileName: string, filePath: string];
  'dictionary.commit-import': [batchId: string];
  'image-transform.crop': [input: ImageCropInput];
  'generation.start': [input: GenerationInput];
  'generation.start-batch': [input: GenerationBatchInput];
  'generation.start-image-edit': [input: ImageEditStartInput];
  'generation.start-image-edit-batch': [input: ImageEditBatchStartInput];
  'generation.start-image-reframe': [input: ImageReframeStartInput];
  'generation.start-codex-image-refinement': [input: CodexImageRefinementInput];
  'generation.start-style-exploration': [input: StyleExplorationStartInput];
  'generation.cancel-style-exploration': [batchId: string];
  'generation.retry-style-exploration-slot': [slotId: string];
  'generation.start-version': [input: GenerationVersionInput];
  'generation.retry': [runId: string];
  'generation.cancel': [runId: string];
  'generation.configure-concurrency': [configuration: ImageGenerationConcurrencyDto];
  'codex.refresh-health': [];
  'codex.list-models': [];
  'antigravity.refresh-status': [];
  'video-document.article-generate': [input: VideoDocumentArticleGenerateInput];
  'video-document.transcript-translate': [input: VideoDocumentTranscriptTranslationWorkerInput];
  'assistant.run': [runId: string];
  'assistant.suggest-titles': [input: CodexTitleInput, execution: AssistantTitleExecution];
  'codex.chat': [job: CodexChatJob];
  'codex.suggest-titles': [input: CodexTitleInput, options?: CodexTitleExecutionOptions | null];
  'codex.cancel-all': [];
  'extensions.refresh': [];
  'extensions.configure-openai-image-api': [configuration: OpenAiImageApiRuntimeConfiguration | null];
  'extensions.configure-deepseek-api': [configuration: DeepSeekApiRuntimeConfiguration | null];
  'extensions.configure-external-image-apis': [configurations: ExternalImageApiRuntimeConfiguration[]];
  'worker.shutdown': [];
  'worker.shutdown-when-idle': [];
  'worker.force-shutdown': [];
}

type ParamSchemaMap = { [Method in ModelWorkerMethod]: z.ZodType<ModelWorkerMethodParams[Method]> };

const empty = z.tuple([]);
const schemas = {
  snapshot: empty,
  'library-file-view.refresh': empty,
  'dictionary.stage-import': z.tuple([z.string().min(1).max(500), boundedPath]),
  'dictionary.commit-import': z.tuple([identifier]),
  'image-transform.crop': z.tuple([imageCropInput]),
  'generation.start': z.tuple([generationInput]),
  'generation.start-batch': z.tuple([generationBatchInput]),
  'generation.start-image-edit': z.tuple([imageEditInput]),
  'generation.start-image-edit-batch': z.tuple([imageEditBatchInput]),
  'generation.start-image-reframe': z.tuple([imageReframeInput]),
  'generation.start-codex-image-refinement': z.tuple([codexImageRefinementInput]),
  'generation.start-style-exploration': z.tuple([styleExplorationInput]),
  'generation.cancel-style-exploration': z.tuple([identifier]),
  'generation.retry-style-exploration-slot': z.tuple([identifier]),
  'generation.start-version': z.tuple([
    z
      .object({
        versionId: identifier,
        modelKey: identifier,
        canvasPresetKey: z.string().min(1).max(100).nullable(),
        width: z.number().int().min(256).max(4_096).nullable(),
        height: z.number().int().min(256).max(4_096).nullable(),
        quality,
      })
      .strict()
      .superRefine(validateCanvas),
  ]),
  'generation.retry': z.tuple([identifier]),
  'generation.cancel': z.tuple([identifier]),
  'generation.configure-concurrency': z.tuple([generationConcurrencyConfiguration]),
  'codex.refresh-health': empty,
  'codex.list-models': empty,
  'antigravity.refresh-status': empty,
  'video-document.article-generate': z.tuple([videoDocumentArticleGenerateInputSchema]),
  'video-document.transcript-translate': z.tuple([videoDocumentTranscriptTranslationWorkerInputSchema]),
  'assistant.run': z.tuple([identifier]),
  'assistant.suggest-titles': z.tuple([titleInput, assistantTitleExecution]),
  'codex.chat': z.tuple([codexChatJob]),
  'codex.suggest-titles': z.tuple([titleInput, codexTitleOptions.nullish()]),
  'codex.cancel-all': empty,
  'extensions.refresh': empty,
  'extensions.configure-openai-image-api': z.tuple([openAiConfiguration.nullable()]),
  'extensions.configure-deepseek-api': z.tuple([deepSeekConfiguration.nullable()]),
  'extensions.configure-external-image-apis': z.tuple([z.array(externalImageConfiguration).max(20)]),
  'worker.shutdown': empty,
  'worker.shutdown-when-idle': empty,
  'worker.force-shutdown': empty,
} satisfies ParamSchemaMap;

export function parseModelWorkerMethodParams<Method extends ModelWorkerMethod>(
  method: Method,
  params: unknown,
): ModelWorkerMethodParams[Method] {
  try {
    return schemas[method].parse(params) as ModelWorkerMethodParams[Method];
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    const diagnostics = error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join('.') || 'params'}: ${issue.message}`)
      .join('; ');
    throw Object.assign(new Error(`Invalid background model service parameters for ${method}: ${diagnostics}`), {
      code: 'MODEL_WORKER_INVALID_PARAMS' as const,
    });
  }
}
