import { z } from 'zod';
import { termDraftSchema } from '@/main/database/dictionary/term-draft-schema';
import { importedImageMetadataSchema, importedImageRelationshipSchema } from '@/main/ipc/import-metadata-schema';
import { creationDraftLoadInputSchema } from '@/shared/contracts/creation-draft';
import { creatorImageImportMimeTypeSchema } from '@/shared/contracts/creator-import';

export const localeSchema = z.enum(['zh', 'en']);

export const id = z.string().min(1).max(200);

export const wordPaletteReferenceSchema = z.object({
  paletteId: id,
  paletteRevisionId: id,
  parameterValues: z.record(z.string().max(64), z.string().max(120)),
  promptLocale: localeSchema,
});

export const creatorPromptNodeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('TEXT'), text: z.string().max(30_000) }).strict(),
  z.object({ kind: z.literal('TERM'), termId: id, promptLocale: localeSchema.optional() }).strict(),
  z.object({ kind: z.literal('RECIPE'), paletteId: id }).strict(),
]);

export const albumDictionarySourceSchema = z.object({ packId: id, packReleaseId: id });

export const creationDictionaryScopeSchema = z.object({
  mode: z.enum(['ALL', 'SELECTED']),
  sources: z.array(albumDictionarySourceSchema).max(50),
  includeLocalTerms: z.boolean(),
});

export const albumCreationDefaultsSchema = z.object({
  schemaVersion: z.literal(1),
  recipes: z.array(wordPaletteReferenceSchema).max(50),
  dictionaryScope: creationDictionaryScopeSchema,
});

export const assetFileRevealContextSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ALL_MATERIALS') }).strict(),
  z.object({ kind: z.literal('DICTIONARY') }).strict(),
  z.object({ kind: z.literal('ALBUM'), albumId: id }).strict(),
  z.object({ kind: z.literal('CREATION'), seriesId: id }).strict(),
  z.object({ kind: z.literal('TERM'), termId: id }).strict(),
]);

export const assetFileRevealTargetContextSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ALL_MATERIALS') }).strict(),
  z.object({ kind: z.literal('DICTIONARY') }).strict(),
]);

export const stringList = z.array(z.string().max(500)).max(100);

export const dictionarySaveDraftSchema = z.object({
  draft: termDraftSchema,
  locale: localeSchema,
});

export const assistTermSchema = z.object({
  stableId: id,
  revisionId: id,
  expressionRevisionId: id.nullable(),
  displayName: z.string().max(300),
  promptFragment: z.string().max(3000),
  negativeFragment: z.string().max(3000),
});

export const assistAssetSchema = z.object({
  assetId: id,
  kind: z.enum(['GENERATED', 'REFERENCE']),
  originType: z.string().max(120).optional(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  mimeType: z.string().max(200),
});

export const assistRecipeSchema = z.object({
  useId: id,
  stableId: id,
  revisionId: id,
  displayName: z.string().max(300),
  promptLocale: localeSchema,
  parameterValues: z.record(z.string().max(64), z.string().max(300)),
  parameters: z
    .array(
      z.object({
        stableId: id,
        revisionId: id,
        displayName: z.string().max(300),
        selectedValue: z.string().max(300),
        selectedOptionId: id.nullable(),
        selectedOptionLabel: z.string().max(300),
        promptFragment: z.string().max(3000),
      }),
    )
    .max(12),
  referenceAssets: z.array(assistAssetSchema).max(16),
  promptFragment: z.string().max(30_000),
  negativeFragment: z.string().max(30_000),
  internalTerms: z.array(assistTermSchema).max(1000),
});

export const assistPromptNodeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('TEXT'), text: z.string().max(30_000) }),
  z.object({ kind: z.literal('TERM'), termId: id, termRevisionId: id }),
  z.object({ kind: z.literal('RECIPE'), paletteId: id, paletteRevisionId: id }),
]);

