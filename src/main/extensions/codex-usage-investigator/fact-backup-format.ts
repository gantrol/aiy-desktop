import { createHash, randomUUID } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
export { CODEX_USAGE_FACT_BACKUP_FAILED as FACT_BACKUP_ERROR } from '@/shared/contracts/codex-usage';

export const FACT_BACKUP_DIRECTORY = 'usage-facts-v1';
export const FACT_BACKUP_TABLES = ['usage_source_files', 'usage_events', 'usage_chat_turns'] as const;
export const FACT_BACKUP_MAX_LINE_BYTES = 64 * 1024;
export const FACT_BACKUP_MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
export const FACT_BACKUP_BUFFER_BYTES = 256 * 1024;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative().safe();
const scalar = z.union([z.string().max(32_000), z.number().finite(), z.null()]);

export const factRowSchema = z.record(z.string().regex(/^[a-z_]+$/), scalar);
export const factSourceSchema = z.object({ session_id: z.string().min(1).max(512) }).catchall(scalar);
const generationSchema = z
  .object({
    file: z.string().regex(/^[a-f0-9]{64}\.jsonl\.gz$/),
    sourceRevision: digest,
    sha256: digest,
    events: count,
    turns: count,
    bytes: count,
    createdAt: z.string().datetime(),
  })
  .strict();
export const factManifestSchema = z
  .object({
    format: z.literal('aiy.codex-usage-facts'),
    version: z.literal(1),
    sources: z.record(digest, z.object({ current: generationSchema, previous: generationSchema.optional() }).strict()),
  })
  .strict();
export const factHeaderSchema = z
  .object({
    type: z.literal('source'),
    format: z.literal('aiy.codex-usage-facts'),
    version: z.literal(1),
    databaseVersion: count,
    source: factSourceSchema,
  })
  .strict();
export const factRecordSchema = z
  .object({
    type: z.enum(['usage_events', 'usage_chat_turns']),
    row: factRowSchema,
  })
  .strict();
export const factFooterSchema = z
  .object({
    type: z.literal('end'),
    events: count,
    turns: count,
    sha256: digest,
  })
  .strict();
export type FactManifest = z.infer<typeof factManifestSchema>;
export type FactGeneration = z.infer<typeof generationSchema>;
export type FactSource = z.infer<typeof factSourceSchema>;

export function factDigest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export async function readFactManifest(directory: string): Promise<FactManifest> {
  let handle;
  try {
    handle = await open(path.join(directory, 'manifest.json'), 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { format: 'aiy.codex-usage-facts', version: 1, sources: {} };
    }
    throw error;
  }
  try {
    if ((await handle.stat()).size > FACT_BACKUP_MAX_MANIFEST_BYTES)
      throw new Error('Fact backup manifest is too large');
    return factManifestSchema.parse(JSON.parse(await handle.readFile('utf8')));
  } finally {
    await handle.close();
  }
}

/** The old manifest remains authoritative until all newly referenced archives are durable. */
export async function writeFactManifest(directory: string, manifest: FactManifest) {
  const encoded = JSON.stringify(manifest);
  if (Buffer.byteLength(encoded) > FACT_BACKUP_MAX_MANIFEST_BYTES) throw new Error('Fact backup manifest is too large');
  const temporary = path.join(directory, `${randomUUID()}.manifest.tmp`);
  const handle = await open(temporary, 'wx');
  try {
    await handle.writeFile(encoded);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path.join(directory, 'manifest.json'));
  } finally {
    await rm(temporary, { force: true });
  }
}
