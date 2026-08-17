import { z } from 'zod';
import { videoDocumentNoteSchema, videoDocumentNotesContentSchema } from '@/shared/contracts/video-document-notes';
import { createVideoDocumentRichNoteSchemas } from '@/shared/contracts/video-document-rich-note';
import { videoDocumentTimedTranscriptContentSchema } from '@/shared/contracts/video-document-transcript-content';

export { videoDocumentNoteSchema, videoDocumentNotesContentSchema } from '@/shared/contracts/video-document-notes';
export {
  VIDEO_DOCUMENT_TRANSCRIPT_MAX_LOCALIZATIONS,
  videoDocumentTimedTranscriptContentSchema,
  videoDocumentTranscriptCueLocalizationSchema,
  videoDocumentTranscriptCueSchema,
} from '@/shared/contracts/video-document-transcript-content';
export type {
  VideoDocumentTimedTranscriptContent,
  VideoDocumentTranscriptCue,
  VideoDocumentTranscriptCueLocalization,
} from '@/shared/contracts/video-document-transcript-content';

export const VIDEO_DOCUMENT_SOURCE_REPLACEMENT_MAX_DURATION_DELTA_MS = 1_000;

export const videoDocumentStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);
export const videoDocumentBranchRoleSchema = z.enum([
  'CLEAN_TRANSCRIPT',
  'ARTICLE',
  'NOTES',
  'STORY_NO_SPOILER',
  'STORY_SPOILER',
]);
export const videoDocumentBranchStatusSchema = z.enum([
  'EMPTY',
  'PROCESSING',
  'PARTIAL',
  'EDITABLE',
  'CONFIRMED',
  'FAILED',
]);
export const videoDocumentRevisionOriginSchema = z.enum(['SYSTEM', 'AGENT', 'HUMAN']);
export const videoDocumentTranscriptBasisSchema = z.enum([
  'AUDIO_TRANSCRIPT',
  'EXTERNAL_SUBTITLES',
  'EMBEDDED_SUBTITLES',
  'ON_SCREEN_TEXT',
  'NONE',
]);
export const videoDocumentSegmentTypeSchema = z.enum([
  'CONCEPT',
  'PROCEDURE',
  'ARGUMENT',
  'NARRATIVE',
  'EVENT',
  'PERFORMANCE',
  'CONVERSATION',
  'EXPLORATION',
  'ORIGINAL_LED',
]);
export const videoDocumentAudioStatusSchema = z.enum(['HAS_AUDIO', 'NO_AUDIO', 'DETECTION_FAILED']);
export const videoDocumentAudioInfoSchema = z
  .object({
    status: videoDocumentAudioStatusSchema,
    trackCount: z.number().int().nonnegative(),
    primaryCodec: z.string().trim().min(1).max(100).nullable(),
    detectedAt: z.string().min(1).max(100).nullable(),
    errorCode: z.string().trim().min(1).max(100).nullable(),
  })
  .strict()
  .superRefine((audio, context) => {
    if (audio.status === 'HAS_AUDIO' && audio.trackCount === 0) {
      context.addIssue({ code: 'custom', message: 'Audio tracks are required for HAS_AUDIO', path: ['trackCount'] });
    }
    if (audio.status === 'NO_AUDIO' && audio.trackCount !== 0) {
      context.addIssue({ code: 'custom', message: 'NO_AUDIO cannot report tracks', path: ['trackCount'] });
    }
    if (audio.status !== 'DETECTION_FAILED' && audio.errorCode !== null) {
      context.addIssue({
        code: 'custom',
        message: 'Only failed detection can have an error code',
        path: ['errorCode'],
      });
    }
  });

