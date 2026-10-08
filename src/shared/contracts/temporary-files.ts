import { z } from 'zod';

export const TEMPORARY_SCOPE = 'aiy-local-temporary';
export const temporaryFileSummarySchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['NOTE', 'IMAGE']),
  title: z.string(),
  updatedAt: z.string(),
  byteSize: z.number().nonnegative(),
  protected: z.boolean(),
});
export const temporaryFilesSnapshotSchema = z.object({
  limitBytes: z.number().positive(),
  usedBytes: z.number().nonnegative(),
  items: z.array(temporaryFileSummarySchema),
});
export const temporaryFilesCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('list') }).strict(),
  z.object({ kind: z.literal('create'), requestId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('import'), requestId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('clipboard'), requestId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('open'), id: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('discard'), id: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('convert'), id: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('promote'), id: z.string().uuid(), expectedHash: z.string() }).strict(),
  z.object({ kind: z.literal('configure'), limitMiB: z.number().int().min(16).max(16384) }).strict(),
  z.object({ kind: z.literal('cleanup') }).strict(),
]);
export type TemporaryFilesCommand = z.infer<typeof temporaryFilesCommandSchema>;
export type TemporaryFilesSnapshot = z.infer<typeof temporaryFilesSnapshotSchema>;
export type TemporaryFileSummary = z.infer<typeof temporaryFileSummarySchema>;
