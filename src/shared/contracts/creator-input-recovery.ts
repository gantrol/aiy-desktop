import { z } from 'zod';
import { creationDraftDtoSchema } from '@/shared/contracts/creation-draft';

const id = z.string().min(1).max(200);
export const CREATOR_INPUT_RECOVERY_MAX_BYTES = 2 * 1024 * 1024;
export const creatorInputRecoveryScopeSchema = z.object({ spaceId: id, seriesId: id, versionId: id }).strict();
export const creatorInputRecoverySnapshotSchema = creationDraftDtoSchema
  .pick({
    title: true,
    document: true,
    promptNodes: true,
    referenceAssets: true,
    videoAttachments: true,
    termPromptLocale: true,
    termIds: true,
    wordPaletteReferences: true,
    dictionaryScope: true,
    canvasPresetKey: true,
  })
  .extend({
    schemaVersion: z.literal(1),
    manualPrompt: creationDraftDtoSchema.shape.text,
    resolvedPrompt: z.string().max(30_000),
    referenceAssetIds: z.array(id).max(100),
    videoMaterialIds: z.array(id).max(8).optional(),
    generationTargets: creationDraftDtoSchema.shape.modelTargets,
  })
  .strict();
export const creatorInputRecoveryRecordSchema = creatorInputRecoveryScopeSchema
  .extend({
    schemaVersion: z.literal(1),
    revision: id,
    snapshot: creatorInputRecoverySnapshotSchema.nullable(),
  })
  .strict();
export const creatorInputRecoverySaveSchema = creatorInputRecoveryRecordSchema
  .extend({
    expectedRevision: id.nullable(),
  })
  .strict();
export const creatorInputRecoverySaveResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('saved'), record: creatorInputRecoveryRecordSchema }).strict(),
  z.object({ status: z.literal('conflict'), record: creatorInputRecoveryRecordSchema.nullable() }).strict(),
]);
export type CreatorInputRecoveryScope = z.infer<typeof creatorInputRecoveryScopeSchema>;
export type CreatorInputRecoverySnapshot = z.infer<typeof creatorInputRecoverySnapshotSchema>;
export type CreatorInputRecoveryRecord = z.infer<typeof creatorInputRecoveryRecordSchema>;
export type CreatorInputRecoverySave = z.infer<typeof creatorInputRecoverySaveSchema>;
export type CreatorInputRecoverySaveResult = z.infer<typeof creatorInputRecoverySaveResultSchema>;

export interface CreatorInputRecoveryApi {
  creatorInputRecoveryLoad(scope: CreatorInputRecoveryScope): Promise<CreatorInputRecoveryRecord | null>;
  creatorInputRecoverySave(input: CreatorInputRecoverySave): Promise<CreatorInputRecoverySaveResult>;
}