export const assistSchema = z.object({
  mode: z.enum(['optimize', 'directions', 'chat']),
  webSearchMode: z.enum(['DISABLED', 'REQUIRED']).optional().default('DISABLED'),
  prompt: z.string().max(30_000),
  message: z.string().max(8_000).optional(),
  directionStrategy: z.enum(['DIVERGENT', 'ADJACENT']).optional().default('DIVERGENT'),
  previousDirectionCoverage: z
    .array(
      z.object({
        label: z.string().min(1).max(160),
        variableAxis: z.string().min(1).max(240),
      }),
    )
    .max(16)
    .optional()
    .default([]),
  locale: localeSchema,
  directTerms: z.array(assistTermSchema).max(80),
  recipes: z.array(assistRecipeSchema).max(80),
  contentNodes: z.array(assistPromptNodeSchema).max(100).optional().default([]),
  candidateTerms: z.array(assistTermSchema).max(40).optional().default([]),
  referenceAssets: z.array(assistAssetSchema).max(16).optional().default([]),
  canvasPresetKey: z.string().max(200).nullable().optional().default(null),
  canvasWidth: z.number().int().min(256).max(4096).nullable().optional().default(null),
  canvasHeight: z.number().int().min(256).max(4096).nullable().optional().default(null),
  generationTargets: z
    .array(
      z.object({
        modelKey: id,
        count: z.number().int().min(1).max(100),
        quality: z.enum(['low', 'medium', 'high']),
      }),
    )
    .max(20)
    .optional()
    .default([]),
});

export const creatorAgentScopeSchema = z.object({ kind: z.enum(['DRAFT', 'SERIES']), id });

export const creatorAgentHistorySchema = z
  .object({
    scope: creatorAgentScopeSchema,
    cursor: z.string().max(1024).nullable(),
    limit: z.number().int().min(1).max(100),
  })
  .strict();

export const creatorAgentAssistSchema = assistSchema
  .extend({
    mode: z.enum(['optimize', 'directions']),
    scope: creatorAgentScopeSchema,
    creationId: id.nullable().optional().default(null),
    parentProposalId: id.nullable().optional().default(null),
    sourceExperimentSlotId: id.nullable().optional().default(null),
    contextKey: z.string().min(1).max(200),
    termPromptLocale: localeSchema,
    canvasWidth: z.number().int().min(256).max(4096).nullable(),
    canvasHeight: z.number().int().min(256).max(4096).nullable(),
  })
  .superRefine((value, context) => {
    if (
      value.mode === 'optimize' &&
      !value.prompt.trim() &&
      value.directTerms.length === 0 &&
      value.recipes.length === 0
    ) {
      context.addIssue({ code: 'custom', message: 'Prompt organization requires at least one Prompt input' });
    }
    const directTerms = new Map(value.directTerms.map((term) => [term.stableId, term.revisionId]));
    const recipes = new Map(value.recipes.map((recipe) => [recipe.stableId, recipe.revisionId]));
    for (const node of value.contentNodes) {
      if (node.kind === 'TERM' && directTerms.get(node.termId) !== node.termRevisionId) {
        context.addIssue({ code: 'custom', message: 'Prompt document contains an unavailable term revision' });
      }
      if (node.kind === 'RECIPE' && recipes.get(node.paletteId) !== node.paletteRevisionId) {
        context.addIssue({ code: 'custom', message: 'Prompt document contains an unavailable recipe revision' });
      }
    }
    if ((value.canvasWidth === null) !== (value.canvasHeight === null)) {
      context.addIssue({ code: 'custom', message: 'Assistant canvas width and height must both be set or omitted' });
    }
    if (value.canvasPresetKey !== null && value.canvasWidth === null) {
      context.addIssue({ code: 'custom', message: 'An assistant canvas preset requires exact dimensions' });
    }
  });

export const creatorAgentChatSchema = assistSchema
  .extend({
    mode: z.literal('chat'),
    scope: creatorAgentScopeSchema,
    message: z.string().max(8_000).default(''),
    attachmentAssetIds: z.array(id).max(8).default([]),
  })
  .superRefine((value, context) => {
    if (!value.message.trim() && value.attachmentAssetIds.length === 0) {
      context.addIssue({ code: 'custom', message: 'A conversation turn requires a message or image attachment' });
    }
  });