export const localQwenAsrProviderKeySchema = z.literal('qwen-local');
export const localQwenAsrSidecarStatusSchema = z.enum(['NOT_INSTALLED', 'STOPPED', 'STARTING', 'READY', 'ERROR']);
export const localQwenAsrSidecarErrorCodeSchema = z.enum([
  'UNSUPPORTED_PLATFORM',
  'WSL_UNAVAILABLE',
  'DISTRIBUTION_UNAVAILABLE',
  'RUNTIME_NOT_INSTALLED',
  'MODEL_NOT_INSTALLED',
  'PORT_UNAVAILABLE',
  'START_FAILED',
  'HEALTH_CHECK_FAILED',
  'STOP_FAILED',
  'UNKNOWN',
]);
export const localQwenAsrGpuTelemetrySchema = z
  .object({
    sampledAt: z.string().datetime(),
    gpuIndex: z.number().int().nonnegative(),
    utilizationPercent: z.number().finite().min(0).max(100),
    memoryUsedMiB: z.number().finite().nonnegative(),
    memoryTotalMiB: z.number().finite().positive(),
    powerWatts: z.number().finite().nonnegative().max(5_000).nullable(),
  })
  .strict()
  .superRefine((telemetry, context) => {
    if (telemetry.memoryUsedMiB > telemetry.memoryTotalMiB) {
      context.addIssue({
        code: 'custom',
        message: 'Used GPU memory cannot exceed total GPU memory',
        path: ['memoryUsedMiB'],
      });
    }
  });
export const localQwenAsrSidecarSchema = z
  .object({
    providerKey: localQwenAsrProviderKeySchema,
    status: localQwenAsrSidecarStatusSchema,
    modelId: z.literal('Qwen/Qwen3-ASR-0.6B'),
    errorCode: localQwenAsrSidecarErrorCodeSchema.nullable(),
    telemetry: localQwenAsrGpuTelemetrySchema.nullable(),
  })
  .strict();
export const videoDocumentGenerationStatusSchema = z.enum([
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'INTERRUPTED',
  'BLOCKED',
  'NOT_STARTED',
]);
export const videoDocumentTokenAvailabilitySchema = z.enum(['PROVIDED', 'MISSING', 'NOT_STARTED']);

export const videoDocumentGenerationErrorDetailsSchema = z
  .object({
    code: z.string().trim().min(1).max(100),
    retryable: z.boolean(),
    resetAt: z.string().min(1).max(100).nullable(),
    diagnostic: z.string().trim().min(1).max(2_000).nullable(),
  })
  .strict();

export const videoDocumentTokenUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().nullable(),
    cachedInputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    reasoningOutputTokens: z.number().int().nonnegative().nullable(),
    totalTokens: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const videoDocumentGenerationReceiptSchema = z
  .object({
    runId: z.string().min(1).max(200),
    providerKey: z.literal('codex'),
    requestedModel: z.string().min(1).max(200),
    actualModel: z.string().min(1).max(200).nullable(),
    reasoningEffort: z.literal('max'),
    promptProfileId: z.string().min(1).max(200).optional(),
    transcriptRevisionId: z.string().min(1).max(200).nullable().optional(),
    usageAvailability: videoDocumentTokenAvailabilitySchema.exclude(['NOT_STARTED']),
    usage: videoDocumentTokenUsageSchema.nullable(),
    startedAt: z.string().min(1).max(100),
    finishedAt: z.string().min(1).max(100),
  })
  .strict();

const videoDocumentMediaPathSchema = z
  .string()
  .min(1)
  .max(300)
  .refine(
    (value) =>
      value.startsWith('assets/') &&
      !value.includes('\\') &&
      !value.split('/').some((segment) => !segment || segment === '.' || segment === '..'),
    'Document media paths must be safe relative asset paths',
  );

export const videoDocumentMediaBindingSchema = z
  .object({
    path: videoDocumentMediaPathSchema,
    assetId: z.string().min(1).max(200),
    kind: z.enum(['IMAGE', 'VIDEO']),
    timestampMs: z.number().int().nonnegative().nullable(),
    endTimestampMs: z.number().int().nonnegative().nullable(),
    posterAssetId: z.string().min(1).max(200).nullable(),
  })
  .strict()
  .superRefine((binding, context) => {
    if (binding.endTimestampMs !== null && binding.timestampMs === null) {
      context.addIssue({ code: 'custom', message: 'A media end time requires a start time', path: ['endTimestampMs'] });
    }
    if (
      binding.timestampMs !== null &&
      binding.endTimestampMs !== null &&
      binding.endTimestampMs < binding.timestampMs
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A media end time cannot precede its start time',
        path: ['endTimestampMs'],
      });
    }
    if (binding.kind === 'IMAGE' && binding.posterAssetId !== null) {
      context.addIssue({ code: 'custom', message: 'Only video media can bind a poster', path: ['posterAssetId'] });
    }
  });

