import { z } from 'zod';
import { albumCreationDefaultsSchema, id, localeSchema } from '@/main/ipc/schemas/creation-generation-schemas';
import { EXTERNAL_IMAGE_API_EXTENSION_IDS } from '@/shared/extension-ids';
import {
  MAX_IMAGE_GENERATION_MAX_CONCURRENT,
  MIN_IMAGE_GENERATION_MAX_CONCURRENT,
} from '@/shared/image-generation-concurrency';

export const annotationBrushPointSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict();

export const annotationBrushStrokeSchema = z
  .object({
    mode: z.enum(['ADD', 'ERASE']),
    radius: z.number().min(0.001).max(0.25),
    points: z.array(annotationBrushPointSchema).min(1).max(2_048),
  })
  .strict();

export const annotationBrushGeometrySchema = z
  .object({
    version: z.literal(1),
    strokes: z.array(annotationBrushStrokeSchema).min(1).max(64),
  })
  .strict();

export const annotationShapeSchema = z
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

export function validateAnnotationShape(value: z.infer<typeof annotationShapeSchema>, context: z.RefinementCtx) {
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

export const annotationSchema = annotationShapeSchema.extend({ imageAssetId: id }).superRefine(validateAnnotationShape);

export const annotationUpdateSchema = annotationShapeSchema
  .extend({ annotationId: id })
  .superRefine(validateAnnotationShape);

export const annotationHistoryReuseSchema = z.object({ promptVersionId: id }).strict();

export const annotationStatusSchema = z.object({
  annotationId: id,
  status: z.enum(['OPEN', 'RESOLVED', 'DISMISSED']),
});

export const imageCropSchema = z
  .object({
    seriesId: id,
    sourceAssetId: id,
    ratioWidth: z.number().int().min(1).max(100),
    ratioHeight: z.number().int().min(1).max(100),
  })
  .strict();

export const imageReframeStartSchema = imageCropSchema
  .extend({
    modelKey: id,
    locale: localeSchema,
    quality: z.enum(['low', 'medium', 'high']),
  })
  .strict();

export const imageRatingScoreSchema = z.number().int().min(1).max(5).nullable();

export const imageRatingDimensionSchema = z.enum(['AESTHETIC', 'REALISM']);

export const galleryListSchema = z.object({
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
  placement: z.enum(['ANY', 'UNFILED', 'UNORGANIZED']).optional(),
  albumId: id.optional(),
  albumScope: z.enum(['TREE', 'DIRECT']).optional(),
  creationRelation: z.enum(['ALL', 'INPUT', 'OUTPUT']).optional(),
  unratedDimensions: z.array(imageRatingDimensionSchema).max(2),
  cursor: z.string().max(1024).nullable(),
  knownTotal: z.number().int().min(0).max(1_000_000_000).optional(),
  limit: z.number().int().min(1).max(60),
});

export const recycleBinScopeSchema = z.enum(['CREATOR_ALBUMS', 'MATERIAL_ALBUMS', 'CREATIONS', 'MATERIALS']);

const recycleBinEntityTypeSchema = z.enum(['ALBUM', 'PROMPT_SERIES', 'CREATION', 'IMAGE_ASSET']);

const recycleBinItemRefSchema = z
  .object({
    entityType: recycleBinEntityTypeSchema,
    entityId: id,
    expectedDeletedAt: z.string().min(1).max(64),
  })
  .strict();

const recycleBinSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ALL') }).strict(),
  z.object({ kind: z.literal('ITEMS'), items: z.array(recycleBinItemRefSchema).min(1).max(1_000) }).strict(),
]);