export const assistantProposalAdoptionBaseSchema = z.object({
  runId: id,
  baseContextKey: z.string().min(1).max(200),
  resultContextKey: z.string().min(1).max(200),
  authorizedContextKey: z.string().min(1).max(200),
  beforePrompt: z.string().max(30_000),
  afterPrompt: z.string().min(1).max(30_000),
  beforeDocument: z.object({
    promptNodes: z
      .array(
        z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('TEXT'), text: z.string().max(30_000) }),
          z.object({ kind: z.literal('TERM'), termId: id, promptLocale: localeSchema.optional() }),
          z.object({ kind: z.literal('RECIPE'), paletteId: id }),
        ]),
      )
      .max(100),
    termIds: z.array(id).max(80),
    wordPaletteReferences: z
      .array(
        z.object({
          paletteId: id,
          paletteRevisionId: id,
          parameterValues: z.record(z.string().max(64), z.string().max(300)),
          promptLocale: localeSchema,
        }),
      )
      .max(80),
  }),
  afterDocument: z.object({
    promptNodes: z
      .array(
        z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('TEXT'), text: z.string().max(30_000) }),
          z.object({ kind: z.literal('TERM'), termId: id, promptLocale: localeSchema.optional() }),
          z.object({ kind: z.literal('RECIPE'), paletteId: id }),
        ]),
      )
      .max(100),
    termIds: z.array(id).max(80),
    wordPaletteReferences: z
      .array(
        z.object({
          paletteId: id,
          paletteRevisionId: id,
          parameterValues: z.record(z.string().max(64), z.string().max(300)),
          promptLocale: localeSchema,
        }),
      )
      .max(80),
  }),
});

export const titleSchema = z.object({
  prompt: z.string().min(1).max(30_000),
  title: z.string().max(300),
  mode: z.enum(['fill', 'regenerate']),
});

export const renameSeriesSchema = z
  .object({
    seriesId: id,
    title: z.string().max(300),
    locale: localeSchema,
    expectedTitle: z.string().max(300).optional(),
  })
  .refine((value) => Boolean(value.title.trim()), {
    message: 'A title is required',
  });

export const deleteSeriesSchema = z.object({
  seriesId: id,
  outputDisposition: z.enum(['KEEP', 'TRASH']),
});

export const generationBaseSchema = z.object({
  seriesId: id.nullable(),
  title: z.string().max(300),
  titleLocale: localeSchema,
  creationDraftId: id.nullable().optional().default(null),
  inspirationStashId: id.nullable().optional().default(null),
  imageBreakdownId: id.nullable().optional().default(null),
  baseVersionId: id.nullable().optional().default(null),
  sourceImportId: id.nullable().optional().default(null),
  manualPrompt: z.string().max(30_000),
  prompt: z.string().min(1).max(30_000),
  changeSummary: z.string().max(1000),
  promptNodes: z.array(creatorPromptNodeSchema).max(2_000).optional(),
  referenceAssetIds: stringList,
  termPromptLocale: localeSchema.optional().default('en'),
  termIds: stringList,
  wordPaletteReferences: z
    .array(
      z.object({
        paletteId: id,
        paletteRevisionId: id,
        parameterValues: z.record(z.string().max(64), z.string().max(120)),
        promptLocale: localeSchema,
      }),
    )
    .max(50)
    .optional()
    .default([]),
  modelKey: id,
  canvasPresetKey: z.string().min(1).max(100).nullable(),
  width: z.number().int().min(256).max(4096).nullable(),
  height: z.number().int().min(256).max(4096).nullable(),
  quality: z.enum(['low', 'medium', 'high']),
});

export const validateGenerationCanvas = (
  value: { canvasPresetKey: string | null; width: number | null; height: number | null },
  context: z.RefinementCtx,
) => {
  if ((value.width === null) !== (value.height === null)) {
    context.addIssue({ code: 'custom', message: 'Canvas width and height must both be set or both be omitted' });
  }
  if (value.canvasPresetKey !== null && value.width === null) {
    context.addIssue({ code: 'custom', message: 'A canvas preset requires width and height' });
  }
};

export const generationSchema = generationBaseSchema.superRefine(validateGenerationCanvas);