export const videoDocumentTimelineSegmentSchema = z
  .object({
    id: z.string().min(1).max(200),
    title: z.string().trim().min(1).max(300),
    segmentType: videoDocumentSegmentTypeSchema,
    startTimestampMs: z.number().int().nonnegative(),
    endTimestampMs: z.number().int().nonnegative(),
    confidence: z.number().min(0).max(1),
    startCueSourceIndex: z.number().int().positive().nullable(),
    endCueSourceIndex: z.number().int().positive().nullable(),
    directQuoteCueSourceIndexes: z.array(z.number().int().positive()).max(2).optional(),
  })
  .strict()
  .superRefine((segment, context) => {
    if (segment.endTimestampMs < segment.startTimestampMs) {
      context.addIssue({
        code: 'custom',
        message: 'A timeline segment cannot end before it starts',
        path: ['endTimestampMs'],
      });
    }
    if ((segment.startCueSourceIndex === null) !== (segment.endCueSourceIndex === null)) {
      context.addIssue({
        code: 'custom',
        message: 'A transcript range requires both cue indexes',
        path: ['startCueSourceIndex'],
      });
    }
    if (
      segment.startCueSourceIndex !== null &&
      segment.endCueSourceIndex !== null &&
      segment.endCueSourceIndex < segment.startCueSourceIndex
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A transcript range cannot be reversed',
        path: ['endCueSourceIndex'],
      });
    }
    const directQuoteIndexes = segment.directQuoteCueSourceIndexes ?? [];
    if (new Set(directQuoteIndexes).size !== directQuoteIndexes.length) {
      context.addIssue({
        code: 'custom',
        message: 'Direct quote cue indexes must be unique',
        path: ['directQuoteCueSourceIndexes'],
      });
    }
    if (
      directQuoteIndexes.some(
        (sourceIndex) =>
          segment.startCueSourceIndex === null ||
          segment.endCueSourceIndex === null ||
          sourceIndex < segment.startCueSourceIndex ||
          sourceIndex > segment.endCueSourceIndex,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A direct quote must belong to the segment transcript range',
        path: ['directQuoteCueSourceIndexes'],
      });
    }
  });

export const videoDocumentMarkdownRevisionContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    format: z.literal('MARKDOWN'),
    markdown: z.string().min(1).max(500_000),
    transcriptBasis: videoDocumentTranscriptBasisSchema,
    sourceUrl: z
      .string()
      .url()
      .max(2_000)
      .refine((value) => new URL(value).protocol === 'https:', 'Document source URLs must use HTTPS')
      .nullable(),
    generation: videoDocumentGenerationReceiptSchema.nullable().optional(),
    mediaBindings: z.array(videoDocumentMediaBindingSchema).max(200),
    // Video documents first ship with timeline support. Optionality only
    // preserves drafts created by unreleased development builds.
    timelineSegments: z.array(videoDocumentTimelineSegmentSchema).max(500).optional(),
  })
  .strict()
  .superRefine((content, context) => {
    const paths = new Set<string>();
    for (const [index, binding] of content.mediaBindings.entries()) {
      if (paths.has(binding.path)) {
        context.addIssue({
          code: 'custom',
          message: 'Document media paths must be unique',
          path: ['mediaBindings', index, 'path'],
        });
      }
      paths.add(binding.path);
    }
    let previousStartTimestampMs = -1;
    for (const [index, segment] of (content.timelineSegments ?? []).entries()) {
      if (segment.startTimestampMs < previousStartTimestampMs) {
        context.addIssue({
          code: 'custom',
          message: 'Timeline segments must be ordered by start time',
          path: ['timelineSegments', index, 'startTimestampMs'],
        });
      }
      previousStartTimestampMs = segment.startTimestampMs;
    }
  });

