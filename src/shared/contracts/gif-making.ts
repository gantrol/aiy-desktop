import { z } from 'zod';
import type { AssetDto } from '@/shared/contracts';
import type { GifGenerationApi } from '@/shared/contracts/gif-generation';
import {
  gifDocumentPurposeSchema,
  gifMotionDraftSchema,
  type GifDocumentPurpose,
  type GifMotionDraft,
} from '@/shared/contracts/gif-motion-draft';

export const GIF_MAX_FRAMES = 120;
export const GIF_MAX_SOURCE_BYTES = 64 * 1024 * 1024;
export const GIF_MAX_OUTPUT_BYTES = 25 * 1024 * 1024;
export const GIF_MAX_SOURCE_PIXELS = 4096 * 4096;
export const GIF_MAX_CANVAS_PIXELS = 2048 * 2048;
export const GIF_MAX_TOTAL_PIXELS = 256 * 1024 * 1024;
export const gifIdSchema = z.string().min(1).max(200);
export const gifAdoptionTargetSchema = z
  .object({
    visualId: gifIdSchema,
    expectedRevisionId: gifIdSchema,
    title: z.string().max(500),
    intent: z.enum(['SET_COVER', 'REPLACE_INLINE']),
  })
  .strict();
export type GifAdoptionTarget = z.infer<typeof gifAdoptionTargetSchema>;
export const gifWorkspaceStateSchema = z
  .object({
    step: z.enum(['generate', 'review', 'edit']),
    frameId: gifIdSchema.optional(),
    candidateId: gifIdSchema.optional(),
  })
  .strict();
export type GifWorkspaceState = z.infer<typeof gifWorkspaceStateSchema>;
export const gifErrorCodes = [
  'GIF_INVALID',
  'GIF_LIMIT',
  'GIF_ASSET_UNAVAILABLE',
  'GIF_ANIMATED_SOURCE',
  'GIF_CONFLICT',
  'GIF_BUSY',
  'GIF_CANCELLED',
  'GIF_FAILED',
  'GIF_MODEL_UNAVAILABLE',
  'GIF_GENERATION_FAILED',
  'GIF_SHEET_INVALID',
  'GIF_REGION_REQUIRED',
  'GIF_ALIGNMENT_FAILED',
  'GIF_NO_MOTION',
  'GIF_PLAN_REQUIRED',
  'GIF_PLAN_INVALID',
  'GIF_PLANNING_MODEL_UNAVAILABLE',
  'GIF_PLAN_FAILED',
  'GIF_GENERATION_BLOCKED',
  'GIF_GENERATION_NO_OUTPUT',
  'GIF_GENERATION_INVALID_OUTPUT',
] as const;
export type GifErrorCode = (typeof gifErrorCodes)[number];
export function gifErrorCode(reason: unknown): GifErrorCode {
  const message = reason instanceof Error ? reason.message : String(reason);
  return gifErrorCodes.find((code) => message.includes(code)) ?? 'GIF_FAILED';
}

const rect = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
export const gifFrameSchema = z
  .object({
    id: gifIdSchema,
    assetId: gifIdSchema,
    durationMs: z.number().int().min(20).max(60_000).multipleOf(10),
    sourceRect: rect.nullable(),
  })
  .strict();
export const gifManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    motionDocumentId: z.string().uuid().optional(),
    generationId: z.string().uuid().optional(),
    width: z.number().int().min(1).max(2048),
    height: z.number().int().min(1).max(2048),
    fit: z.enum(['CONTAIN', 'COVER']),
    backgroundColor: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .nullable(),
    backgroundAssetId: gifIdSchema.nullable(),
    foreground: z
      .object({
        scale: z.number().min(0.1).max(2),
        x: z.number().min(-1).max(1),
        y: z.number().min(-1).max(1),
      })
      .strict(),
    loop: z.enum(['FOREVER', 'ONCE']),
    playback: z.enum(['FORWARD', 'PING_PONG']),
    frames: z.array(gifFrameSchema).max(GIF_MAX_FRAMES),
  })
  .strict()
  .superRefine((value, context) => {
    const frames = gifPlaybackFrames(value);
    if (
      value.width * value.height > GIF_MAX_CANVAS_PIXELS ||
      value.width * value.height * frames.length > GIF_MAX_TOTAL_PIXELS ||
      new Set(value.frames.map((frame) => frame.id)).size !== value.frames.length
    ) {
      context.addIssue({ code: 'custom', message: 'GIF_LIMIT' });
    }
  });
