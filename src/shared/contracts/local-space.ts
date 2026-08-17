import { z } from 'zod';

export const transitionPreviewSchema = z
  .object({
    url: z.string().regex(/^aiy-media:\/\/space-preview\/[A-Za-z0-9_-]+(?:\?[^\s#]*)?$/),
    // Optional for one manifest-2 compatibility window. New producers always
    // provide it; older cached previews keep using `url` for both layers.
    detailUrl: z
      .string()
      .regex(/^aiy-media:\/\/space-preview\/[A-Za-z0-9_-]+(?:\?[^\s#]*)?$/)
      .optional(),
    width: z.number().int().positive().max(32_768),
    height: z.number().int().positive().max(32_768),
  })
  .strict();

export const transitionPreviewListSchema = z.array(transitionPreviewSchema).max(24);

export type TransitionPreviewDto = z.infer<typeof transitionPreviewSchema>;

export const transitionPreviewRefreshEventSchema = z
  .object({
    spaceId: z.string().min(1),
    previews: transitionPreviewListSchema,
  })
  .strict();

export type TransitionPreviewRefreshEvent = z.infer<typeof transitionPreviewRefreshEventSchema>;

export const localSpaceDescriptorSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    coverUrl: z.string().nullable(),
    isCurrent: z.boolean(),
    available: z.boolean(),
    createdAt: z.string().min(1),
    lastOpenedAt: z.string().min(1),
  })
  .strict();

/** A local space is the product-level data and ownership boundary. */
export type LocalSpaceDescriptorDto = z.infer<typeof localSpaceDescriptorSchema>;

export const localSpaceRegistrySchema = z
  .object({
    currentSpaceId: z.string().min(1),
    spaces: z.array(localSpaceDescriptorSchema).max(500),
  })
  .strict();

export type LocalSpaceRegistryDto = z.infer<typeof localSpaceRegistrySchema>;

export const localSpaceSwitchResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('cancelled') }).strict(),
  z.object({ status: z.literal('switched'), space: localSpaceDescriptorSchema }).strict(),
]);

export type LocalSpaceSwitchResult = z.infer<typeof localSpaceSwitchResultSchema>;

export const legacyLocalSpaceCandidateSchema = z
  .object({
    candidateId: z.string().min(1).max(200),
    spaceId: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    createdAt: z.string().min(1),
    lastOpenedAt: z.string().min(1),
    requiresCopy: z.boolean(),
  })
  .strict();

export const legacyLocalSpaceCandidateListSchema = z.array(legacyLocalSpaceCandidateSchema).max(200);
export type LegacyLocalSpaceCandidateDto = z.infer<typeof legacyLocalSpaceCandidateSchema>;

export const localSpaceMigrationErrorCodeSchema = z.enum([
  'MIGRATION_BUSY',
  'SOURCE_UNAVAILABLE',
  'SOURCE_IN_USE',
  'SOURCE_INVALID',
  'DESTINATION_INVALID',
  'DESTINATION_NO_SPACE',
  'COPY_FAILED',
  'VERIFY_FAILED',
]);
export type LocalSpaceMigrationErrorCode = z.infer<typeof localSpaceMigrationErrorCodeSchema>;

export const localSpaceMigrationResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('cancelled') }).strict(),
  z.object({ status: z.literal('switched'), space: localSpaceDescriptorSchema }).strict(),
  z
    .object({
      status: z.literal('failed'),
      errorCode: localSpaceMigrationErrorCodeSchema,
    })
    .strict(),
]);
export type LocalSpaceMigrationResult = z.infer<typeof localSpaceMigrationResultSchema>;

export const localSpaceMigrationProgressEventSchema = z
  .object({
    candidateId: z.string().min(1).max(200),
    stage: z.enum(['PREPARING', 'COPYING', 'VERIFYING', 'REGISTERING', 'COMPLETED']),
    progress: z.number().int().min(0).max(100),
    copiedBytes: z
      .number()
      .int()
      .nonnegative()
      .max(2 * 1024 ** 4),
    totalBytes: z
      .number()
      .int()
      .nonnegative()
      .max(2 * 1024 ** 4),
    copiedFiles: z.number().int().nonnegative().max(250_000),
    totalFiles: z.number().int().nonnegative().max(250_000),
  })
  .strict();

