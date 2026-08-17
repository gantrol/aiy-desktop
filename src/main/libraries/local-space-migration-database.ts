import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { DATABASE_SCHEMA_REVISION } from '@/main/database/core/schema';
import { LocalSpaceMigrationFailure } from '@/main/libraries/local-space-migration-error';

const quickCheckSchema = z
  .array(z.object({ quick_check: z.string() }).passthrough())
  .min(1)
  .max(100);
const metadataRowSchema = z.object({ value: z.string() }).passthrough();

export interface LocalSpaceDatabaseFingerprint {
  byteSize: number;
  modifiedAtMs: number;
  sha256: string;
  schemaRevision: number;
}

async function sha256File(filePath: string, signal: AbortSignal) {
  const hash = createHash('sha256');
  const input = createReadStream(filePath, { signal });
  for await (const chunk of input) {
    signal.throwIfAborted();
    if (!Buffer.isBuffer(chunk)) throw new Error('Unexpected database stream payload');
    hash.update(chunk);
  }
  return hash.digest('hex');
}

function migrationFailure(kind: 'SOURCE' | 'DESTINATION', message: string, cause?: unknown): never {
  throw new LocalSpaceMigrationFailure(kind === 'SOURCE' ? 'SOURCE_INVALID' : 'VERIFY_FAILED', message, { cause });
}

function changedDuringVerification(kind: 'SOURCE' | 'DESTINATION'): never {
  if (kind === 'SOURCE') {
    throw new LocalSpaceMigrationFailure('SOURCE_IN_USE', 'The older local space changed during migration');
  }
  return migrationFailure(kind, 'The copied local-space database changed during verification');
}

async function assertNoPendingWal(databasePath: string, kind: 'SOURCE' | 'DESTINATION') {
  try {
    const stats = await lstat(`${databasePath}-wal`);
    if (!stats.isFile() || stats.isSymbolicLink()) migrationFailure(kind, 'Local-space database journal is invalid');
    if (stats.size > 0) {
      if (kind === 'SOURCE') {
        throw new LocalSpaceMigrationFailure('SOURCE_IN_USE', 'Close the older AIY app before migrating its data');
      }
      migrationFailure(kind, 'Copied local-space database has a pending journal');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}

function metadata(database: Database.Database, key: string) {
  const row = database.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as unknown;
  return metadataRowSchema.parse(row).value;
}

export async function verifyLocalSpaceDatabase(
  rootPath: string,
  kind: 'SOURCE' | 'DESTINATION',
  signal: AbortSignal,
): Promise<LocalSpaceDatabaseFingerprint> {
  signal.throwIfAborted();
  const databasePath = path.join(rootPath, 'library.sqlite3');
  let stats: Awaited<ReturnType<typeof lstat>>;
  try {
    stats = await lstat(databasePath);
    if (!stats.isFile() || stats.isSymbolicLink()) migrationFailure(kind, 'Local-space database is invalid');
  } catch (error) {
    if (error instanceof LocalSpaceMigrationFailure) throw error;
    migrationFailure(kind, 'Local-space database is unavailable', error);
  }

  await assertNoPendingWal(databasePath, kind);
  const sha256 = await sha256File(databasePath, signal);
  const statsAfterHash = await lstat(databasePath);
  if (
    !statsAfterHash.isFile() ||
    statsAfterHash.isSymbolicLink() ||
    statsAfterHash.dev !== stats.dev ||
    statsAfterHash.ino !== stats.ino ||
    statsAfterHash.size !== stats.size ||
    statsAfterHash.mtimeMs !== stats.mtimeMs
  ) {
    changedDuringVerification(kind);
  }
  let database: Database.Database | null = null;
  try {
    database = new Database(databasePath, { readonly: true, fileMustExist: true });
    database.pragma('query_only = ON');
    const quickCheck = quickCheckSchema.parse(database.pragma('quick_check') as unknown);
    if (quickCheck.some((row) => row.quick_check !== 'ok')) migrationFailure(kind, 'Local-space database is corrupt');
    const schemaRevision = Number(metadata(database, 'database_schema_revision'));
    if (!Number.isInteger(schemaRevision) || schemaRevision < 1 || schemaRevision > DATABASE_SCHEMA_REVISION) {
      migrationFailure(kind, 'Local-space database version is unsupported');
    }
    const shutdownState = metadata(database, 'database_shutdown_state');
    if (shutdownState !== 'clean') {
      if (kind === 'SOURCE') {
        throw new LocalSpaceMigrationFailure('SOURCE_IN_USE', 'Close the older AIY app before migrating its data');
      }
      migrationFailure(kind, 'Copied local-space database was not closed cleanly');
    }
    return {
      byteSize: stats.size,
      modifiedAtMs: stats.mtimeMs,
      sha256,
      schemaRevision,
    };
  } catch (error) {
    if (error instanceof LocalSpaceMigrationFailure) throw error;
    migrationFailure(kind, 'Local-space database validation failed', error);
  } finally {
    database?.close();
  }
  return migrationFailure(kind, 'Local-space database validation did not complete');
}

export function assertDatabaseUnchanged(
  expected: LocalSpaceDatabaseFingerprint,
  actual: LocalSpaceDatabaseFingerprint,
  kind: 'SOURCE' | 'DESTINATION',
) {
  if (
    expected.byteSize === actual.byteSize &&
    expected.sha256 === actual.sha256 &&
    (kind === 'DESTINATION' || expected.modifiedAtMs === actual.modifiedAtMs)
  ) {
    return;
  }
  throw new LocalSpaceMigrationFailure(
    kind === 'SOURCE' ? 'SOURCE_IN_USE' : 'VERIFY_FAILED',
    kind === 'SOURCE' ? 'The older local space changed during migration' : 'The copied local space does not match',
  );
}
