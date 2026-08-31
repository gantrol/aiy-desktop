import { z } from 'zod';
import type { JsonMap } from '@/main/database/core/values';

const stableKeySchema = z.string().trim().min(1).max(120);
const identifierSchema = z.string().trim().min(1).max(240);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const metadataObjectSchema = z.record(z.string(), z.unknown());

const revisionMetadataSchema = z
  .object({
    stableKey: stableKeySchema,
  })
  .passthrough();

const exampleMetadataSchema = z
  .object({
    contract: z.literal('CONTENT_PACK_EXAMPLE_V2'),
    termStableKey: stableKeySchema,
    exampleKey: identifierSchema,
    status: z.enum(['ACCEPTED', 'REJECTED']),
    role: z.enum(['COVER', 'RELATED', 'NEGATIVE_EVIDENCE']),
    note: z.string().max(10_000),
    assetId: identifierSchema,
    mediaId: identifierSchema,
    evidenceId: identifierSchema,
    objectHash: hashSchema,
  })
  .passthrough();

export interface PackReleaseItemMetadataContext {
  itemKey: string;
  objectType: string;
}

export class PackMetadataInvalidError extends Error {
  readonly code = 'PACK_METADATA_INVALID';

  constructor(
    readonly itemKey: string,
    readonly objectType: string,
  ) {
    super(`Pack metadata is invalid for ${objectType}:${itemKey}`);
    this.name = 'PackMetadataInvalidError';
  }
}

function parseJsonObject(value: unknown, context: PackReleaseItemMetadataContext) {
  try {
    const parsed = JSON.parse(typeof value === 'string' ? value : '');
    return metadataObjectSchema.parse(parsed);
  } catch {
    throw new PackMetadataInvalidError(context.itemKey, context.objectType);
  }
}

function parseWithSchema<Output>(value: unknown, context: PackReleaseItemMetadataContext, schema: z.ZodType<Output>) {
  const parsed = parseJsonObject(value, context);
  const result = schema.safeParse(parsed);
  if (!result.success) throw new PackMetadataInvalidError(context.itemKey, context.objectType);
  return result.data;
}

export function parsePackRevisionMetadata(value: unknown, context: PackReleaseItemMetadataContext) {
  return parseWithSchema(value, context, revisionMetadataSchema);
}

export function parsePackExampleMetadata(value: unknown, context: PackReleaseItemMetadataContext) {
  return parseWithSchema(value, context, exampleMetadataSchema);
}

export function parsePackReleaseItemMetadata(value: unknown, context: PackReleaseItemMetadataContext): JsonMap {
  if (context.objectType === 'TERM_REVISION' || context.objectType === 'RECIPE_REVISION') {
    return parsePackRevisionMetadata(value, context);
  }
  if (context.objectType === 'TERM_EXAMPLE') return parsePackExampleMetadata(value, context);
  return parseWithSchema(value, context, metadataObjectSchema);
}