export const recycleBinListSchema = z
  .object({
    scope: recycleBinScopeSchema,
    cursor: z.string().max(512).nullable().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export const recycleBinRestoreSchema = recycleBinItemRefSchema.extend({ scope: recycleBinScopeSchema }).strict();

export const recycleBinPurgePlanSchema = z
  .object({ scope: recycleBinScopeSchema, selection: recycleBinSelectionSchema })
  .strict();

export const recycleBinPurgeSchema = recycleBinPurgePlanSchema
  .extend({ confirmationToken: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();

const contentLifecycleStateSchema = z.enum(['ARCHIVED', 'RECYCLE_BIN']);
const contentLifecycleKindSchema = z.enum(['ALBUM', 'CREATION', 'MATERIAL']);
const contentLifecycleEntityTypeSchema = z.enum([
  'ALBUM',
  'CREATION_ITEM',
  'PROMPT_SERIES',
  'CREATION',
  'INSPIRATION_STASH',
  'IMAGE_BREAKDOWN',
  'EVALUATION_SUITE',
  'SOCIAL_POST',
  'ARTICLE',
  'VIDEO_DOCUMENT',
  'MATERIAL',
  'IMAGE_ASSET',
]);

const contentLifecycleTargetSchema = z.object({ entityType: contentLifecycleEntityTypeSchema, entityId: id }).strict();

const contentLifecycleItemRefSchema = contentLifecycleTargetSchema
  .extend({ expectedChangedAt: z.string().min(1).max(64) })
  .strict();

export const contentLifecycleListSchema = z
  .object({
    state: contentLifecycleStateSchema,
    kind: contentLifecycleKindSchema.nullable().optional(),
    containerId: z.string().min(1).max(512).nullable().optional(),
    cursor: z.string().max(512).nullable().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export const contentLifecyclePlanSchema = z
  .object({
    action: z.enum(['ARCHIVE', 'DELETE']),
    targets: z.array(contentLifecycleTargetSchema).min(1).max(1_000),
  })
  .strict();

export const contentLifecycleApplySchema = contentLifecyclePlanSchema
  .extend({ confirmationToken: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();

export const contentLifecycleRestoreSchema = contentLifecycleItemRefSchema;

const contentLifecycleFilterSchema = z.object({ kind: contentLifecycleKindSchema.nullable().optional() }).strict();

const contentLifecyclePurgeSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('FILTER'), filter: contentLifecycleFilterSchema }).strict(),
  z.object({ kind: z.literal('ITEMS'), items: z.array(contentLifecycleItemRefSchema).min(1).max(1_000) }).strict(),
]);

export const contentLifecyclePurgePlanSchema = z.object({ selection: contentLifecyclePurgeSelectionSchema }).strict();

export const contentLifecyclePurgeSchema = contentLifecyclePurgePlanSchema
  .extend({ confirmationToken: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();

export const materialAlbumListSchema = z.object({ locale: localeSchema });

export const materialAlbumCreateSchema = z.object({
  title: z.string().min(1).max(200),
  locale: localeSchema,
  parentAlbumId: id.optional(),
});

export const materialAlbumRenameSchema = z.object({
  albumId: id,
  title: z.string().min(1).max(200),
  locale: localeSchema,
});

export const materialAlbumMoveSchema = z.object({
  albumId: id,
  parentAlbumId: id.nullable(),
  locale: localeSchema.optional(),
});

export const materialAlbumTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('MATERIAL'), materialId: id }),
  z.object({ kind: z.literal('IMAGE_ASSET'), imageAssetId: id }),
]);

export const materialImageAssetsResolveSchema = z
  .object({
    targets: z.array(materialAlbumTargetSchema).min(1).max(200),
  })
  .strict();

export const materialAlbumAddManySchema = z.object({
  albumId: id,
  locale: localeSchema,
  targets: z.array(materialAlbumTargetSchema).max(200),
});

export const materialDestinationsAddSchema = z
  .object({
    targets: z.array(materialAlbumTargetSchema).min(1).max(200),
    albumIds: z.array(id).max(50),
    termIds: z.array(id).max(50),
  })
  .refine((value) => value.albumIds.length + value.termIds.length > 0, {
    message: 'Choose at least one destination',
  });

export const albumCreateFromMaterialsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  titleLocale: localeSchema,
  targets: z.array(materialAlbumTargetSchema).min(1).max(200),
});

export const materialAlbumRemoveSchema = z.object({
  albumId: id,
  locale: localeSchema,
  materialIds: z.array(id).max(200),
});

export const albumMemberTargetTypeSchema = z.enum(['MATERIAL', 'ALBUM']);

export const albumCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  titleLocale: localeSchema,
  intent: z.string().max(2000).optional(),
  parentAlbumId: id.nullable().optional(),
});

export const albumRenameSchema = z.object({
  albumId: id,
  title: z.string().trim().min(1).max(200),
  locale: localeSchema,
});

export const albumCreationDefaultsUpdateSchema = z.object({
  albumId: id,
  defaults: albumCreationDefaultsSchema,
});

export const albumSetPinnedSchema = z.object({ albumId: id, pinned: z.boolean() });

export const albumSetArchivedSchema = z.object({ albumId: id, archived: z.boolean() });

export const albumMoveSchema = z.object({ albumId: id, parentAlbumId: id.nullable() });

export const albumAddMembersSchema = z.object({
  albumId: id,
  members: z.array(z.object({ targetType: albumMemberTargetTypeSchema, targetId: id })).max(200),
});

export const albumRemoveMembersSchema = z.object({ albumId: id, memberIds: z.array(id).max(200) });

export const albumReorderMembersSchema = z.object({ albumId: id, memberIds: z.array(id).max(2000) });

