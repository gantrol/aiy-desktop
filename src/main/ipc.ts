import { app, dialog, shell, type BrowserWindow } from 'electron';
import { createHash } from 'node:crypto';
import { chmod, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { CodexTextModelDto, Locale } from '@/shared/contracts';
import type { CodexService } from '@/main/codex-service';
import type { AssistantService } from '@/main/assistant-service';
import { AssetFileActions } from '@/main/asset-file-actions';
import { importedImageMetadataSchema, importedImageRelationshipSchema } from '@/main/ipc/import-metadata-schema';
import { readCanvasPresets } from '@/main/canvas-presets';
import { LibraryDatabase } from '@/main/database';
import { ImageTransformService } from '@/main/image-transform-service';
import { copyImageInSandbox } from '@/main/image-clipboard-worker-client';
import type { GenerationService } from '@/main/generation-service';
import { commitIntakeAndRefreshRoutes } from '@/main/intake-route-refresh';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import type { CodexImageDiscovery } from '@/main/extensions/codex-image-discovery';
import type { OpenAiImageApiConnection } from '@/main/extensions/openai-image-api/connection';
import type { DeepSeekApiConnection } from '@/main/extensions/deepseek-api/connection';
import { ASSISTANT_MODEL_DEFINITIONS, type AssistantRoutingConfiguration } from '@/main/assistant-routing';
import {
  externalImageApiEndpointPermission,
  type ExternalImageApiConnections,
} from '@/main/extensions/external-image-api';
import {
  CODEX_APP_SERVER_EXTENSION_ID,
  CODEX_IMAGE_DISCOVERY_EXTENSION_ID,
  EXTERNAL_IMAGE_API_EXTENSION_IDS,
} from '@/shared/extension-ids';
import { registerStorageIpc, type LocalSpaceActions } from '@/main/ipc/storage-handlers';
import { createTrustedIpcHandlerRegistrar, type TrustedIpcInvocationRunner } from '@/main/ipc/trusted-handlers';
import { registerCreatorImportIpc } from '@/main/ipc/creator-import-handlers';
import { registerDictionaryIpc } from '@/main/ipc/dictionary-handlers';
import { termDraftSchema } from '@/main/database/term-draft-schema';

const localeSchema = z.enum(['zh', 'en']);
const id = z.string().min(1).max(200);
const wordPaletteReferenceSchema = z.object({
  paletteId: id,
  paletteRevisionId: id,
  parameterValues: z.record(z.string().max(64), z.string().max(120)),
  promptLocale: localeSchema,
});
const creatorPromptNodeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('TEXT'), text: z.string().max(30_000) }).strict(),
  z.object({ kind: z.literal('TERM'), termId: id, promptLocale: localeSchema.optional() }).strict(),
  z.object({ kind: z.literal('RECIPE'), paletteId: id }).strict(),
]);
const albumDictionarySourceSchema = z.object({ packId: id, packReleaseId: id });
const creationDictionaryScopeSchema = z.object({
  mode: z.enum(['ALL', 'SELECTED']),
  sources: z.array(albumDictionarySourceSchema).max(50),
  includeLocalTerms: z.boolean(),
});
const albumCreationDefaultsSchema = z.object({
  schemaVersion: z.literal(1),
  recipes: z.array(wordPaletteReferenceSchema).max(50),
  dictionaryScope: creationDictionaryScopeSchema,
});
const assetFileRevealContextSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ALL_MATERIALS') }).strict(),
  z.object({ kind: z.literal('DICTIONARY') }).strict(),
  z.object({ kind: z.literal('ALBUM'), albumId: id }).strict(),
  z.object({ kind: z.literal('CREATION'), seriesId: id }).strict(),
  z.object({ kind: z.literal('TERM'), termId: id }).strict(),
]);
const assetFileRevealTargetContextSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ALL_MATERIALS') }).strict(),
  z.object({ kind: z.literal('DICTIONARY') }).strict(),
]);
const stringList = z.array(z.string().max(500)).max(100);
const dictionarySaveDraftSchema = z.object({
  draft: termDraftSchema,
  locale: localeSchema,
});
const assistTermSchema = z.object({
  stableId: id,
  revisionId: id,
  expressionRevisionId: id.nullable(),
  displayName: z.string().max(300),
  promptFragment: z.string().max(3000),
  negativeFragment: z.string().max(3000),
});
const assistAssetSchema = z.object({
  assetId: id,
  kind: z.enum(['GENERATED', 'REFERENCE']),
  originType: z.string().max(120).optional(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  mimeType: z.string().max(200),
});
const assistRecipeSchema = z.object({
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
const assistPromptNodeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('TEXT'), text: z.string().max(30_000) }),
  z.object({ kind: z.literal('TERM'), termId: id, termRevisionId: id }),
  z.object({ kind: z.literal('RECIPE'), paletteId: id, paletteRevisionId: id }),
]);
const assistSchema = z.object({
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
const creatorAgentScopeSchema = z.object({ kind: z.enum(['DRAFT', 'SERIES']), id });
const creatorAgentAssistSchema = assistSchema
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
const creatorAgentChatSchema = assistSchema
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
const assistantProposalAdoptionBaseSchema = z.object({
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
const titleSchema = z.object({
  prompt: z.string().min(1).max(30_000),
  title: z.string().max(300),
  mode: z.enum(['fill', 'regenerate']),
});
const renameSeriesSchema = z
  .object({
    seriesId: id,
    title: z.string().max(300),
    expectedTitle: z.string().max(300).optional(),
  })
  .refine((value) => Boolean(value.title.trim()), {
    message: 'A title is required',
  });
const deleteSeriesSchema = z.object({
  seriesId: id,
  outputDisposition: z.enum(['KEEP', 'TRASH']),
});
const generationBaseSchema = z.object({
  seriesId: id.nullable(),
  title: z.string().max(300),
  creationDraftId: id.nullable().optional().default(null),
  baseVersionId: id.nullable().optional().default(null),
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
const validateGenerationCanvas = (
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
const generationSchema = generationBaseSchema.superRefine(validateGenerationCanvas);
const generationOutputSetFailedSchema = z
  .object({
    runId: id,
    failed: z.boolean(),
  })
  .strict();
const generationBatchSchema = z.object({
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
const styleExplorationSlotSchema = z
  .object({
    label: z.string().min(1).max(300),
    rationale: z.string().max(2_000),
    variableAxis: z.string().max(1_000),
    risk: z.string().max(1_000),
    userInstruction: z.string().max(30_000),
    input: generationBaseSchema
      .omit({ seriesId: true, creationDraftId: true, modelKey: true })
      .superRefine(validateGenerationCanvas),
  })
  .superRefine((value, context) => {
    if (value.userInstruction.trim() !== value.input.manualPrompt.trim()) {
      context.addIssue({ code: 'custom', message: 'Direction instruction does not match its generation input' });
    }
  });
const directionExperimentDelegationSchema = z
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
const styleExplorationStartSchema = z
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
const knowledgeDistillationCreateSchema = z
  .object({
    sourceAssetId: id,
    locale: localeSchema,
  })
  .strict();
const knowledgeDistillationAcceptSchema = z
  .object({
    proposalId: id,
    locale: localeSchema,
    matchedTermIds: z.array(id).max(1000),
    candidateIds: z.array(id).max(100),
  })
  .strict();
const historicalTermRecommendationCreateSchema = z
  .object({
    scope: creatorAgentScopeSchema.nullable(),
    prompt: z.string().max(30_000),
    selectedTermIds: z.array(id).max(1_000),
    candidateTermIds: z.array(id).max(5_000),
    locale: localeSchema,
    limit: z.number().int().min(1).max(12).optional(),
  })
  .strict();
const historicalTermRecommendationListSchema = z
  .object({
    scope: creatorAgentScopeSchema.nullable(),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();
const dictionaryMaintenanceListSchema = z
  .object({
    locale: localeSchema,
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();
const dictionaryMaintenanceCreateSchema = z
  .object({
    locale: localeSchema,
  })
  .strict();
const generationVersionSchema = z.object({ versionId: id, modelKey: id });
const codexImageRefinementSchema = z
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
const imageEditStartSchema = z
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
const imageEditBatchStartSchema = z
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
const intakeMediaBytesSchema = z
  .instanceof(Uint8Array)
  .refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= 100 * 1024 * 1024, {
    message: 'Media must be 100 MB or smaller',
  });
const creatorIntakeMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const intakeSchema = z
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
            mimeType: z.enum([
              'image/png',
              'image/jpeg',
              'image/webp',
              'image/gif',
              'video/mp4',
              'video/webm',
              'video/quicktime',
            ]),
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
        ]),
      )
      .min(1)
      .max(16),
  })
  .superRefine((value, context) => {
    for (const [index, item] of value.items.entries()) {
      if (item.kind !== 'IMAGE') continue;
      if (item.mimeType.startsWith('image/') && item.bytes.byteLength > 25 * 1024 * 1024) {
        context.addIssue({
          code: 'custom',
          message: 'Image must be 25 MB or smaller',
          path: ['items', index, 'bytes'],
        });
      }
      if (value.intent === 'START_CREATION' && !creatorIntakeMimeTypes.has(item.mimeType)) {
        context.addIssue({
          code: 'custom',
          message: 'Only PNG, JPEG, and WebP media can start a creation',
          path: ['items', index, 'mimeType'],
        });
      }
    }
    const totalBytes = value.items.reduce(
      (total, item) => total + (item.kind === 'IMAGE' ? item.bytes.byteLength : 0),
      0,
    );
    if (totalBytes > 100 * 1024 * 1024) {
      context.addIssue({ code: 'custom', message: 'Import must be 100 MB or smaller', path: ['items'] });
    }
  });
const creationDraftSaveSchema = z.object({
  id: id.nullable(),
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
const assistantProposalAdoptionSchema = assistantProposalAdoptionBaseSchema.extend({
  persistence: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('DRAFT'), draft: creationDraftSaveSchema }),
      z.object({ kind: z.literal('SERIES'), version: generationSchema }),
    ])
    .optional(),
});
const creationDraftStartSchema = z.object({ albumId: id.nullable(), termPromptLocale: localeSchema });
const creationDraftCommitSchema = z.object({
  creationDraftId: id,
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
const creationInputSnapshotSchema = z.object({
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
const creationInputStashCreateSchema = z.object({
  scope: creatorAgentScopeSchema,
  snapshot: creationInputSnapshotSchema,
});
const annotationBrushPointSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict();
const annotationBrushStrokeSchema = z
  .object({
    mode: z.enum(['ADD', 'ERASE']),
    radius: z.number().min(0.001).max(0.25),
    points: z.array(annotationBrushPointSchema).min(1).max(2_048),
  })
  .strict();
const annotationBrushGeometrySchema = z
  .object({
    version: z.literal(1),
    strokes: z.array(annotationBrushStrokeSchema).min(1).max(64),
  })
  .strict();
const annotationShapeSchema = z
  .object({
    type: z.enum(['RECTANGLE', 'BRUSH']),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1).nullable().optional(),
    height: z.number().min(0).max(1).nullable().optional(),
    geometry: annotationBrushGeometrySchema.nullable().optional(),
    comment: z.string().max(2000),
  })
  .strict();
function validateAnnotationShape(value: z.infer<typeof annotationShapeSchema>, context: z.RefinementCtx) {
  if (value.type === 'RECTANGLE') {
    if (value.width == null || value.height == null || value.width <= 0 || value.height <= 0) {
      context.addIssue({ code: 'custom', message: 'Rectangle annotations require a positive width and height' });
    } else if (value.x + value.width > 1 || value.y + value.height > 1) {
      context.addIssue({ code: 'custom', message: 'Rectangle annotations must stay within the image bounds' });
    }
  }
  if (value.type === 'BRUSH') {
    if (!value.geometry) {
      context.addIssue({ code: 'custom', message: 'Brush annotations require geometry', path: ['geometry'] });
    } else {
      const pointCount = value.geometry.strokes.reduce((total, stroke) => total + stroke.points.length, 0);
      if (pointCount > 10_000) {
        context.addIssue({
          code: 'custom',
          message: 'Brush annotations support at most 10,000 points',
          path: ['geometry'],
        });
      }
      if (!value.geometry.strokes.some((stroke) => stroke.mode === 'ADD')) {
        context.addIssue({
          code: 'custom',
          message: 'Brush annotations require an editable stroke',
          path: ['geometry'],
        });
      }
    }
  } else if (value.geometry != null) {
    context.addIssue({ code: 'custom', message: 'Only brush annotations may include geometry', path: ['geometry'] });
  }
}
const annotationSchema = annotationShapeSchema.extend({ imageAssetId: id }).superRefine(validateAnnotationShape);
const annotationUpdateSchema = annotationShapeSchema.extend({ annotationId: id }).superRefine(validateAnnotationShape);
const annotationHistoryReuseSchema = z.object({ promptVersionId: id }).strict();
const annotationStatusSchema = z.object({
  annotationId: id,
  status: z.enum(['OPEN', 'RESOLVED', 'DISMISSED']),
});
const imageCropSchema = z
  .object({
    seriesId: id,
    sourceAssetId: id,
    ratioWidth: z.number().int().min(1).max(100),
    ratioHeight: z.number().int().min(1).max(100),
  })
  .strict();
const imageReframeStartSchema = imageCropSchema
  .extend({
    modelKey: id,
    locale: localeSchema,
    quality: z.enum(['low', 'medium', 'high']),
  })
  .strict();
const imageRatingScoreSchema = z.number().int().min(1).max(5).nullable();
const imageRatingDimensionSchema = z.enum(['AESTHETIC', 'REALISM']);
const galleryListSchema = z.object({
  locale: localeSchema,
  source: z.enum(['ALL', 'LIBRARY', 'FAVORITE', 'CREATION', 'DICTIONARY', 'MATERIAL', 'IMPORT']),
  favoriteOnly: z.boolean().optional(),
  dictionary: z
    .object({
      facetValueIds: z.array(id).max(2).optional(),
      missingFacetSystemRoles: z
        .array(z.enum(['PRIMARY_CLASSIFICATION', 'SECONDARY_CLASSIFICATION']))
        .max(2)
        .optional(),
      termId: id.optional(),
      packReleaseIds: z.array(id).max(50).optional(),
      includeLocalTerms: z.boolean().optional(),
    })
    .strict()
    .optional(),
  query: z.string().max(200).optional(),
  assetKinds: z
    .array(z.enum(['GENERATED', 'REFERENCE']))
    .max(2)
    .optional(),
  albumId: id.optional(),
  creationRelation: z.enum(['ALL', 'INPUT', 'OUTPUT']).optional(),
  unratedDimensions: z.array(imageRatingDimensionSchema).max(2),
  cursor: z.string().max(1024).nullable(),
  limit: z.number().int().min(1).max(60),
});
const materialAlbumListSchema = z.object({ locale: localeSchema });
const materialAlbumCreateSchema = z.object({ title: z.string().min(1).max(200), parentAlbumId: id.optional() });
const materialAlbumRenameSchema = z.object({ albumId: id, title: z.string().min(1).max(200) });
const materialAlbumTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('MATERIAL'), materialId: id }),
  z.object({ kind: z.literal('IMAGE_ASSET'), imageAssetId: id }),
]);
const materialAlbumAddManySchema = z.object({
  albumId: id,
  targets: z.array(materialAlbumTargetSchema).max(200),
});
const materialDestinationsAddSchema = z
  .object({
    targets: z.array(materialAlbumTargetSchema).min(1).max(200),
    albumIds: z.array(id).max(50),
    termIds: z.array(id).max(50),
  })
  .refine((value) => value.albumIds.length + value.termIds.length > 0, {
    message: 'Choose at least one destination',
  });
const albumCreateFromMaterialsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  targets: z.array(materialAlbumTargetSchema).min(1).max(200),
});
const materialAlbumRemoveSchema = z.object({ albumId: id, materialIds: z.array(id).max(200) });
const albumMemberTargetTypeSchema = z.enum(['MATERIAL', 'SERIES', 'ALBUM']);
const albumCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  intent: z.string().max(2000).optional(),
  parentAlbumId: id.nullable().optional(),
});
const albumRenameSchema = z.object({ albumId: id, title: z.string().trim().min(1).max(200) });
const albumCreationDefaultsUpdateSchema = z.object({
  albumId: id,
  defaults: albumCreationDefaultsSchema,
});
const albumSetPinnedSchema = z.object({ albumId: id, pinned: z.boolean() });
const albumSetArchivedSchema = z.object({ albumId: id, archived: z.boolean() });
const albumMoveSchema = z.object({ albumId: id, parentAlbumId: id.nullable() });
const albumMoveSeriesSchema = z.object({ seriesIds: z.array(id).min(1).max(200), albumId: id.nullable() });
const albumAddMembersSchema = z.object({
  albumId: id,
  members: z.array(z.object({ targetType: albumMemberTargetTypeSchema, targetId: id })).max(200),
});
const albumRemoveMembersSchema = z.object({ albumId: id, memberIds: z.array(id).max(200) });
const albumReorderMembersSchema = z.object({ albumId: id, memberIds: z.array(id).max(2000) });
const sidebarRootReorderSchema = z.object({
  scope: z.enum(['CREATOR', 'GALLERY']),
  targets: z.array(z.object({ targetType: z.enum(['ALBUM', 'SERIES']), targetId: id })).max(5000),
});
const creationGroupRenameSchema = z.object({
  creationGroupId: id,
  title: z.string().trim().min(1).max(200),
});
const materialCollectionSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('MATERIAL_VIEW'), viewId: id }),
  z.object({ kind: z.literal('CREATION_GROUP'), creationGroupId: id }),
  z.object({ kind: z.literal('PROMPT_SERIES'), seriesId: id }),
]);
const materialCollectionCreateFromSourceSchema = z.object({
  source: materialCollectionSourceSchema,
  snapshot: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('GALLERY_QUERY'),
      query: z.object({
        source: z.enum(['ALL', 'LIBRARY', 'FAVORITE', 'CREATION', 'DICTIONARY', 'MATERIAL', 'IMPORT']),
        query: z.string().max(500).optional(),
        assetKinds: z
          .array(z.enum(['REFERENCE', 'GENERATED']))
          .max(10)
          .optional(),
        albumId: id,
        unratedDimensions: z.array(z.enum(['AESTHETIC', 'REALISM'])).max(2),
      }),
    }),
    z.object({
      kind: z.literal('ORDERED_ASSETS'),
      imageAssetIds: z.array(id).max(10_000),
    }),
  ]),
  title: z.string().trim().min(1).max(200).optional(),
  locale: localeSchema,
});
const materialMetadataUpdateSchema = z.object({
  materialId: id,
  displayName: z.string().trim().min(1).max(300),
  note: z.string().max(2000),
  sourceUrl: z
    .string()
    .trim()
    .max(2048)
    .refine((value) => !value || /^https?:\/\//i.test(value), { message: 'Source must be an HTTP(S) URL' }),
  aiGeneratedStatus: z.enum(['YES', 'NO', 'UNKNOWN', 'OTHER']),
  modelKey: z.string().max(200).nullable(),
  modelName: z.string().max(300),
  modelProvider: z.string().max(300),
  modelVersion: z.string().max(200),
  generationTextType: z.enum(['EXACT_PROMPT', 'DESCRIPTION', 'RECONSTRUCTION', 'UNKNOWN']),
  generationText: z.string().max(20000),
});

const extensionSetEnabledSchema = z.object({ extensionId: id, enabled: z.boolean() });
const extensionSetPermissionSchema = z.object({
  extensionId: id,
  permission: z.string().trim().min(1).max(240),
  granted: z.boolean(),
});
const codexGeneratedImageImportSchema = z
  .object({
    discoveryIds: z
      .array(z.string().regex(/^[a-f0-9]{64}$/))
      .min(1)
      .max(8),
  })
  .strict()
  .refine((value) => new Set(value.discoveryIds).size === value.discoveryIds.length, {
    message: 'Codex image selection must be unique',
    path: ['discoveryIds'],
  });
const codexGeneratedImageListSchema = z
  .object({
    filter: z.enum(['NOT_IN_LIBRARY', 'IN_LIBRARY', 'ALL']).default('NOT_IN_LIBRARY'),
    includeUntitled: z.boolean().optional(),
    page: z.number().int().min(1).max(100_000),
    pageSize: z.number().int().min(12).max(60),
    refresh: z.boolean().optional(),
  })
  .strict();
const openAiImageApiSaveSchema = z
  .object({
    apiKey: z.string().max(500),
    organizationId: z.string().max(200),
    projectId: z.string().max(200),
    moderation: z.enum(['auto', 'low']),
  })
  .strict();
const deepSeekApiSaveSchema = z.object({ apiKey: z.string().max(500) }).strict();
const assistantReasoningEffortSchema = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const assistantRoutingSelectionSchema = z
  .object({
    routeKey: id,
    modelKey: id.nullable(),
    reasoningEffort: assistantReasoningEffortSchema.nullable(),
  })
  .strict();
const assistantRoutingSaveSchema = z
  .object({
    selections: z
      .object({
        directions: assistantRoutingSelectionSchema,
        optimize: assistantRoutingSelectionSchema,
        title: assistantRoutingSelectionSchema,
      })
      .strict(),
  })
  .strict();
const externalImageApiExtensionIdSchema = z.enum(EXTERNAL_IMAGE_API_EXTENSION_IDS);
const externalImageApiSaveSchema = z
  .object({
    extensionId: externalImageApiExtensionIdSchema,
    apiKey: z.string().max(500),
    settings: z.record(z.string().max(100), z.string().max(500)),
  })
  .strict();

export function registerIpc(
  database: LibraryDatabase,
  codex: CodexService,
  assistant: AssistantService,
  generation: GenerationService,
  extensions: ExtensionRegistry,
  codexImageDiscovery: CodexImageDiscovery,
  openAiImageApi: OpenAiImageApiConnection,
  deepSeekApi: DeepSeekApiConnection,
  assistantRouting: AssistantRoutingConfiguration,
  externalImageApis: ExternalImageApiConnections,
  importStarterPack: () => string,
  canvasPresetPaths: string | readonly string[],
  getWindow: () => BrowserWindow | null,
  sendRendererEvent: (channel: string, ...args: unknown[]) => boolean,
  requestAppQuit: () => Promise<void>,
  localSpaces: LocalSpaceActions,
  runInLibraryContext?: TrustedIpcInvocationRunner,
) {
  const ipcMain = createTrustedIpcHandlerRegistrar(getWindow, runInLibraryContext);
  const runAssistantRequest = (request: z.infer<typeof creatorAgentAssistSchema>) => {
    const execution = assistantRouting.resolve(request.mode);
    const extension = extensions.get(execution.extensionId);
    if (!extension?.enabled || extension.connectionState !== 'READY') {
      throw new Error(
        `${execution.name} is unavailable: ${extension?.connectionMessage || 'provider extension unavailable'}`,
      );
    }
    const contextHash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    const capabilityReceipt = {
      directTermCount: request.directTerms.length,
      candidateTermCount: request.candidateTerms.length,
      recipeCount: request.recipes.length,
      referenceCount: request.referenceAssets.length,
      visionAnalyzed: false as const,
    };
    const run = database.startAssistantRun(request, contextHash, capabilityReceipt, {
      providerKey: execution.providerKey,
      modelKey: execution.modelKey,
      reasoningEffort: execution.reasoningEffort,
    });
    for (const progress of run.activityEvents ?? []) {
      sendRendererEvent('assistant-run:progress', progress);
    }
    return assistant.run(run.id);
  };
  const runTitleRequest = (request: z.infer<typeof titleSchema>) => {
    const execution = assistantRouting.resolve('title');
    const extension = extensions.get(execution.extensionId);
    if (!extension?.enabled || extension.connectionState !== 'READY') {
      throw new Error(
        `${execution.name} is unavailable: ${extension?.connectionMessage || 'provider extension unavailable'}`,
      );
    }
    return assistant.suggestTitles(request, {
      providerKey: execution.providerKey,
      modelKey: execution.modelKey,
      reasoningEffort: execution.reasoningEffort,
    });
  };

  const chooseFile = (options: Electron.OpenDialogOptions) => {
    const parent = getWindow();
    return parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options);
  };
  registerStorageIpc(
    database,
    localSpaces,
    () => chooseFile({ properties: ['openDirectory'] }),
    () =>
      chooseFile({
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      }),
    importStarterPack,
    ipcMain,
  );
  registerCreatorImportIpc(ipcMain, database, () =>
    chooseFile({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    }),
  );
  registerDictionaryIpc(
    ipcMain,
    database,
    () =>
      chooseFile({
        properties: ['openFile'],
        filters: [{ name: 'Dictionary', extensions: ['json', 'csv'] }],
      }),
    generation,
  );
  ipcMain.handle('dictionary:save-draft', (_event, raw) => {
    const input = dictionarySaveDraftSchema.parse(raw);
    return database.saveTermDraft(input.draft, input.locale);
  });
  ipcMain.handle('app:request-quit', () => requestAppQuit());
  const assetFiles = new AssetFileActions(
    (assetId) => database.resolveAssetFile(assetId),
    {
      showSaveDialog: (options) => {
        const parent = getWindow();
        const defaultPath =
          typeof options.defaultPath === 'string'
            ? path.join(app.getPath('downloads'), path.basename(options.defaultPath))
            : undefined;
        const localizedOptions = { ...options, defaultPath };
        return parent ? dialog.showSaveDialog(parent, localizedOptions) : dialog.showSaveDialog(localizedOptions);
      },
      copyFile: async (sourcePath, destinationPath) => {
        await copyFile(sourcePath, destinationPath);
        // Managed hard links make the immutable source read-only. An explicit
        // export is a user-owned copy and must remain editable.
        await chmod(destinationPath, 0o644);
      },
      copyImage: (filePath) => copyImageInSandbox(filePath),
      showItemInFolder: (filePath) => shell.showItemInFolder(filePath),
      openPath: (filePath) => shell.openPath(filePath),
    },
    async (asset, context) => {
      const revealPath = await database.resolveAssetRevealPathAsync(asset.assetId, context);
      if (!revealPath) throw new Error('Asset file is unavailable');
      return revealPath;
    },
  );
  const imageTransforms = new ImageTransformService(database);
  ipcMain.handle('app:bootstrap', (_event, rawLocale) => {
    const locale = localeSchema.parse(rawLocale) as Locale;
    const workbench = database.getWorkbench(locale);
    const terms = database.searchTerms(locale);
    return {
      locale,
      spaceName: database.getLibraryName(),
      spaceCoverUrl: localSpaces.currentCoverUrl(),
      terms,
      categories: database.getCategories(locale),
      facets: database.getFacets(locale),
      wordPalettes: database.getWordPalettes(locale, terms),
      canvasPresets: readCanvasPresets(canvasPresetPaths, locale),
      ...workbench,
      codex: codex.cachedHealth,
      extensions: extensions.list(),
      modelWorker: generation.workerStatus,
      imageGenerationRoutes: generation.imageGenerationRoutes,
      generationTasks: generation.tasks,
      assistantRuns: database.listAssistantRuns(),
      creations: database.listCreations(),
      styleExplorationBatches: database.listStyleExplorationBatches(),
      agentTasks: database.listDirectionExperimentDirectorTasks(),
      libraryEmpty: database.isLibraryEmpty(),
      creationDraft: database.getCreationDraft(),
    };
  });
  const syncExternalImageApiRuntime = async () => {
    await generation.configureExternalImageApis?.(
      externalImageApis.runtimeConfigurations((extensionId, permission) =>
        extensions.isPermissionGranted(extensionId, permission),
      ),
    );
  };
  const syncDeepSeekApiRuntime = async () => {
    await generation.configureDeepSeekApi?.(deepSeekApi.runtimeConfiguration());
  };
  ipcMain.handle('extensions:list', () => extensions.list());
  ipcMain.handle('extension-language-packs:list', () => extensions.listLanguagePacks());
  ipcMain.handle('extension:install-local', async () => {
    const selection = await chooseFile({ properties: ['openDirectory'] });
    if (selection.canceled || !selection.filePaths[0]) {
      return { extensionId: null, extensions: extensions.list() };
    }
    return extensions.installLocal(selection.filePaths[0]);
  });
  ipcMain.handle('extension:uninstall-local', (_event, rawExtensionId) =>
    extensions.uninstallLocal(id.parse(rawExtensionId)),
  );
  const syncCodexImageDiscovery = () =>
    codexImageDiscovery.setActive(extensions.isActivated(CODEX_IMAGE_DISCOVERY_EXTENSION_ID));
  ipcMain.handle('extension:set-enabled', async (_event, raw) => {
    const input = extensionSetEnabledSchema.parse(raw);
    if (!input.enabled && (generation.hasPending || codex.hasPending)) {
      throw new Error('Wait for active model tasks to finish before disabling an extension');
    }
    extensions.setEnabled(input.extensionId, input.enabled);
    await syncCodexImageDiscovery();
    await generation.refreshExtensions?.();
    await syncDeepSeekApiRuntime();
    await syncExternalImageApiRuntime();
    return extensions.list();
  });
  ipcMain.handle('extension:set-permission', async (_event, raw) => {
    const input = extensionSetPermissionSchema.parse(raw);
    if (!input.granted && (generation.hasPending || codex.hasPending)) {
      throw new Error('Wait for active model tasks to finish before revoking a permission');
    }
    extensions.setPermission(input.extensionId, input.permission, input.granted);
    await syncCodexImageDiscovery();
    await generation.refreshExtensions?.();
    await syncDeepSeekApiRuntime();
    await syncExternalImageApiRuntime();
    return extensions.list();
  });
  const assertCodexImageDiscoveryActive = () => {
    if (!extensions.isActivated(CODEX_IMAGE_DISCOVERY_EXTENSION_ID)) {
      throw new Error('Codex Image Discovery is disabled or missing permissions');
    }
  };
  ipcMain.handle('codex-generated-images:list', async (_event, raw) => {
    assertCodexImageDiscoveryActive();
    return codexImageDiscovery.list(codexGeneratedImageListSchema.parse(raw));
  });
  ipcMain.handle('codex-generated-images:import', async (_event, raw) => {
    assertCodexImageDiscoveryActive();
    return codexImageDiscovery.importImages(codexGeneratedImageImportSchema.parse(raw));
  });
  const syncOpenAiImageApiRuntime = async () => {
    await generation.configureOpenAiImageApi?.(openAiImageApi.runtimeConfiguration());
  };
  const assertOpenAiImageApiMutable = () => {
    if (generation.hasPending) throw new Error('Wait for active image tasks before changing OpenAI API configuration');
  };
  ipcMain.handle('openai-image-api:get', () => openAiImageApi.status());
  ipcMain.handle('openai-image-api:save', async (_event, raw) => {
    const input = openAiImageApiSaveSchema.parse(raw);
    if (generation.hasPending && openAiImageApi.changesRequestCredentials(input)) {
      assertOpenAiImageApiMutable();
    }
    const result = openAiImageApi.save(input);
    await syncOpenAiImageApiRuntime();
    return result;
  });
  ipcMain.handle('openai-image-api:test', async () => {
    assertOpenAiImageApiMutable();
    const result = await openAiImageApi.test();
    await syncOpenAiImageApiRuntime();
    return result;
  });
  ipcMain.handle('openai-image-api:clear', async () => {
    assertOpenAiImageApiMutable();
    const result = openAiImageApi.clear();
    await syncOpenAiImageApiRuntime();
    return result;
  });
  const assertDeepSeekApiMutable = () => {
    if (codex.hasPending) throw new Error('Wait for active AI tasks before changing DeepSeek API configuration');
  };
  ipcMain.handle('deepseek-api:get', () => deepSeekApi.status());
  ipcMain.handle('deepseek-api:save', async (_event, raw) => {
    assertDeepSeekApiMutable();
    const result = await deepSeekApi.saveAndTest(deepSeekApiSaveSchema.parse(raw));
    await syncDeepSeekApiRuntime();
    return result;
  });
  ipcMain.handle('deepseek-api:test', async () => {
    assertDeepSeekApiMutable();
    const result = await deepSeekApi.test();
    await syncDeepSeekApiRuntime();
    return result;
  });
  ipcMain.handle('deepseek-api:clear', async () => {
    assertDeepSeekApiMutable();
    const result = deepSeekApi.clear();
    await syncDeepSeekApiRuntime();
    return result;
  });
  const assistantRoutingSnapshot = async () => {
    const configuration = assistantRouting.get();
    const codexExtension = extensions.get(CODEX_APP_SERVER_EXTENSION_ID);
    let codexModels: CodexTextModelDto[] = [];
    if (codexExtension?.enabled && codexExtension.connectionState === 'READY') {
      try {
        codexModels = await codex.listModels();
      } catch {
        // The runtime-managed default remains usable when catalog discovery is temporarily unavailable.
      }
    }
    return {
      ...configuration,
      models: ASSISTANT_MODEL_DEFINITIONS.map((model) => {
        const extension = extensions.get(model.extensionId);
        const ready = Boolean(extension?.enabled && extension.connectionState === 'READY');
        return {
          ...model,
          supportedOperations: [...model.supportedOperations],
          modelOptions: model.modelSelectionMode === 'CATALOG' ? codexModels : [],
          state: ready ? ('READY' as const) : ('UNAVAILABLE' as const),
          availabilityReason: ready ? null : extension?.connectionMessage || 'Provider extension unavailable',
        };
      }),
    };
  };
  ipcMain.handle('assistant-routing:get', assistantRoutingSnapshot);
  ipcMain.handle('assistant-routing:save', async (_event, raw) => {
    assistantRouting.save(assistantRoutingSaveSchema.parse(raw));
    return await assistantRoutingSnapshot();
  });
  const assertExternalImageApiMutable = () => {
    if (generation.hasPending) throw new Error('Wait for active image tasks before changing image API configuration');
  };
  ipcMain.handle('external-image-api:get', (_event, rawExtensionId) =>
    externalImageApis.status(externalImageApiExtensionIdSchema.parse(rawExtensionId)),
  );
  ipcMain.handle('external-image-api:save', async (_event, raw) => {
    assertExternalImageApiMutable();
    const input = externalImageApiSaveSchema.parse(raw);
    const endpointPermission = externalImageApiEndpointPermission(input.extensionId, input.settings);
    if (endpointPermission && !extensions.isPermissionGranted(input.extensionId, endpointPermission)) {
      throw new Error(`Grant extension permission ${endpointPermission} before saving this endpoint`);
    }
    const result = await externalImageApis.saveAndTest(input);
    await syncExternalImageApiRuntime();
    return result;
  });
  ipcMain.handle('external-image-api:test', async (_event, rawExtensionId) => {
    assertExternalImageApiMutable();
    const result = await externalImageApis.test(externalImageApiExtensionIdSchema.parse(rawExtensionId));
    await syncExternalImageApiRuntime();
    return result;
  });
  ipcMain.handle('external-image-api:clear', async (_event, rawExtensionId) => {
    assertExternalImageApiMutable();
    const result = externalImageApis.clear(externalImageApiExtensionIdSchema.parse(rawExtensionId));
    await syncExternalImageApiRuntime();
    return result;
  });
  ipcMain.handle('intake:commit', async (_event, raw) => {
    const input = intakeSchema.parse(raw);
    const result = await commitIntakeAndRefreshRoutes(database, generation, input);
    // Importing from inside an album files the material there; a failed album
    // write must not discard the import that already succeeded.
    if (!input.albumId || !result.materialIds.length) return result;
    try {
      database.addMaterialsToDestinations({
        targets: result.materialIds.map((materialId) => ({ kind: 'MATERIAL' as const, materialId })),
        albumIds: [input.albumId],
        termIds: [],
      });
      return { ...result, albumId: input.albumId };
    } catch {
      return result;
    }
  });
  ipcMain.handle('creation-draft:start', (_event, raw) =>
    database.startCreationDraft(creationDraftStartSchema.parse(raw)),
  );
  ipcMain.handle('creation-draft:save', (_event, raw) =>
    database.saveCreationDraft(creationDraftSaveSchema.parse(raw)),
  );
  ipcMain.handle('creation-draft:commit', (_event, raw) =>
    database.commitCreationDraft(creationDraftCommitSchema.parse(raw)),
  );
  ipcMain.handle('creation-input-stashes:list', (_event, raw) =>
    database.listCreationInputStashes(creatorAgentScopeSchema.parse(raw)),
  );
  ipcMain.handle('creation-input-stash:create', (_event, raw) =>
    database.createCreationInputStash(creationInputStashCreateSchema.parse(raw)),
  );
  ipcMain.handle('creations:delete', (_event, raw) => database.deleteCreation(id.parse(raw)));
  ipcMain.handle('materials:add-to-destinations', (_event, raw) =>
    database.addMaterialsToDestinations(materialDestinationsAddSchema.parse(raw)),
  );
  ipcMain.handle('assets:choose-references', async () => {
    const result = await chooseFile({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (result.canceled) return { assets: [] };
    if (result.filePaths.length > 8) throw new Error('Import supports at most 8 images');
    const assets = [];
    for (const filePath of result.filePaths) assets.push(await database.importReferenceAsync(filePath));
    return { assets };
  });
  ipcMain.handle('codex:health', () => codex.refreshHealth());
  ipcMain.handle('codex:open-thread', (_event, rawThreadId) => {
    const threadId = id.parse(rawThreadId);
    return shell.openExternal(`codex://threads/${encodeURIComponent(threadId)}`);
  });
  ipcMain.handle('agent:history', (_event, raw) => database.listCreatorAgentTurns(creatorAgentScopeSchema.parse(raw)));
  ipcMain.handle('agent:chat', async (_event, raw) => {
    const request = creatorAgentChatSchema.parse(raw);
    const attachmentAssetIds = [...new Set(request.attachmentAssetIds)];
    const imagePaths = database.getReferencePaths(attachmentAssetIds);
    if (imagePaths.length !== attachmentAssetIds.length) {
      throw new Error('One or more conversation image attachments are unavailable');
    }
    const history = database
      .listCreatorAgentTurns(request.scope)
      .filter((turn) => turn.mode === 'chat')
      .slice(-20);
    const { scope: _scope, attachmentAssetIds: _attachmentAssetIds, ...input } = request;
    return codex.chat({ scope: request.scope, request, input, history, imagePaths });
  });
  ipcMain.handle('agent:assist', async (_event, raw) => {
    return runAssistantRequest(creatorAgentAssistSchema.parse(raw));
  });
  ipcMain.handle('assistant-proposal:expire', (_event, rawRunId, rawContextKey) =>
    database.expireAssistantProposal(id.parse(rawRunId), z.string().min(1).max(200).parse(rawContextKey)),
  );
  ipcMain.handle('assistant-proposal:revalidate', (_event, rawRunId, rawContextKey) =>
    database.revalidateAssistantProposal(id.parse(rawRunId), z.string().min(1).max(200).parse(rawContextKey)),
  );
  ipcMain.handle('assistant-proposal:adopt', (_event, raw) =>
    database.adoptAssistantProposal(assistantProposalAdoptionSchema.parse(raw)),
  );
  ipcMain.handle('assistant-proposal:close', (_event, rawRunId) => database.closeAssistantProposal(id.parse(rawRunId)));
  ipcMain.handle('assistant-run:dismiss', (_event, rawRunId) => database.dismissAssistantRun(id.parse(rawRunId)));
  ipcMain.handle('codex:suggest-titles', (_event, raw) => runTitleRequest(titleSchema.parse(raw)));
  ipcMain.handle('prompt-series:rename', (_event, raw) => database.renamePromptSeries(renameSeriesSchema.parse(raw)));
  ipcMain.handle('prompt-series:delete', (_event, raw) => database.deletePromptSeries(deleteSeriesSchema.parse(raw)));
  ipcMain.handle('creation-groups:rename', (_event, raw) =>
    database.renameCreationGroup(creationGroupRenameSchema.parse(raw)),
  );
  ipcMain.handle('material-collections:create-from-source', (_event, raw) =>
    database.createMaterialCollectionFromSource(materialCollectionCreateFromSourceSchema.parse(raw)),
  );
  ipcMain.handle('material-albums:list', (_event, raw) =>
    database.listMaterialAlbums(materialAlbumListSchema.parse(raw)),
  );
  ipcMain.handle('material-albums:create', (_event, raw) =>
    database.createMaterialAlbum(materialAlbumCreateSchema.parse(raw)),
  );
  ipcMain.handle('material-albums:rename', (_event, raw) =>
    database.renameMaterialAlbum(materialAlbumRenameSchema.parse(raw)),
  );
  ipcMain.handle('material-albums:delete', (_event, rawId) => database.deleteMaterialAlbum(id.parse(rawId)));
  ipcMain.handle('material-albums:add-many', (_event, raw) =>
    database.addMaterialAlbumMembers(materialAlbumAddManySchema.parse(raw)),
  );
  ipcMain.handle('material-albums:remove', (_event, raw) =>
    database.removeMaterialAlbumMembers(materialAlbumRemoveSchema.parse(raw)),
  );
  ipcMain.handle('albums:list', () => database.listAlbums());
  ipcMain.handle('albums:list-text-materials', (_event, rawId) => database.listAlbumTextMaterials(id.parse(rawId)));
  ipcMain.handle('albums:create', (_event, raw) => database.createAlbum(albumCreateSchema.parse(raw)));
  ipcMain.handle('albums:create-from-materials', (_event, raw) =>
    database.createAlbumFromMaterials(albumCreateFromMaterialsSchema.parse(raw)),
  );
  ipcMain.handle('albums:rename', (_event, raw) => database.renameAlbum(albumRenameSchema.parse(raw)));
  ipcMain.handle('albums:update-creation-defaults', (_event, raw) =>
    database.updateAlbumCreationDefaults(albumCreationDefaultsUpdateSchema.parse(raw)),
  );
  ipcMain.handle('albums:delete', (_event, rawId) => database.deleteAlbum(id.parse(rawId)));
  ipcMain.handle('albums:set-pinned', (_event, raw) => database.setAlbumPinned(albumSetPinnedSchema.parse(raw)));
  ipcMain.handle('albums:archive', (_event, rawId) => database.archiveAlbum(id.parse(rawId)));
  ipcMain.handle('albums:set-archived', (_event, raw) => database.setAlbumArchived(albumSetArchivedSchema.parse(raw)));
  ipcMain.handle('albums:move', (_event, raw) => database.moveAlbum(albumMoveSchema.parse(raw)));
  ipcMain.handle('albums:move-series', (_event, raw) => database.moveAlbumSeries(albumMoveSeriesSchema.parse(raw)));
  ipcMain.handle('albums:add-members', (_event, raw) => database.addAlbumMembers(albumAddMembersSchema.parse(raw)));
  ipcMain.handle('albums:remove-members', (_event, raw) =>
    database.removeAlbumMembers(albumRemoveMembersSchema.parse(raw)),
  );
  ipcMain.handle('albums:reorder-members', (_event, raw) =>
    database.reorderAlbumMembers(albumReorderMembersSchema.parse(raw)),
  );
  ipcMain.handle('albums:reorder-root', (_event, raw) =>
    database.reorderSidebarRoot(sidebarRootReorderSchema.parse(raw)),
  );
  ipcMain.handle('material-metadata:update', (_event, raw) =>
    database.updateMaterialMetadata(materialMetadataUpdateSchema.parse(raw)),
  );
  ipcMain.handle('material-provenance:suggestions', () => database.materialProvenanceSuggestions());
  ipcMain.handle('generation:start', (_event, raw) => generation.start(generationSchema.parse(raw)));
  ipcMain.handle('generation:start-batch', (_event, raw) => generation.startBatch(generationBatchSchema.parse(raw)));
  ipcMain.handle('image-edit:start', (_event, raw) => generation.startImageEdit(imageEditStartSchema.parse(raw)));
  ipcMain.handle('image-edit:start-batch', (_event, raw) =>
    generation.startImageEditBatch(imageEditBatchStartSchema.parse(raw)),
  );
  ipcMain.handle('image-transform:crop', (_event, raw) => {
    const input = imageCropSchema.parse(raw);
    return generation.cropImage ? generation.cropImage(input) : imageTransforms.crop(input);
  });
  ipcMain.handle('image-transform:reframe-start', (_event, raw) =>
    generation.startImageReframe(imageReframeStartSchema.parse(raw)),
  );
  ipcMain.handle('codex:image-refinement-start', (_event, raw) =>
    generation.startCodexImageRefinement(codexImageRefinementSchema.parse(raw)),
  );
  ipcMain.handle('style-exploration:start', (_event, raw) =>
    generation.startStyleExploration(styleExplorationStartSchema.parse(raw)),
  );
  ipcMain.handle('style-exploration:propose-adjacent', async (_event, rawSlotId) => {
    const slot = database.getStyleExplorationSlot(id.parse(rawSlotId));
    if (!slot) throw new Error('Style exploration direction not found');
    if (slot.completedCount < 1) throw new Error('An adjacent experiment requires a completed result');
    const batch = database.getStyleExplorationBatch(slot.batchId);
    if (!batch) throw new Error('Style exploration batch not found');
    const sourceRun = database.getAssistantRun(batch.sourceAssistantRunId);
    if (!sourceRun?.proposal || sourceRun.status !== 'SUCCEEDED') {
      throw new Error('The source direction proposal is unavailable');
    }
    if (sourceRun.proposal.status === 'CLOSED') {
      throw new Error('The source direction proposal is closed');
    }

    const contextKey = `adjacent:v1:${createHash('sha256')
      .update(
        JSON.stringify({
          sourceAssistantRunId: sourceRun.id,
          sourceContextHash: sourceRun.contextHash,
          sourceProposalId: sourceRun.proposal.id,
          batchId: batch.id,
          slotId: slot.id,
          versionId: slot.versionId,
          commonConstraints: batch.commonConstraints,
          label: slot.label,
          userInstruction: slot.userInstruction,
          variableAxis: slot.variableAxis,
          risk: slot.risk,
        }),
      )
      .digest('hex')}`;
    const request = creatorAgentAssistSchema.parse({
      ...sourceRun.input,
      mode: 'directions',
      directionStrategy: 'ADJACENT',
      prompt: slot.userInstruction,
      message:
        sourceRun.input.locale === 'zh'
          ? `用户明确选择了已完成的“${slot.label}”方向。仅依据冻结的 Prompt 与这次人工选择，围绕当前变化轴“${slot.variableAxis}”提出 3 个相邻实验。共同保持项不变；每个方向只能移动一个邻近变量值，不得引入无关变化轴。当前已知风险：${slot.risk || '无'}。没有视觉模型，不得声称分析过生成图片。`
          : `The user explicitly selected the completed “${slot.label}” direction. Using only its frozen prompt and this explicit selection, propose 3 adjacent experiments around the current axis “${slot.variableAxis}”. Keep the shared constraints fixed; each direction may move only one nearby variable value and must not introduce an unrelated axis. Known risk: ${slot.risk || 'none'}. No vision model is available, so do not claim to have analyzed the generated images.`,
      parentProposalId: sourceRun.proposal.id,
      sourceExperimentSlotId: slot.id,
      contextKey,
    });
    return runAssistantRequest(request);
  });
  ipcMain.handle('style-exploration:cancel', (_event, rawId) => generation.cancelStyleExploration(id.parse(rawId)));
  ipcMain.handle('style-exploration:retry-slot', (_event, rawId) =>
    generation.retryStyleExplorationSlot(id.parse(rawId)),
  );
  ipcMain.handle('knowledge-distillation:list', (_event, rawAssetId) =>
    database.listKnowledgeDistillationProposals(id.parse(rawAssetId)),
  );
  ipcMain.handle('knowledge-distillation:create', (_event, raw) =>
    database.createKnowledgeDistillationProposal(knowledgeDistillationCreateSchema.parse(raw)),
  );
  ipcMain.handle('knowledge-distillation:accept', (_event, raw) =>
    database.acceptKnowledgeDistillationProposal(knowledgeDistillationAcceptSchema.parse(raw)),
  );
  ipcMain.handle('historical-term-recommendations:list', (_event, raw) =>
    database.listHistoricalTermRecommendationRuns(historicalTermRecommendationListSchema.parse(raw)),
  );
  ipcMain.handle('historical-term-recommendations:create', (_event, raw) =>
    database.createHistoricalTermRecommendationRun(historicalTermRecommendationCreateSchema.parse(raw)),
  );
  ipcMain.handle('dictionary-maintenance:list', (_event, raw) =>
    database.listDictionaryMaintenanceReports(dictionaryMaintenanceListSchema.parse(raw)),
  );
  ipcMain.handle('dictionary-maintenance:create', (_event, raw) =>
    database.createDictionaryMaintenanceReport(dictionaryMaintenanceCreateSchema.parse(raw)),
  );
  ipcMain.handle('generation:start-version', (_event, raw) =>
    generation.startVersion(generationVersionSchema.parse(raw)),
  );
  ipcMain.handle('generation:retry', (_event, rawId) => generation.retry(id.parse(rawId)));
  ipcMain.handle('generation:cancel', (_event, rawId) => generation.cancel(id.parse(rawId)));
  ipcMain.handle('generation:output-set-failed', (_event, raw) => {
    const input = generationOutputSetFailedSchema.parse(raw);
    return database.setGenerationOutputFailed(input.runId, input.failed);
  });
  ipcMain.handle('annotations:list', (_event, rawId) => database.listAnnotations(id.parse(rawId)));
  ipcMain.handle('annotations:add', (_event, raw) => database.addAnnotation(annotationSchema.parse(raw)));
  ipcMain.handle('annotations:update', (_event, raw) => database.updateAnnotation(annotationUpdateSchema.parse(raw)));
  ipcMain.handle('annotations:reuse-history', (_event, raw) =>
    database.reuseAnnotationHistory(annotationHistoryReuseSchema.parse(raw).promptVersionId),
  );
  ipcMain.handle('annotations:set-status', (_event, raw) =>
    database.setAnnotationStatus(annotationStatusSchema.parse(raw)),
  );
  ipcMain.handle('gallery:list', (_event, raw) => database.listGallery(galleryListSchema.parse(raw)));
  ipcMain.handle('asset-relationship:get', (_event, rawId) => database.getAssetRelationship(id.parse(rawId)));
  ipcMain.handle('asset-file:availability', (_event, rawId) => assetFiles.availability(id.parse(rawId)));
  ipcMain.handle('asset-file:copy', (_event, rawId) => assetFiles.copy(id.parse(rawId)));
  ipcMain.handle('asset-file:save-as', (_event, rawId) => assetFiles.saveAs(id.parse(rawId)));
  ipcMain.handle('asset-file:reveal-targets', (_event, rawId, rawContext) =>
    database.listAssetRevealTargets(id.parse(rawId), assetFileRevealTargetContextSchema.optional().parse(rawContext)),
  );
  ipcMain.handle('asset-file:reveal', (_event, rawId, rawContext) =>
    assetFiles.reveal(id.parse(rawId), assetFileRevealContextSchema.optional().parse(rawContext)),
  );
  ipcMain.handle('asset-file:open', (_event, rawId) => assetFiles.open(id.parse(rawId)));
  ipcMain.handle('asset:delete', (_event, rawId) => database.deleteAsset(id.parse(rawId)));
  ipcMain.handle('favorites:text-list', () => database.listFavoriteTexts());
  ipcMain.handle('favorites:add', (_event, rawTarget) =>
    database.addFavorite(materialAlbumTargetSchema.parse(rawTarget)),
  );
  ipcMain.handle('favorites:remove', (_event, rawMaterialId) => database.removeFavorite(id.parse(rawMaterialId)));
  ipcMain.handle('image-rating:set', (_event, rawAssetId, rawDimension, rawScore) =>
    database.setImageRating(
      id.parse(rawAssetId),
      imageRatingDimensionSchema.parse(rawDimension),
      imageRatingScoreSchema.parse(rawScore),
    ),
  );
}