export type LocalSpaceMigrationProgressEvent = z.infer<typeof localSpaceMigrationProgressEventSchema>;

export const localSpaceTransferErrorCodeSchema = z.enum([
  'TRANSFER_BUSY',
  'SOURCE_UNAVAILABLE',
  'SOURCE_IN_USE',
  'SOURCE_INVALID',
  'DESTINATION_INVALID',
  'DESTINATION_NO_SPACE',
  'ARCHIVE_INVALID',
  'ARCHIVE_UNSUPPORTED',
  'SPACE_ID_CONFLICT',
  'WRITE_FAILED',
  'VERIFY_FAILED',
]);
export type LocalSpaceTransferErrorCode = z.infer<typeof localSpaceTransferErrorCodeSchema>;

const localSpaceTransferFailureSchema = z
  .object({
    status: z.literal('failed'),
    errorCode: localSpaceTransferErrorCodeSchema,
  })
  .strict();

export const localSpaceExportResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('cancelled') }).strict(),
  z
    .object({
      status: z.literal('exported'),
      fileName: z.string().min(1).max(255),
      byteSize: z
        .number()
        .int()
        .positive()
        .max(3 * 1024 ** 4),
    })
    .strict(),
  localSpaceTransferFailureSchema,
]);
export type LocalSpaceExportResult = z.infer<typeof localSpaceExportResultSchema>;

export const localSpaceImportResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('cancelled') }).strict(),
  z.object({ status: z.literal('switched'), space: localSpaceDescriptorSchema }).strict(),
  localSpaceTransferFailureSchema,
]);
export type LocalSpaceImportResult = z.infer<typeof localSpaceImportResultSchema>;

export const localSpaceTransferProgressEventSchema = z
  .object({
    operation: z.enum(['EXPORT', 'IMPORT']),
    stage: z.enum(['PREPARING', 'SNAPSHOTTING', 'WRITING', 'READING', 'VERIFYING', 'REGISTERING', 'COMPLETED']),
    progress: z.number().int().min(0).max(100),
    processedBytes: z
      .number()
      .int()
      .nonnegative()
      .max(3 * 1024 ** 4),
    totalBytes: z
      .number()
      .int()
      .nonnegative()
      .max(3 * 1024 ** 4),
    processedFiles: z.number().int().nonnegative().max(250_000),
    totalFiles: z.number().int().nonnegative().max(250_000),
  })
  .strict();
export type LocalSpaceTransferProgressEvent = z.infer<typeof localSpaceTransferProgressEventSchema>;

export type LocalSpaceCoverUpdateResult =
  { status: 'cancelled' } | { status: 'updated'; space: LocalSpaceDescriptorDto };

export const localSpaceTransitionStageSchema = z.enum([
  'PREPARING',
  'OPENING_DATABASE',
  'CONNECTING_SERVICES',
  'LOADING_EXTENSIONS',
  'APPLYING_SETTINGS',
  'ACTIVATING',
  'LOADING_INTERFACE',
  'READY',
  'FAILED',
]);

export type LocalSpaceTransitionStage = z.infer<typeof localSpaceTransitionStageSchema>;

export const localSpaceTransitionEventSchema = z
  .object({
    phase: z.enum(['STARTING', 'PROGRESS', 'COMPLETED', 'FAILED']),
    stage: localSpaceTransitionStageSchema,
    /** Milestone progress reported by completed switch work, from 0 to 100. */
    progress: z.number().int().min(0).max(100),
    space: localSpaceDescriptorSchema,
    /** Small, cached images used only by transition scenes. */
    previews: transitionPreviewListSchema,
  })
  .strict();

export type LocalSpaceTransitionEvent = z.infer<typeof localSpaceTransitionEventSchema>;
