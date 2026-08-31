import { randomUUID } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const BACKUP_SUFFIX = '.bak';

function closeBestEffort(descriptor: number | null) {
  if (descriptor === null) return;
  try {
    closeSync(descriptor);
  } catch {
    // Preserve the persistence error that initiated cleanup.
  }
}

function unlinkBestEffort(filePath: string) {
  try {
    unlinkSync(filePath);
  } catch {
    // Cleanup is best-effort.
  }
}

function syncDirectory(directory: string) {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(directory, 'r');
    fsyncSync(descriptor);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['EACCES', 'EBADF', 'EISDIR', 'EINVAL', 'ENOTSUP', 'EPERM'].includes(code ?? '')) throw error;
  } finally {
    closeBestEffort(descriptor);
  }
}

function readCandidate(filePath: string, maximumBytes: number): unknown | null {
  try {
    const stats = statSync(filePath);
    if (!stats.isFile() || stats.size > maximumBytes) return null;
    return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

export function readBoundedJsonWithBackup(filePath: string, maximumBytes: number): unknown | null {
  return readBoundedJsonWithBackupSource(filePath, maximumBytes)?.value ?? null;
}

export function readBoundedJsonWithBackupSource(
  filePath: string,
  maximumBytes: number,
  accepts: (value: unknown) => boolean = () => true,
): { source: 'primary' | 'backup'; value: unknown } | null {
  const primary = readCandidate(filePath, maximumBytes);
  if (primary !== null && accepts(primary)) return { source: 'primary', value: primary };
  const backup = readCandidate(`${filePath}${BACKUP_SUFFIX}`, maximumBytes);
  return backup === null || !accepts(backup) ? null : { source: 'backup', value: backup };
}

export function writeJsonAtomically(filePath: string, value: unknown) {
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true });
  const contents = JSON.stringify(value);
  if (contents === undefined) throw new Error('JSON persistence requires a serializable value');
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  const backupPath = `${filePath}${BACKUP_SUFFIX}`;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporaryPath, 'wx', 0o600);
    writeFileSync(descriptor, contents, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;

    if (existsSync(filePath)) {
      unlinkBestEffort(backupPath);
      try {
        renameSync(filePath, backupPath);
      } catch {
        copyFileSync(filePath, backupPath);
        unlinkSync(filePath);
      }
    }
    renameSync(temporaryPath, filePath);
    syncDirectory(directory);
  } catch (error) {
    closeBestEffort(descriptor);
    unlinkBestEffort(temporaryPath);
    if (!existsSync(filePath) && existsSync(backupPath)) {
      try {
        renameSync(backupPath, filePath);
      } catch {
        // The readable backup remains available to the recovery reader.
      }
    }
    throw error;
  }
}
