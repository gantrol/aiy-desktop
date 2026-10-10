import { z } from 'zod';
import { videoSearchCommandSchema } from '@/main/video-search/protocol';
import { contentVectorCommandSchema } from '@/main/image-search/content-protocol';
import { imagePrepareCommandSchema } from '@/main/image-search/input-policy';
import { imageInputFailureSchema, imageIssueInputSchema } from '@/shared/contracts/image-search-issues';
import {
  imageSearchTitleKindSchema,
  imageSearchDeviceSchema,
  imageSearchExecutionSchema,
} from '@/shared/contracts/image-search';

const sourceSchema = z.object({
  id: z.string().min(1).max(200),
  hash: z.string().min(1),
  title: z.string(),
  titleKind: imageSearchTitleKindSchema,
  createdAt: z.string(),
  aliases: z.array(z.string()),
  bytes: z.number().nonnegative(),
  mime: z.string(),
});
export const imageSearchCommandSchema = z.discriminatedUnion('op', [
  videoSearchCommandSchema,
  ...contentVectorCommandSchema.options,
  imagePrepareCommandSchema,
  imageIssueInputSchema.omit({ requestId: true, snapshot: true }).extend({ op: z.literal('issues') }),
  z.object({
    op: z.literal('commit-image'),
    id: z.string(),
    hash: z.string(),
    vector: z.array(z.number().finite()).length(768).nullable(),
    failure: imageInputFailureSchema.optional(),
    limited: z.boolean(),
  }),
  z.object({
    op: z.literal('commit-ocr'),
    id: z.string(),
    hash: z.string(),
    text: z.string().max(250_000).nullable(),
    failure: imageInputFailureSchema.optional(),
    limited: z.boolean(),
  }),
  z.object({ op: z.literal('sync-start') }),
  z.object({ op: z.literal('sync'), items: z.array(sourceSchema).max(128) }),
  z.object({ op: z.literal('sync-finish') }),
  z.object({ op: z.literal('pending') }),
  z.object({
    op: z.literal('index'),
    items: z.array(sourceSchema.pick({ id: true, hash: true }).extend({ path: z.string() })).max(4),
    missing: z.array(sourceSchema.pick({ id: true, hash: true })).max(4),
  }),
  z.object({ op: z.literal('retry') }),
  z.object({ op: z.literal('ocr-pending') }),
  z.object({ op: z.literal('ocr-retry') }),
  z.object({ op: z.literal('ocr-index'), id: z.string(), hash: z.string(), path: z.string().nullable() }),
  z.object({
    op: z.literal('search'),
    query: z.string().min(1).max(200),
    offset: z.number().int().nonnegative().max(1_000_000),
    hybrid: z.boolean().optional(),
  }),
  z.object({
    op: z.literal('metadata-search'),
    query: z.string().min(1).max(200),
    offset: z.number().int().nonnegative().max(1_000_000),
    refresh: z.boolean().optional(),
  }),
]);
export type ImageSearchCommand = z.infer<typeof imageSearchCommandSchema>;
export const imageSearchWorkerConfigurationSchema = z.object({
  nativeBindingPath: z.string().min(1).optional(),
  model: z.string(),
  fingerprint: z.string().min(1),
  cachePath: z.string().min(1),
  role: z.enum(['search', 'index', 'content', 'prepare', 'video']),
  device: imageSearchDeviceSchema,
});
export type ImageSearchWorkerConfiguration = z.infer<typeof imageSearchWorkerConfigurationSchema>;
const requestId = z.number().int().positive();
export const imageSearchProcessMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('configure'), configuration: imageSearchWorkerConfigurationSchema }),
  z.object({ kind: z.literal('request'), id: requestId, command: imageSearchCommandSchema }),
  z.object({ kind: z.literal('cancel'), id: requestId }),
]);
export interface ImageSearchWorkerRequest {
  id: number;
  command: ImageSearchCommand;
  cancellation: SharedArrayBuffer;
}
export type ImageSearchWorkerResult =
  | { id: number; value: unknown }
  | {
      id: number;
      error: 'UNAVAILABLE' | 'CANCELLED' | 'GPU_UNAVAILABLE' | 'RESOURCE_LIMIT' | 'INDEX_TIMEOUT' | 'CHANGED';
    };
export const imageSearchWorkerResponseSchema = z.union([
  z.object({ id: requestId, value: z.unknown(), execution: imageSearchExecutionSchema }).strict(),
  z.object({
    id: requestId,
    error: z.enum(['UNAVAILABLE', 'CANCELLED', 'GPU_UNAVAILABLE', 'RESOURCE_LIMIT', 'INDEX_TIMEOUT', 'CHANGED']),
    execution: imageSearchExecutionSchema,
  }),
]);
export type ImageSearchWorkerResponse = z.infer<typeof imageSearchWorkerResponseSchema>;
