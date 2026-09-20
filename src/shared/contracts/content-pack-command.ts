import { z } from 'zod';

const id = z.string().min(1).max(240);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative();
export const contentPackPreviewCommandSchema = z
  .object({
    protocolVersion: z.literal(1),
    spaceId: id,
    path: z.string().min(1).max(32_768),
  })
  .strict();
export const contentPackApplyCommandSchema = contentPackPreviewCommandSchema
  .extend({
    expectedContentHash: hash,
    expectedPackageFingerprint: hash,
  })
  .strict();
export const contentPackPreviewCommandResultSchema = z
  .object({
    blockingConflicts: count.optional(),
    packId: id,
    displayName: z.string(),
    operation: z.enum(['INSTALL', 'UPDATE', 'REINSTALL', 'DOWNGRADE']),
    currentReleaseId: id.nullable(),
    currentVersion: z.string().nullable(),
    targetReleaseId: id,
    targetVersion: z.string(),
    targetContentHash: hash,
    packageFingerprint: hash,
    summary: z
      .object({ added: count, updated: count, removed: count, unchanged: count, localForks: count, conflicts: count })
      .strict(),
    changes: z
      .array(
        z
          .object({
            itemKey: id,
            objectType: z.string(),
            changeKind: z.enum(['ADDED', 'UPDATED', 'REMOVED']),
            localState: z.enum(['FOLLOW_PACK', 'LOCAL_FORK', 'CONFLICT']),
          })
          .strict(),
      )
      .max(500),
    changesTruncated: z.boolean(),
  })
  .strict();
export const contentPackApplyCommandResultSchema = z
  .object({ packId: id, releaseId: id, version: z.string() })
  .strict();
export const contentPackCommandCapabilities = {
  previewCommand: 'pack preview',
  applyCommand: 'pack apply',
  format: 'CONTENT',
  manifest: 'manifest.json',
  requiresPreviewFingerprint: true,
  requiresSpaceId: true,
  creationKinds: ['ARTICLE', 'OUTLINE'],
  creationStructureUpdates: 'REJECT_CONFLICT',
} as const;
export type ContentPackPreviewCommand = z.infer<typeof contentPackPreviewCommandSchema>;
export type ContentPackApplyCommand = z.infer<typeof contentPackApplyCommandSchema>;
