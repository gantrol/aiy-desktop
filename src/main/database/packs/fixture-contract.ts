import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { JsonMap } from '@/main/database/core/values';

export const V03_FIXTURE_SCHEMA_VERSION = '0.3.0';
const MAX_FIXTURE_BYTES = 64 * 1024 * 1024;
const v03FixtureDocumentSchema = z
  .object({
    schemaVersion: z.literal(V03_FIXTURE_SCHEMA_VERSION),
  })
  .passthrough();

export function parseV03FixtureDocument(value: unknown): JsonMap {
  const parsed = v03FixtureDocumentSchema.safeParse(value);
  if (!parsed.success) {
    const schemaVersion = value && typeof value === 'object' ? (value as JsonMap).schemaVersion : undefined;
    throw new Error(`Unsupported fixture schema version: ${String(schemaVersion || 'missing')}`);
  }
  return parsed.data;
}

export function readV03FixtureDocument(fixturePath: string): JsonMap {
  const bytes = readFileSync(fixturePath);
  if (!bytes.byteLength || bytes.byteLength > MAX_FIXTURE_BYTES) {
    throw new Error(`Fixture exceeds its ${MAX_FIXTURE_BYTES}-byte size budget`);
  }
  return parseV03FixtureDocument(JSON.parse(bytes.toString('utf8')) as unknown);
}
