import { z } from 'zod';
import { browserCompanionStageResultSchema } from '@/shared/contracts/browser-companion';

export const AIY_AGENT_PROTOCOL_VERSION = 1 as const;

const protocolVersionSchema = z.literal(AIY_AGENT_PROTOCOL_VERSION);
const requestIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9._:-]+$/);
const identifierSchema = z.string().min(1).max(200);
const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const imageMimeTypeSchema = z.enum(['image/png', 'image/jpeg', 'image/webp']);
const referenceRoleSchema = z.string().trim().min(1).max(200);

export const agentAssetImportRequestSchema = z
  .object({
    protocolVersion: protocolVersionSchema,
    requestId: requestIdSchema,
    path: z.string().min(1).max(32_768),
  })
  .strict();

export const agentAssetDescriptorSchema = z
  .object({
    assetId: identifierSchema,
    objectHash: contentHashSchema,
    mimeType: imageMimeTypeSchema,
    width: z.number().int().positive().max(32_768),
    height: z.number().int().positive().max(32_768),
    byteSize: z
      .number()
      .int()
      .positive()
      .max(64 * 1024 * 1024),
  })
  .strict();

export const agentAssetImportResultSchema = z
  .object({
    requestId: requestIdSchema,
    reused: z.boolean(),
    asset: agentAssetDescriptorSchema,
  })
  .strict();

const agentDraftReferenceInputSchema = z
  .object({
    assetId: identifierSchema,
    role: referenceRoleSchema,
  })
  .strict();

const nullableCanvasDimensionSchema = z.number().int().min(256).max(4_096).nullable();

export const agentDraftPrepareRequestSchema = z
  .object({
    protocolVersion: protocolVersionSchema,
    requestId: requestIdSchema,
    title: z.string().trim().max(300).default(''),
    titleLocale: z.enum(['zh', 'en']).default('zh'),
    prompt: z.string().trim().min(1).max(30_000),
    modelKey: identifierSchema,
    quality: z.enum(['low', 'medium', 'high']),
    count: z.number().int().min(1).max(8).default(1),
    canvasPresetKey: z.string().trim().min(1).max(100).nullable().default(null),
    width: nullableCanvasDimensionSchema.default(null),
    height: nullableCanvasDimensionSchema.default(null),
    references: z.array(agentDraftReferenceInputSchema).max(8).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.width === null) !== (value.height === null)) {
      context.addIssue({
        code: 'custom',
        path: ['width'],
        message: 'Canvas width and height must both be set or both be omitted',
      });
    }
    if (value.canvasPresetKey !== null && value.width === null) {
      context.addIssue({
        code: 'custom',
        path: ['canvasPresetKey'],
        message: 'A canvas preset requires width and height',
      });
    }
    const assetIds = value.references.map((reference) => reference.assetId);
    if (new Set(assetIds).size !== assetIds.length) {
      context.addIssue({ code: 'custom', path: ['references'], message: 'Reference assets must be unique' });
    }
  });

export const agentDraftReferenceSchema = agentDraftReferenceInputSchema.extend({
  asset: agentAssetDescriptorSchema,
});

export const agentGenerationDraftSchema = z
  .object({
    title: z.string().max(300),
    titleLocale: z.enum(['zh', 'en']),
    prompt: z.string().min(1).max(30_000),
    effectivePrompt: z.string().min(1).max(30_000),
    modelKey: identifierSchema,
    quality: z.enum(['low', 'medium', 'high']),
    count: z.number().int().min(1).max(8),
    canvasPresetKey: z.string().min(1).max(100).nullable(),
    width: nullableCanvasDimensionSchema,
    height: nullableCanvasDimensionSchema,
    references: z.array(agentDraftReferenceSchema).max(8),
  })
  .strict();

export const agentDraftPrepareResultSchema = z
  .object({
    requestId: requestIdSchema,
    draftId: identifierSchema,
    reused: z.boolean(),
    draft: agentGenerationDraftSchema,
    createdAt: z.string().min(1).max(100),
  })
  .strict();

