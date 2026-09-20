import { z } from 'zod';
import { petalColorSchema, petalIconSchema } from '@/shared/contracts/petal-appearance';
import { PETAL_FLUSH_REASONS } from '@/shared/petal-flush';

const id = z.string().min(1).max(200);
export const petalFlushReportSchema = z
  .object({
    status: z.enum(['unchanged', 'saved', 'recoverable', 'blocked']),
    reason: z.enum(PETAL_FLUSH_REASONS).optional(),
  })
  .strict();
export const petalWorkspaceItemSchema = z
  .object({
    id,
    title: z.string(),
    sourceKind: z.string(),
    color: petalColorSchema,
    icon: petalIconSchema,
    layerId: id,
    layerHidden: z.boolean(),
    placement: z.enum(['unplaced', 'active', 'temporary', 'collected']),
    expanded: z.boolean(),
    windowVisible: z.boolean(),
    provisional: z.boolean(),
    sourceAvailable: z.boolean(),
    lastFlush: z.object({ report: petalFlushReportSchema, checkedAt: z.number() }).nullable(),
  })
  .strict();
export const petalWorkspaceSnapshotSchema = z
  .object({ libraryId: id, items: z.array(petalWorkspaceItemSchema), suspended: z.boolean().default(false) })
  .strict();
export const petalWorkspaceCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('list') }).strict(),
  z.object({ kind: z.literal('open'), id }).strict(),
  z.object({ kind: z.literal('source'), id }).strict(),
  z.object({ kind: z.literal('collect'), ids: z.array(id).min(1).max(200) }).strict(),
]);
export const petalWorkspaceResultSchema = z
  .object({
    completed: z.array(id),
    blocked: z.array(
      z.object({ id, reason: z.enum([...PETAL_FLUSH_REASONS, 'sourceUnavailable', 'hiddenLayer']) }).strict(),
    ),
  })
  .strict();
export const petalAssetFileCommandSchema = z
  .object({ assetId: id, action: z.enum(['copy', 'save-as', 'open', 'reveal']) })
  .strict();
export const petalAssetFileResultSchema = z.object({ status: z.enum(['done', 'saved', 'cancelled']) }).strict();
export type PetalWorkspaceItem = z.infer<typeof petalWorkspaceItemSchema>;
export type PetalWorkspaceSnapshot = z.infer<typeof petalWorkspaceSnapshotSchema>;
export type PetalWorkspaceCommand = z.infer<typeof petalWorkspaceCommandSchema>;
export type PetalWorkspaceResult = z.infer<typeof petalWorkspaceResultSchema>;
export type PetalAssetFileCommand = z.infer<typeof petalAssetFileCommandSchema>;
export type PetalAssetFileResult = z.infer<typeof petalAssetFileResultSchema>;
export interface PetalWorkspaceApi {
  workspace(): Promise<PetalWorkspaceSnapshot>;
  workspaceAction(command: Exclude<PetalWorkspaceCommand, { kind: 'list' }>): Promise<PetalWorkspaceResult>;
  assetFile(command: PetalAssetFileCommand): Promise<PetalAssetFileResult>;
}