export type GifManifest = z.infer<typeof gifManifestSchema>;
export type GifFrame = z.infer<typeof gifFrameSchema>;
export function gifPlaybackFrames<T extends { frames: GifFrame[]; playback: 'FORWARD' | 'PING_PONG' }>(manifest: T) {
  return manifest.playback === 'PING_PONG' && manifest.frames.length > 2
    ? [...manifest.frames, ...manifest.frames.slice(1, -1).reverse()]
    : manifest.frames;
}
export function gifAssetIds(manifest: GifManifest) {
  return [
    ...new Set([
      ...manifest.frames.map((frame) => frame.assetId),
      ...(manifest.backgroundAssetId ? [manifest.backgroundAssetId] : []),
    ]),
  ];
}
export const gifSaveSchema = z
  .object({
    id: z.string().uuid(),
    seriesId: gifIdSchema.nullable(),
    title: z.string().trim().max(200),
    expectedRevision: z.number().int().nonnegative(),
    manifest: gifManifestSchema,
    purpose: gifDocumentPurposeSchema.default('GIF'),
    motionDraft: gifMotionDraftSchema.nullable().default(null),
  })
  .strict();
export type GifSaveInput = z.infer<typeof gifSaveSchema>;
export const gifWorkspaceCreateSchema = z
  .object({
    id: z.string().uuid(),
    motionId: z.string().uuid(),
    seriesId: gifIdSchema.nullable(),
    title: z.string().trim().max(200),
    manifest: gifManifestSchema,
    motionManifest: gifManifestSchema,
    motionDraft: gifMotionDraftSchema.nullable(),
    sourceDocumentId: z.string().uuid().optional(),
    targetAlbumId: gifIdSchema.nullable().optional(),
  })
  .strict()
  .refine((input) => input.id !== input.motionId);
export type GifWorkspaceCreateInput = z.infer<typeof gifWorkspaceCreateSchema>;
export interface GifDocument {
  purpose: GifDocumentPurpose;
  motionDraft: GifMotionDraft | null;
  id: string;
  seriesId: string | null;
  title: string;
  revision: number;
  manifest: GifManifest;
  updatedAt: string;
}
export interface GifDocumentDetail {
  workspace?: GifWorkspaceState;
  latestExport?: GifExportResult;
  document: GifDocument;
  assets: AssetDto[];
}
export interface GifWorkspaceDetail {
  editor: GifDocumentDetail;
  motion: GifDocumentDetail;
}
export interface GifDocumentSummary {
  workspace?: GifWorkspaceState;
  seriesId: string | null;
  preview: AssetDto | null;
  purpose: GifDocumentPurpose;
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
}
export const gifExportSchema = z
  .object({
    documentId: z.string().uuid(),
    revision: z.number().int().positive(),
    runId: z.string().uuid(),
  })
  .strict();
export type GifExportInput = z.infer<typeof gifExportSchema>;
export interface GifExportResult {
  runId: string;
  documentId: string;
  revision: number;
  asset: AssetDto;
  durationMs: number;
  frameCount: number;
}
export interface GifProgress {
  runId: string;
  stage: 'PREPARING' | 'PALETTE' | 'ENCODING' | 'VERIFYING' | 'SAVING';
  completed: number;
  total: number;
}
export interface GifMakingApi extends GifGenerationApi {
  gifWorkspaceOpen(documentId: string): Promise<GifWorkspaceDetail>;
  gifWorkspaceCreate(input: GifWorkspaceCreateInput): Promise<GifDocument>;
  gifFramesAsGroup(documentId: string, candidateId: string): Promise<string>;
  gifWorkspaceSave(documentId: string, state: GifWorkspaceState): Promise<void>;
  gifList(seriesId: string | null, purpose?: GifDocumentPurpose): Promise<GifDocumentSummary[]>;
  gifLoad(documentId: string): Promise<GifDocumentDetail>;
  gifFindForAsset(assetId: string, purpose?: GifDocumentPurpose, seriesId?: string | null): Promise<string | null>;
  gifSave(input: GifSaveInput): Promise<GifDocument>;
  gifImport(input: { name: string; bytes: Uint8Array }): Promise<AssetDto>;
  gifExport(input: GifExportInput): Promise<GifExportResult>;
  gifCancel(runId: string): Promise<void>;
  onGifProgress(listener: (progress: GifProgress) => void): () => void;
}

export function newGifManifest(asset?: AssetDto): GifManifest {
  const scale = asset ? Math.min(1, 2048 / Math.max(asset.width, asset.height)) : 1;
  return {
    schemaVersion: 1,
    width: asset ? Math.max(1, Math.round(asset.width * scale)) : 512,
    height: asset ? Math.max(1, Math.round(asset.height * scale)) : 512,
    fit: 'CONTAIN',
    backgroundColor: null,
    backgroundAssetId: null,
    foreground: { scale: 1, x: 0, y: 0 },
    loop: 'FOREVER',
    playback: 'FORWARD',
    frames: asset ? [{ id: crypto.randomUUID(), assetId: asset.id, durationMs: 100, sourceRect: null }] : [],
  };
}