export const agentGenerationStartRequestSchema = z
  .object({
    protocolVersion: protocolVersionSchema,
    requestId: requestIdSchema,
    draftId: identifierSchema,
  })
  .strict();

export const agentGenerationStartResultSchema = z
  .object({
    requestId: requestIdSchema,
    jobId: identifierSchema,
    draftId: identifierSchema,
    reused: z.boolean(),
    runIds: z.array(identifierSchema).min(1).max(160),
    batchId: identifierSchema.nullable(),
    seriesId: identifierSchema,
    versionId: identifierSchema,
  })
  .strict();

export const agentJobGetRequestSchema = z
  .object({ protocolVersion: protocolVersionSchema, jobId: identifierSchema })
  .strict();

export const agentJobCancelRequestSchema = z
  .object({
    protocolVersion: protocolVersionSchema,
    requestId: requestIdSchema,
    jobId: identifierSchema,
  })
  .strict();

export const agentJobRunSchema = z
  .object({
    runId: identifierSchema,
    status: z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED']),
    phase: z.string().min(1).max(200),
    progress: z.number().min(0).max(1).nullable(),
    errorCode: z.string().max(512).nullable(),
    errorMessage: z.string().max(100_000).nullable(),
    output: agentAssetDescriptorSchema.extend({ absolutePath: z.string().min(1).max(32_768) }).nullable(),
  })
  .strict();

export const agentJobResultSchema = z
  .object({
    jobId: identifierSchema,
    draftId: identifierSchema,
    state: z.enum(['PREPARED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED']),
    progress: z.number().min(0).max(1).nullable(),
    createdAt: z.string().min(1).max(100),
    startedAt: z.string().min(1).max(100).nullable(),
    draft: agentGenerationDraftSchema,
    runs: z.array(agentJobRunSchema).max(160),
  })
  .strict();

export const agentJobCancelResultSchema = z
  .object({
    requestId: requestIdSchema,
    jobId: identifierSchema,
    reused: z.boolean(),
    cancellationRequested: z.boolean(),
  })
  .strict();

export const agentWeiboHandoffRequestSchema = z
  .object({
    protocolVersion: protocolVersionSchema,
    requestId: requestIdSchema,
    jobId: identifierSchema,
    text: z.string().trim().min(1).max(10_000),
  })
  .strict();

export const agentWeiboHandoffResultSchema = browserCompanionStageResultSchema
  .extend({
    requestId: requestIdSchema,
    jobId: identifierSchema,
    reused: z.boolean(),
  })
  .strict();

export type AgentAssetImportRequest = z.infer<typeof agentAssetImportRequestSchema>;
export type AgentAssetDescriptor = z.infer<typeof agentAssetDescriptorSchema>;
export type AgentAssetImportResult = z.infer<typeof agentAssetImportResultSchema>;
export type AgentDraftPrepareRequest = z.infer<typeof agentDraftPrepareRequestSchema>;
export type AgentGenerationDraft = z.infer<typeof agentGenerationDraftSchema>;
export type AgentDraftPrepareResult = z.infer<typeof agentDraftPrepareResultSchema>;
export type AgentGenerationStartRequest = z.infer<typeof agentGenerationStartRequestSchema>;
export type AgentGenerationStartResult = z.infer<typeof agentGenerationStartResultSchema>;
export type AgentJobGetRequest = z.infer<typeof agentJobGetRequestSchema>;
export type AgentJobCancelRequest = z.infer<typeof agentJobCancelRequestSchema>;
export type AgentJobResult = z.infer<typeof agentJobResultSchema>;
export type AgentJobCancelResult = z.infer<typeof agentJobCancelResultSchema>;
export type AgentWeiboHandoffRequest = z.infer<typeof agentWeiboHandoffRequestSchema>;
export type AgentWeiboHandoffResult = z.infer<typeof agentWeiboHandoffResultSchema>;