const richNoteSchemas = createVideoDocumentRichNoteSchemas({
  transcriptBasis: videoDocumentTranscriptBasisSchema,
  generationReceipt: videoDocumentGenerationReceiptSchema,
  mediaBinding: videoDocumentMediaBindingSchema,
  timelineSegment: videoDocumentTimelineSegmentSchema,
});
export const videoDocumentRichNoteSchema = richNoteSchemas.richNote;
export const videoDocumentNoteCollectionContentSchema = richNoteSchemas.collection;

export const videoDocumentRevisionContentSchema = z.union([
  videoDocumentMarkdownRevisionContentSchema,
  videoDocumentNoteCollectionContentSchema,
  videoDocumentTimedTranscriptContentSchema,
  videoDocumentNotesContentSchema,
]);

export const videoDocumentFrameCaptureInputSchema = z
  .object({
    documentId: z.string().min(1).max(200),
    timestampMs: z.number().int().nonnegative(),
  })
  .strict();

export const videoDocumentRevisionMediaSchema = z
  .object({
    assetId: z.string().min(1).max(200),
    mediaUrl: z.string().min(1).max(1_000),
    mimeType: z.enum([
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
      'video/mp4',
      'video/webm',
      'video/quicktime',
    ]),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    byteSize: z.number().int().positive(),
    durationMs: z.number().int().positive().nullable(),
  })
  .strict();

export const videoDocumentFrameCaptureResultSchema = z
  .object({
    binding: videoDocumentMediaBindingSchema,
    media: videoDocumentRevisionMediaSchema,
  })
  .strict();

export const videoDocumentRevisionSchema = z
  .object({
    id: z.string().min(1).max(200),
    branchId: z.string().min(1).max(200),
    draftId: z.string().min(1).max(200),
    parentRevisionId: z.string().min(1).max(200).nullable(),
    revisionNo: z.number().int().positive(),
    content: videoDocumentRevisionContentSchema,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    origin: videoDocumentRevisionOriginSchema,
    media: z.array(videoDocumentRevisionMediaSchema).max(400),
    createdAt: z.string().min(1).max(100),
  })
  .strict();

export const videoDocumentRevisionSaveInputSchema = z
  .object({
    branchId: z.string().min(1).max(200),
    expectedParentRevisionId: z.string().min(1).max(200).nullable(),
    content: videoDocumentRevisionContentSchema,
  })
  .strict();

export const videoDocumentTranscriptRecognitionErrorCodeSchema = z.enum([
  'NO_AUDIO',
  'SOURCE_UNAVAILABLE',
  'INPUT_TOO_LONG',
  'LOCAL_SERVICE_NOT_CONFIGURED',
  'LOCAL_SERVICE_UNAVAILABLE',
  'LOCAL_MODEL_BUSY',
  'FFMPEG_UNAVAILABLE',
  'AUDIO_EXTRACTION_FAILED',
  'AUTH_REJECTED',
  'MODEL_UNAVAILABLE',
  'RESPONSE_INVALID',
  'NO_SPEECH',
  'DOCUMENT_CHANGED',
  'CANCELLED',
  'UNKNOWN',
]);

export const videoDocumentTranscriptRecognitionOperationIdSchema = z.string().uuid();

export const videoDocumentTranscriptRecognizeInputSchema = z
  .object({
    operationId: videoDocumentTranscriptRecognitionOperationIdSchema,
    documentId: z.string().min(1).max(200),
    providerKey: localQwenAsrProviderKeySchema,
  })
  .strict();

export const videoDocumentTranscriptRecognitionProgressSchema = z
  .object({
    operationId: videoDocumentTranscriptRecognitionOperationIdSchema,
    documentId: z.string().min(1).max(200),
    completedChunks: z.number().int().nonnegative(),
    totalChunks: z.number().int().positive(),
  })
  .strict()
  .superRefine((progress, context) => {
    if (progress.completedChunks > progress.totalChunks) {
      context.addIssue({
        code: 'custom',
        message: 'Completed transcript chunks cannot exceed the total',
        path: ['completedChunks'],
      });
    }
  });

export const videoDocumentTranscriptRecognitionResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('succeeded'),
      revision: videoDocumentRevisionSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal('failed'),
      code: videoDocumentTranscriptRecognitionErrorCodeSchema,
      retryable: z.boolean(),
    })
    .strict(),
]);

export const videoDocumentTranscriptRecognitionCancelResultSchema = z.undefined();

export const videoDocumentGenerationRunSchema = z
  .object({
    id: z.string().min(1).max(200),
    documentId: z.string().min(1).max(200),
    branchId: z.string().min(1).max(200),
    status: videoDocumentGenerationStatusSchema,
    inputRevisionId: z.string().min(1).max(200).nullable(),
    outputRevisionId: z.string().min(1).max(200).nullable(),
    providerKey: z.literal('codex'),
    requestedModel: z.string().min(1).max(200),
    actualModel: z.string().min(1).max(200).nullable(),
    reasoningEffort: z.literal('max'),
    usageAvailability: videoDocumentTokenAvailabilitySchema,
    usage: videoDocumentTokenUsageSchema.nullable(),
    errorCode: z.string().min(1).max(100).nullable(),
    errorDetails: videoDocumentGenerationErrorDetailsSchema.nullable(),
    startedAt: z.string().min(1).max(100),
    finishedAt: z.string().min(1).max(100).nullable(),
  })
  .strict();

export const videoDocumentArticleGenerateInputSchema = z
  .object({
    documentId: z.string().min(1).max(200),
    noteId: z.string().min(1).max(200).nullable().optional(),
  })
  .strict();

export const videoDocumentAudioProbeInputSchema = z
  .object({
    documentId: z.string().min(1).max(200),
    force: z.boolean().default(false),
  })
  .strict();

export const videoDocumentArticleGenerateResultSchema = z
  .object({
    run: videoDocumentGenerationRunSchema,
    revision: videoDocumentRevisionSchema.nullable(),
  })
  .strict();

export const videoDocumentGenerationRunsListInputSchema = z
  .object({
    documentId: z.string().min(1).max(200),
    cursor: z.string().max(1_000).nullable().default(null),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();

export const videoDocumentGenerationRunsPageSchema = z
  .object({
    items: z.array(videoDocumentGenerationRunSchema),
    nextCursor: z.string().max(1_000).nullable(),
  })
  .strict();

export const videoDocumentExportFormatSchema = z.enum(['MARKDOWN', 'DOCX']);

export const videoDocumentExportInputSchema = z
  .object({
    documentId: z.string().min(1).max(200),
    branchId: z.string().min(1).max(200),
    revisionId: z.string().min(1).max(200),
    noteId: z.string().min(1).max(200).nullable().optional(),
    format: videoDocumentExportFormatSchema,
  })
  .strict();

export const videoDocumentExportResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('cancelled'),
    })
    .strict(),
  z
    .object({
      status: z.literal('saved'),
      format: videoDocumentExportFormatSchema,
      fileName: z.string().min(1).max(300),
      outputPath: z.string().min(1).max(4_000),
      outputKind: z.enum(['FILE', 'DIRECTORY']),
    })
    .strict(),
  z
    .object({
      status: z.literal('failed'),
      code: z.enum([
        'FILE_IN_USE',
        'PERMISSION_DENIED',
        'PATH_INVALID',
        'MEDIA_MISSING',
        'DOCUMENT_CHANGED',
        'DOCX_BUILD_FAILED',
        'WRITE_FAILED',
      ]),
      retryable: z.boolean(),
      targetPath: z.string().min(1).max(4_000).nullable(),
      diagnostic: z.string().trim().min(1).max(2_000).nullable(),
    })
    .strict(),
]);