export const promptVersionCreateSchema = generationBaseSchema
  .pick({
    seriesId: true,
    baseVersionId: true,
    title: true,
    titleLocale: true,
    manualPrompt: true,
    prompt: true,
    changeSummary: true,
    promptNodes: true,
    referenceAssetIds: true,
    termPromptLocale: true,
    termIds: true,
    wordPaletteReferences: true,
  })
  .extend({ seriesId: id, baseVersionId: id.nullable(), prompt: z.string().max(30_000) })
  .strict();

export const generationOutputSetFailedSchema = z
  .object({
    runId: id,
    failed: z.boolean(),
  })
  .strict();

export const generationBatchSchema = z.object({
  input: generationBaseSchema.omit({ modelKey: true }).superRefine(validateGenerationCanvas),
  targets: z
    .array(
      z.object({
        modelKey: id,
        count: z.number().int().min(1).max(100),
        quality: z.enum(['low', 'medium', 'high']),
      }),
    )
    .min(1)
    .max(20),
});

export const styleExplorationSlotSchema = z
  .object({
    label: z.string().min(1).max(300),
    rationale: z.string().max(2_000),
    variableAxis: z.string().max(1_000),
    risk: z.string().max(1_000),
    userInstruction: z.string().max(30_000),
    input: generationBaseSchema
      .omit({ seriesId: true, creationDraftId: true, inspirationStashId: true, imageBreakdownId: true, modelKey: true })
      .superRefine(validateGenerationCanvas),
  })
  .superRefine((value, context) => {
    if (value.userInstruction.trim() !== value.input.manualPrompt.trim()) {
      context.addIssue({ code: 'custom', message: 'Direction instruction does not match its generation input' });
    }
  });

export const directionExperimentDelegationSchema = z
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

export const styleExplorationStartSchema = z
  .object({
    scope: creatorAgentScopeSchema,
    sourceAssistantRunId: id,
    commonConstraints: z.array(z.string().max(1_000)).max(8),
    slots: z.array(styleExplorationSlotSchema).min(1).max(4),
    targets: generationBatchSchema.shape.targets,
    delegation: directionExperimentDelegationSchema.optional(),
  })
  .superRefine((value, context) => {
    const maximumRuns = value.slots.length * value.targets.reduce((total, target) => total + target.count, 0);
    if (maximumRuns > 16) {
      context.addIssue({ code: 'custom', message: 'A direction experiment supports at most 16 generations' });
    }
  });

export const knowledgeDistillationCreateSchema = z
  .object({
    sourceAssetId: id,
    locale: localeSchema,
  })
  .strict();

export const knowledgeDistillationAcceptSchema = z
  .object({
    proposalId: id,
    locale: localeSchema,
    matchedTermIds: z.array(id).max(1000),
    candidateIds: z.array(id).max(100),
  })
  .strict();

export const historicalTermRecommendationCreateSchema = z
  .object({
    scope: creatorAgentScopeSchema.nullable(),
    prompt: z.string().max(30_000),
    selectedTermIds: z.array(id).max(1_000),
    candidateTermIds: z.array(id).max(5_000),
    locale: localeSchema,
    limit: z.number().int().min(1).max(12).optional(),
  })
  .strict();

