import path from 'node:path';
import { z } from 'zod';
import {
  LOCAL_SPACE_MAX_DIRECTORIES,
  LOCAL_SPACE_MAX_FILES,
  LOCAL_SPACE_MAX_UNIQUE_BYTES,
} from '@/main/libraries/local-space-copy';
import { LocalSpaceTransferFailure } from '@/main/libraries/local-space-transfer-error';

export const LOCAL_SPACE_ARCHIVE_EXTENSION = '.aiyspace';
export const LOCAL_SPACE_ARCHIVE_MAGIC = Buffer.from('AIYSPACE-V1\n', 'ascii');
export const LOCAL_SPACE_ARCHIVE_MAX_METADATA_BYTES = 64 * 1024;
export const LOCAL_SPACE_ARCHIVE_RECORD = {
  END: 0,
  DIRECTORY: 1,
  FILE: 2,
  HARD_LINK: 3,
} as const;

const timestampSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => Number.isFinite(Date.parse(value)));
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

function validArchivePath(value: string) {
  if (!value || value.length > 2_048 || Buffer.byteLength(value, 'utf8') > 4_096) return false;
  if (value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value)) return false;
  const components = value.split('/');
  if (components.some((component) => !component || component === '.' || component === '..')) return false;
  return components.every((component) => {
    if (
      Buffer.byteLength(component, 'utf8') > 255 ||
      /[<>:"|?*\u0000-\u001f]/.test(component) ||
      /[. ]$/.test(component) ||
      component.toLocaleLowerCase('en-US').includes('trash')
    ) {
      return false;
    }
    const stem = component.split('.')[0].toLocaleUpperCase('en-US');
    return !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem);
  });
}

export const localSpaceArchivePathSchema = z.string().refine(validArchivePath);

const spaceIdentitySchema = z
  .object({
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    createdAt: timestampSchema,
  })
  .strict();

export const localSpaceArchiveHeaderSchema = z
  .object({
    format: z.literal('AIYSPACE'),
    formatVersion: z.literal(1),
    exportedAt: timestampSchema,
    applicationVersion: z.string().min(1).max(64),
    databaseSchemaRevision: z.number().int().min(1).max(65_535),
    space: spaceIdentitySchema,
    totalDirectories: z.number().int().nonnegative().max(LOCAL_SPACE_MAX_DIRECTORIES),
    totalFiles: z.number().int().positive().max(LOCAL_SPACE_MAX_FILES),
    totalBytes: z.number().int().positive().max(LOCAL_SPACE_MAX_UNIQUE_BYTES),
    expandedBytes: z.number().int().positive().max(LOCAL_SPACE_MAX_UNIQUE_BYTES),
  })
  .strict()
  .refine((value) => value.expandedBytes >= value.totalBytes, { path: ['expandedBytes'] });
export type LocalSpaceArchiveHeader = z.infer<typeof localSpaceArchiveHeaderSchema>;

const archiveEntryBaseSchema = z
  .object({
    path: localSpaceArchivePathSchema,
    mode: z.number().int().min(0).max(0o777),
    mtimeMs: z.number().int().nonnegative().max(8_640_000_000_000_000),
  })
  .strict();

export const localSpaceArchiveDirectorySchema = archiveEntryBaseSchema;
export const localSpaceArchiveFileSchema = archiveEntryBaseSchema
  .extend({
    byteSize: z.number().int().nonnegative().max(LOCAL_SPACE_MAX_UNIQUE_BYTES),
  })
  .strict();
export const localSpaceArchiveHardLinkSchema = archiveEntryBaseSchema
  .extend({
    target: localSpaceArchivePathSchema,
    byteSize: z.number().int().nonnegative().max(LOCAL_SPACE_MAX_UNIQUE_BYTES),
  })
  .strict();
export const localSpaceArchiveEndSchema = z
  .object({
    totalDirectories: z.number().int().nonnegative().max(LOCAL_SPACE_MAX_DIRECTORIES),
    totalFiles: z.number().int().positive().max(LOCAL_SPACE_MAX_FILES),
    totalBytes: z.number().int().positive().max(LOCAL_SPACE_MAX_UNIQUE_BYTES),
    expandedBytes: z.number().int().positive().max(LOCAL_SPACE_MAX_UNIQUE_BYTES),
    contentSha256: sha256Schema,
  })
  .strict();

export function archiveRelativePath(relativePath: string) {
  return localSpaceArchivePathSchema.parse(relativePath.split(path.sep).join('/'));
}

export function archivePathKey(value: string) {
  const validated = localSpaceArchivePathSchema.parse(value);
  return process.platform === 'win32' ? validated.toLocaleLowerCase('en-US') : validated;
}

export function resolveArchiveEntryPath(rootPath: string, archivedPath: string) {
  const validated = localSpaceArchivePathSchema.parse(archivedPath);
  const resolvedRoot = path.resolve(rootPath);
  const resolved = path.resolve(resolvedRoot, ...validated.split('/'));
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new LocalSpaceTransferFailure('ARCHIVE_INVALID', 'Archive entry escapes its destination');
  }
  return resolved;
}

export function boundedMetadata(value: unknown) {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  if (!bytes.length || bytes.length > LOCAL_SPACE_ARCHIVE_MAX_METADATA_BYTES) {
    throw new LocalSpaceTransferFailure('ARCHIVE_INVALID', 'Archive metadata exceeds its limit');
  }
  return bytes;
}