export const videoDocumentRevealExportInputSchema = z
  .object({
    outputPath: z.string().min(1).max(4_000),
  })
  .strict();

export const videoDocumentSourceSchema = z.object({
  relationId: z.string().min(1),
  materialId: z.string().min(1),
  displayName: z.string(),
  available: z.boolean(),
  sourceUrl: z
    .string()
    .url()
    .max(2_000)
    .refine((value) => new URL(value).protocol === 'https:', 'Video source URLs must use HTTPS')
    .nullable(),
  audio: videoDocumentAudioInfoSchema,
  asset: z.object({
    id: z.string().min(1),
    kind: z.enum(['GENERATED', 'REFERENCE']),
    originType: z.string(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
    mimeType: z.string().min(1),
    byteSize: z.number().int().nonnegative(),
    mediaUrl: z.string().min(1),
    createdAt: z.string().min(1),
    mediaKind: z.literal('VIDEO'),
    durationMs: z.number().int().positive(),
  }),
});

export const videoDocumentBranchSchema = z.object({
  id: z.string().min(1),
  role: videoDocumentBranchRoleSchema,
  spoilerLevel: z.enum(['NONE', 'FULL']),
  status: videoDocumentBranchStatusSchema,
  draftId: z.string().min(1),
  latestDraftRevisionId: z.string().min(1).nullable(),
  updatedAt: z.string().min(1),
});

export const videoDocumentSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  titleLocale: z.enum(['zh', 'en']),
  status: videoDocumentStatusSchema,
  albumId: z.string().min(1).nullable(),
  albumTitle: z.string().nullable(),
  thumbnail: z
    .object({
      assetId: z.string().min(1),
      mediaUrl: z.string().min(1),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .strict()
    .nullable(),
  source: videoDocumentSourceSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const videoDocumentNavigationPreviewAssetSchema = z
  .object({
    id: z.string().min(1).max(200),
    kind: z.enum(['GENERATED', 'REFERENCE']),
    originType: z.string().min(1).max(200),
    mediaUrl: z.string().min(1).max(1_000),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    mimeType: z
      .string()
      .min(1)
      .max(200)
      .regex(/^image\//),
    byteSize: z.number().int().nonnegative(),
    createdAt: z.string().min(1).max(100),
  })
  .strict();

export const videoDocumentNavigationEntrySchema = z.discriminatedUnion('kind', [
  z
    .object({
      nodeId: z.string().min(1).max(500),
      kind: z.literal('ALBUM'),
      albumId: z.string().min(1).max(200),
      parentAlbumId: z.string().min(1).max(200).nullable(),
      title: z.string().min(1).max(300),
      sortOrder: z.number().int().nonnegative().nullable(),
      childCount: z.number().int().nonnegative(),
      descendantDocumentCount: z.number().int().nonnegative(),
      previewAssets: z.array(videoDocumentNavigationPreviewAssetSchema).max(4),
    })
    .strict(),
  z
    .object({
      nodeId: z.string().min(1).max(500),
      kind: z.literal('DOCUMENT'),
      documentId: z.string().min(1).max(200),
      parentAlbumId: z.string().min(1).max(200).nullable(),
      sortOrder: z.number().int().nonnegative().nullable(),
      document: videoDocumentSummarySchema,
    })
    .strict(),
]);

export const videoDocumentNavigationListInputSchema = z
  .object({
    parentAlbumId: z.string().min(1).max(200).nullable().default(null),
    cursor: z.string().max(1_000).nullable().default(null),
    limit: z.number().int().min(1).max(50).default(50),
  })
  .strict();

export const videoDocumentNavigationPageSchema = z
  .object({
    items: z.array(videoDocumentNavigationEntrySchema).max(50),
    nextCursor: z.string().max(1_000).nullable(),
  })
  .strict();

export const videoDocumentNavigationReorderInputSchema = z
  .object({
    parentAlbumId: z.string().min(1).max(200).nullable(),
    targets: z
      .array(
        z
          .object({
            kind: z.enum(['ALBUM', 'DOCUMENT']),
            targetId: z.string().min(1).max(200),
          })
          .strict(),
      )
      .max(1_000),
  })
  .strict();

export const videoDocumentSchema = videoDocumentSummarySchema.extend({
  branches: z.array(videoDocumentBranchSchema),
});

export const videoDocumentListInputSchema = z
  .object({
    query: z.string().max(300).default(''),
    albumId: z.string().min(1).nullable().default(null),
    includeDescendants: z.boolean().default(true),
    unfiledOnly: z.boolean().default(false),
    cursor: z.string().max(1000).nullable().default(null),
    limit: z.number().int().min(1).max(100).default(40),
  })
  .strict()
  .refine((value) => !(value.albumId && value.unfiledOnly), {
    message: 'Album and unfiled filters are mutually exclusive',
    path: ['unfiledOnly'],
  });

export const videoDocumentListPageSchema = z.object({
  items: z.array(videoDocumentSummarySchema),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
});

export const videoDocumentCreateInputSchema = z
  .object({
    videoMaterialId: z.string().min(1).max(200),
    title: z.string().max(300).default(''),
    titleLocale: z.enum(['zh', 'en']),
    albumId: z.string().min(1).max(200).nullable().default(null),
  })
  .strict();

export const videoDocumentRenameInputSchema = z
  .object({
    documentId: z.string().min(1).max(200),
    title: z.string().trim().min(1).max(300),
  })
  .strict();

export const videoDocumentMoveInputSchema = z
  .object({
    documentId: z.string().min(1).max(200),
    albumId: z.string().min(1).max(200).nullable(),
  })
  .strict();

export const videoDocumentSourceReplaceInputSchema = z
  .object({
    documentId: z.string().min(1).max(200),
    videoMaterialId: z.string().min(1).max(200),
  })
  .strict();

export type VideoDocumentStatus = z.infer<typeof videoDocumentStatusSchema>;
export type VideoDocumentBranchRole = z.infer<typeof videoDocumentBranchRoleSchema>;
export type VideoDocumentBranchStatus = z.infer<typeof videoDocumentBranchStatusSchema>;
export type VideoDocumentRevisionOrigin = z.infer<typeof videoDocumentRevisionOriginSchema>;
export type VideoDocumentTranscriptBasis = z.infer<typeof videoDocumentTranscriptBasisSchema>;
export type VideoDocumentSegmentType = z.infer<typeof videoDocumentSegmentTypeSchema>;
export type VideoDocumentAudioStatus = z.infer<typeof videoDocumentAudioStatusSchema>;
export type VideoDocumentAudioInfo = z.infer<typeof videoDocumentAudioInfoSchema>;
export type LocalQwenAsrProviderKey = z.infer<typeof localQwenAsrProviderKeySchema>;
export type LocalQwenAsrSidecarStatus = z.infer<typeof localQwenAsrSidecarStatusSchema>;
export type LocalQwenAsrSidecarErrorCode = z.infer<typeof localQwenAsrSidecarErrorCodeSchema>;
export type LocalQwenAsrGpuTelemetry = z.infer<typeof localQwenAsrGpuTelemetrySchema>;
export type LocalQwenAsrSidecarDto = z.infer<typeof localQwenAsrSidecarSchema>;
export type VideoDocumentTimelineSegment = z.infer<typeof videoDocumentTimelineSegmentSchema>;
export type VideoDocumentTokenUsage = z.infer<typeof videoDocumentTokenUsageSchema>;
export type VideoDocumentTokenAvailability = z.infer<typeof videoDocumentTokenAvailabilitySchema>;
export type VideoDocumentGenerationErrorDetails = z.infer<typeof videoDocumentGenerationErrorDetailsSchema>;
export type VideoDocumentGenerationReceipt = z.infer<typeof videoDocumentGenerationReceiptSchema>;
export type VideoDocumentGenerationRunDto = z.infer<typeof videoDocumentGenerationRunSchema>;
export type VideoDocumentMediaBinding = z.infer<typeof videoDocumentMediaBindingSchema>;
export type VideoDocumentRichNote = z.infer<typeof videoDocumentRichNoteSchema>;
export type VideoDocumentNoteCollectionContent = z.infer<typeof videoDocumentNoteCollectionContentSchema>;
export type VideoDocumentNote = z.infer<typeof videoDocumentNoteSchema>;
export type VideoDocumentNotesContent = z.infer<typeof videoDocumentNotesContentSchema>;
export type VideoDocumentRevisionContent = z.infer<typeof videoDocumentRevisionContentSchema>;
export type VideoDocumentRevisionMediaDto = z.infer<typeof videoDocumentRevisionMediaSchema>;
export type VideoDocumentRevisionDto = z.infer<typeof videoDocumentRevisionSchema>;
export type VideoDocumentRevisionSaveInput = z.infer<typeof videoDocumentRevisionSaveInputSchema>;
export type VideoDocumentFrameCaptureInput = z.infer<typeof videoDocumentFrameCaptureInputSchema>;
export type VideoDocumentFrameCaptureResult = z.infer<typeof videoDocumentFrameCaptureResultSchema>;
export type VideoDocumentTranscriptRecognitionErrorCode = z.infer<
  typeof videoDocumentTranscriptRecognitionErrorCodeSchema
>;
export type VideoDocumentTranscriptRecognizeInput = z.infer<typeof videoDocumentTranscriptRecognizeInputSchema>;
export type VideoDocumentTranscriptRecognitionProgress = z.infer<
  typeof videoDocumentTranscriptRecognitionProgressSchema
>;
export type VideoDocumentTranscriptRecognitionResult = z.infer<typeof videoDocumentTranscriptRecognitionResultSchema>;
export type VideoDocumentSourceDto = z.infer<typeof videoDocumentSourceSchema>;
export type VideoDocumentBranchDto = z.infer<typeof videoDocumentBranchSchema>;
export type VideoDocumentSummaryDto = z.infer<typeof videoDocumentSummarySchema>;
export type VideoDocumentDto = z.infer<typeof videoDocumentSchema>;
export type VideoDocumentListInput = z.input<typeof videoDocumentListInputSchema>;
export type VideoDocumentListPageDto = z.infer<typeof videoDocumentListPageSchema>;
export type VideoDocumentNavigationEntry = z.infer<typeof videoDocumentNavigationEntrySchema>;
export type VideoDocumentNavigationListInput = z.input<typeof videoDocumentNavigationListInputSchema>;
export type VideoDocumentNavigationPage = z.infer<typeof videoDocumentNavigationPageSchema>;
export type VideoDocumentNavigationReorderInput = z.infer<typeof videoDocumentNavigationReorderInputSchema>;
export type VideoDocumentCreateInput = z.input<typeof videoDocumentCreateInputSchema>;
export type VideoDocumentRenameInput = z.input<typeof videoDocumentRenameInputSchema>;
export type VideoDocumentMoveInput = z.input<typeof videoDocumentMoveInputSchema>;
export type VideoDocumentSourceReplaceInput = z.input<typeof videoDocumentSourceReplaceInputSchema>;
export type VideoDocumentArticleGenerateInput = z.infer<typeof videoDocumentArticleGenerateInputSchema>;
export type VideoDocumentAudioProbeInput = z.input<typeof videoDocumentAudioProbeInputSchema>;
export type VideoDocumentArticleGenerateResult = z.infer<typeof videoDocumentArticleGenerateResultSchema>;
export type VideoDocumentGenerationRunsListInput = z.input<typeof videoDocumentGenerationRunsListInputSchema>;
export type VideoDocumentGenerationRunsPage = z.infer<typeof videoDocumentGenerationRunsPageSchema>;
export type VideoDocumentExportFormat = z.infer<typeof videoDocumentExportFormatSchema>;
export type VideoDocumentExportInput = z.infer<typeof videoDocumentExportInputSchema>;
export type VideoDocumentExportResult = z.infer<typeof videoDocumentExportResultSchema>;
export type VideoDocumentRevealExportInput = z.infer<typeof videoDocumentRevealExportInputSchema>;