export const sidebarRootReorderSchema = z.object({
  scope: z.enum(['CREATOR', 'GALLERY']),
  targets: z.array(z.object({ targetType: z.enum(['ALBUM', 'CREATION_ITEM']), targetId: id })).max(5000),
});

export const creationAlbumRenameSchema = z.object({
  creationAlbumId: id,
  title: z.string().trim().min(1).max(200),
  locale: localeSchema,
});

export const materialCollectionSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('MATERIAL_VIEW'), viewId: id }),
  z.object({ kind: z.literal('CREATION_ALBUM'), creationAlbumId: id }),
  z.object({ kind: z.literal('CREATION_GROUP'), creationGroupId: id }),
  z.object({ kind: z.literal('PROMPT_SERIES'), seriesId: id }),
]);

export const materialCollectionCreateFromSourceSchema = z.object({
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

export const materialMetadataUpdateSchema = z.object({
  materialId: id,
  displayName: z.string().trim().min(1).max(300),
  note: z.string().max(2000),
  sourceUrl: z
    .string()
    .trim()
    .max(2048)
    .refine((value) => !value || /^https?:\/\//i.test(value), { message: 'Source must be an HTTP(S) URL' }),
  aiGeneratedStatus: z.enum(['YES', 'NO', 'UNKNOWN', 'OTHER']),
  modelName: z.string().max(300),
  modelProvider: z.string().max(300),
  modelVersion: z.string().max(200),
  generationTextType: z.enum(['EXACT_PROMPT', 'DESCRIPTION', 'RECONSTRUCTION', 'UNKNOWN']),
  generationText: z.string().max(20000),
});

export const extensionSetEnabledSchema = z.object({ extensionId: id, enabled: z.boolean() });

export const extensionSetPermissionSchema = z.object({
  extensionId: id,
  permission: z.string().trim().min(1).max(240),
  granted: z.boolean(),
});

export const codexGeneratedImageImportSchema = z
  .object({
    discoveryIds: z
      .array(z.string().regex(/^[a-f0-9]{64}$/))
      .min(1)
      .max(8),
    locale: localeSchema,
  })
  .strict()
  .refine((value) => new Set(value.discoveryIds).size === value.discoveryIds.length, {
    message: 'Codex image selection must be unique',
    path: ['discoveryIds'],
  });

export const codexGeneratedImageRecoverSchema = z
  .object({
    discoveryId: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const codexGeneratedImageListSchema = z
  .object({
    filter: z.enum(['NOT_IN_LIBRARY', 'IN_LIBRARY', 'ALL']).default('NOT_IN_LIBRARY'),
    includeUntitled: z.boolean().optional(),
    page: z.number().int().min(1).max(100_000),
    pageSize: z.number().int().min(12).max(60),
    refresh: z.boolean().optional(),
  })
  .strict();

export const openAiImageApiSaveSchema = z
  .object({
    apiKey: z.string().max(500),
    organizationId: z.string().max(200),
    projectId: z.string().max(200),
    moderation: z.enum(['auto', 'low']),
  })
  .strict();

export const deepSeekApiSaveSchema = z
  .object({
    apiKey: z.string().max(500),
    visionEndpoint: z.string().max(2_048),
    visionModelId: z.string().max(200),
  })
  .strict();

export const assistantReasoningEffortSchema = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

export const assistantRoutingSelectionSchema = z
  .object({
    routeKey: id,
    modelKey: id.nullable(),
    reasoningEffort: assistantReasoningEffortSchema.nullable(),
  })
  .strict();

export const assistantRoutingSaveSchema = z
  .object({
    selections: z
      .object({
        directions: assistantRoutingSelectionSchema,
        optimize: assistantRoutingSelectionSchema,
        title: assistantRoutingSelectionSchema,
        subtitleTranslation: assistantRoutingSelectionSchema,
        articleCheck: assistantRoutingSelectionSchema,
      })
      .strict(),
  })
  .strict();

export const externalImageApiExtensionIdSchema = z.enum(EXTERNAL_IMAGE_API_EXTENSION_IDS);

export const externalImageApiSaveSchema = z
  .object({
    extensionId: externalImageApiExtensionIdSchema,
    apiKey: z.string().max(500),
    settings: z.record(z.string().max(100), z.string().max(500)),
  })
  .strict();

export const generationConcurrencySaveSchema = z
  .object({
    modelKey: z.string().min(1).max(512),
    maxConcurrent: z.number().int().min(MIN_IMAGE_GENERATION_MAX_CONCURRENT).max(MAX_IMAGE_GENERATION_MAX_CONCURRENT),
  })
  .strict();
