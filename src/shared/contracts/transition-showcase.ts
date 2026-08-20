import { z } from 'zod';

export const TRANSITION_SHOWCASE_EXPORT_IMAGE_LIMIT = 24;
export const TRANSITION_SHOWCASE_EXPORT_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const TRANSITION_SHOWCASE_EXPORT_TOTAL_MAX_BYTES = 64 * 1024 * 1024;
export const TRANSITION_SHOWCASE_EXPORT_IMAGE_SIZE = 1024;

const assetIdSchema = z.string().min(1).max(200);

export const transitionShowcaseExportImageIdsSchema = z
  .array(assetIdSchema)
  .max(TRANSITION_SHOWCASE_EXPORT_IMAGE_LIMIT)
  .superRefine((assetIds, context) => {
    if (new Set(assetIds).size !== assetIds.length) {
      context.addIssue({ code: 'custom', message: 'Transition export asset IDs must be unique' });
    }
  });

export const transitionShowcaseExportImageSnapshotSchema = z
  .object({
    assetId: assetIdSchema,
    pngBytes: z
      .instanceof(Uint8Array)
      .refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= TRANSITION_SHOWCASE_EXPORT_IMAGE_MAX_BYTES),
    width: z.number().int().positive().max(TRANSITION_SHOWCASE_EXPORT_IMAGE_SIZE),
    height: z.number().int().positive().max(TRANSITION_SHOWCASE_EXPORT_IMAGE_SIZE),
  })
  .strict();

export const transitionShowcaseExportImageSnapshotsSchema = z
  .array(transitionShowcaseExportImageSnapshotSchema)
  .max(TRANSITION_SHOWCASE_EXPORT_IMAGE_LIMIT)
  .superRefine((snapshots, context) => {
    const assetIds = new Set(snapshots.map((snapshot) => snapshot.assetId));
    if (assetIds.size !== snapshots.length) {
      context.addIssue({ code: 'custom', message: 'Transition export snapshots must be unique' });
    }
    const totalBytes = snapshots.reduce((total, snapshot) => total + snapshot.pngBytes.byteLength, 0);
    if (totalBytes > TRANSITION_SHOWCASE_EXPORT_TOTAL_MAX_BYTES) {
      context.addIssue({ code: 'custom', message: 'Transition export snapshots exceed the transfer limit' });
    }
  });

export type TransitionShowcaseExportImageSnapshot = z.infer<typeof transitionShowcaseExportImageSnapshotSchema>;