export const historicalTermRecommendationListSchema = z
  .object({
    scope: creatorAgentScopeSchema.nullable(),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();

export const dictionaryMaintenanceListSchema = z
  .object({
    locale: localeSchema,
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();

export const dictionaryMaintenanceCreateSchema = z
  .object({
    locale: localeSchema,
  })
  .strict();

export const generationVersionSchema = z
  .object({
    versionId: id,
    modelKey: id,
    canvasPresetKey: z.string().min(1).max(100).nullable(),
    width: z.number().int().min(256).max(4096).nullable(),
    height: z.number().int().min(256).max(4096).nullable(),
    quality: z.enum(['low', 'medium', 'high']),
  })
  .strict()
  .superRefine(validateGenerationCanvas);

export const codexImageRefinementSchema = z
  .object({
    seriesId: id,
    sourceAssetId: id,
    annotationIds: z.array(id).min(1).max(100),
    locale: localeSchema,
    quality: z.enum(['low', 'medium', 'high']),
  })
  .strict()
  .refine((value) => new Set(value.annotationIds).size === value.annotationIds.length, {
    message: 'Image refinement comments must be unique',
    path: ['annotationIds'],
  });

export const imageEditStartSchema = z
  .object({
    seriesId: id,
    sourceAssetId: id,
    annotationIds: z.array(id).min(1).max(100),
    modelKey: id,
    mode: z.enum(['AUTO', 'SEMANTIC', 'MASK']),
    locale: localeSchema,
    quality: z.enum(['low', 'medium', 'high']),
  })
  .strict()
  .refine((value) => new Set(value.annotationIds).size === value.annotationIds.length, {
    message: 'Image edit comments must be unique',
    path: ['annotationIds'],
  });

export const imageEditBatchStartSchema = z
  .object({
    seriesId: id,
    sourceAssetId: id,
    annotationIds: z.array(id).min(1).max(100),
    targets: z
      .array(
        z
          .object({
            modelKey: id,
            count: z.number().int().min(1).max(100),
            quality: z.enum(['low', 'medium', 'high']),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    mode: z.enum(['AUTO', 'SEMANTIC', 'MASK']),
    locale: localeSchema,
  })
  .strict()
  .refine((value) => new Set(value.annotationIds).size === value.annotationIds.length, {
    message: 'Image edit comments must be unique',
    path: ['annotationIds'],
  })
  .refine((value) => new Set(value.targets.map((target) => target.modelKey)).size === value.targets.length, {
    message: 'Image edit targets must be unique',
    path: ['targets'],
  });

export const intakeMediaBytesSchema = z
  .instanceof(Uint8Array)
  .refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= 100 * 1024 * 1024, {
    message: 'Media must be 100 MB or smaller',
  });

export const creatorIntakeMimeTypes = new Set<string>(creatorImageImportMimeTypeSchema.options);

export const intakeSchema = z
  .object({
    intent: z.enum(['IMPORT', 'START_CREATION']),
    source: z.enum(['PASTE', 'DROP', 'UPLOAD']),
    favorite: z.boolean().optional().default(false),
    albumId: id.nullable().optional().default(null),
    items: z
      .array(
        z.discriminatedUnion('kind', [
          z.object({ id, kind: z.literal('TEXT'), text: z.string().min(1).max(100_000) }),
          z.object({
            id,
            kind: z.literal('IMAGE'),
            name: z.string().min(1).max(500),
            mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']),
            width: z.number().int().min(0).max(65_535).optional().default(0),
            height: z.number().int().min(0).max(65_535).optional().default(0),
            sourceUrl: z
              .string()
              .trim()
              .max(2048)
              .refine((value) => !value || /^https?:\/\//i.test(value), { message: 'Source must be an HTTP(S) URL' })
              .optional()
              .default(''),
            metadata: importedImageMetadataSchema.optional(),
            relationship: importedImageRelationshipSchema.nullable().optional().default(null),
            bytes: intakeMediaBytesSchema,
          }),
          z.object({
            id,
            kind: z.literal('VIDEO'),
            name: z.string().min(1).max(500),
            mimeType: z.enum(['video/mp4', 'video/webm', 'video/quicktime']),
            width: z.number().int().positive().max(65_535),
            height: z.number().int().positive().max(65_535),
            durationMs: z.number().int().positive().safe(),
            sourceUrl: z
              .string()
              .trim()
              .max(2048)
              .refine((value) => !value || /^https?:\/\//i.test(value), { message: 'Source must be an HTTP(S) URL' })
              .optional()
              .default(''),
            metadata: importedImageMetadataSchema.optional(),
            bytes: intakeMediaBytesSchema,
          }),
        ]),
      )
      .min(1)
      .max(16),
  })
  .superRefine((value, context) => {
    for (const [index, item] of value.items.entries()) {
      if (item.kind === 'TEXT') continue;
      if (item.kind === 'IMAGE' && item.bytes.byteLength > 25 * 1024 * 1024) {
        context.addIssue({
          code: 'custom',
          message: 'Image must be 25 MB or smaller',
          path: ['items', index, 'bytes'],
        });
      }
      if (value.intent === 'START_CREATION' && (item.kind !== 'IMAGE' || !creatorIntakeMimeTypes.has(item.mimeType))) {
        context.addIssue({
          code: 'custom',
          message: 'Only PNG, JPEG, WebP, and SVG media can start a creation',
          path: ['items', index, 'mimeType'],
        });
      }
    }
    const totalBytes = value.items.reduce(
      (total, item) => total + (item.kind === 'TEXT' ? 0 : item.bytes.byteLength),
      0,
    );
    if (totalBytes > 100 * 1024 * 1024) {
      context.addIssue({ code: 'custom', message: 'Import must be 100 MB or smaller', path: ['items'] });
    }
  });

export const creationDraftSaveSchema = z.object({
  id: id.nullable(),
  expectedUpdatedAt: z.string().min(1).max(100).nullable().optional(),
  targetAlbumId: id.nullable(),
  title: z.string().max(300),
  text: z.string().max(30_000),
  promptNodes: z.array(creatorPromptNodeSchema).max(2_000).optional(),
  referenceAssetIds: z.array(id).max(8),
  termPromptLocale: localeSchema,
  termIds: z.array(id).max(100),
  wordPaletteReferences: z.array(wordPaletteReferenceSchema).max(50),
  dictionaryScope: creationDictionaryScopeSchema,
  canvasPresetKey: z.string().max(100).nullable(),
  quality: z.enum(['low', 'medium', 'high']),
  selectedModelKeys: z.array(id).max(20),
  repeatCount: z.number().int().min(1).max(100),
  modelTargets: z
    .array(
      z.object({
        modelKey: id,
        count: z.number().int().min(1).max(100),
        quality: z.enum(['low', 'medium', 'high']),
      }),
    )
    .max(20)
    .optional()
    .default([]),
});

export const assistantProposalAdoptionSchema = assistantProposalAdoptionBaseSchema.extend({
  persistence: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('DRAFT'), draft: creationDraftSaveSchema }),
      z.object({ kind: z.literal('SERIES'), version: generationSchema }),
    ])
    .optional(),
});

export const creationDraftLoadSchema = creationDraftLoadInputSchema;

export const creationDraftStartSchema = z
  .object({
    albumId: id.nullable(),
    termPromptLocale: localeSchema,
  })
  .strict();

export const creationDraftCommitSchema = z.object({
  creationDraftId: id,
  inspirationStashId: id.nullable().optional().default(null),
  imageBreakdownId: id.nullable().optional().default(null),
  title: z.string().max(300),
  manualPrompt: z.string().max(30_000),
  promptNodes: z.array(creatorPromptNodeSchema).max(2_000).optional(),
  prompt: z.string().trim().min(1).max(30_000),
  changeSummary: z.string().max(1_000),
  referenceAssetIds: z.array(id).max(8),
  termPromptLocale: localeSchema,
  termIds: z.array(id).max(100),
  wordPaletteReferences: z.array(wordPaletteReferenceSchema).max(50),
});

export const creationInputSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  title: z.string().max(300),
  manualPrompt: z.string().max(30_000),
  promptNodes: z.array(creatorPromptNodeSchema).max(2_000).optional(),
  resolvedPrompt: z.string().max(30_000),
  referenceAssetIds: z.array(id).max(8),
  termPromptLocale: localeSchema,
  termIds: z.array(id).max(100),
  wordPaletteReferences: z.array(wordPaletteReferenceSchema).max(50),
  dictionaryScope: creationDictionaryScopeSchema,
  canvasPresetKey: z.string().max(100).nullable(),
  generationTargets: z
    .array(
      z.object({
        modelKey: id,
        count: z.number().int().min(1).max(100),
        quality: z.enum(['low', 'medium', 'high']),
      }),
    )
    .min(1)
    .max(20),
});

export const creationInputStashCreateSchema = z.object({
  scope: creatorAgentScopeSchema,
  snapshot: creationInputSnapshotSchema,
});
