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
import {
  access,
  copyFile,
  mkdir,
  open as openFile,
  readFile,
  rename,
  stat,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
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

async function closeAsyncBestEffort(handle: FileHandle | null) {
  if (!handle) return;
  try {
    await handle.close();
  } catch {
    // Preserve the persistence error that initiated cleanup.
  }
}

async function unlinkAsyncBestEffort(filePath: string) {
  try {
    await unlink(filePath);
  } catch {
    // Cleanup is best-effort.
  }
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
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

async function syncDirectoryAsync(directory: string) {
  let handle: FileHandle | null = null;
  try {
    handle = await openFile(directory, 'r');
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['EACCES', 'EBADF', 'EISDIR', 'EINVAL', 'ENOTSUP', 'EPERM'].includes(code ?? '')) throw error;
  } finally {
    await closeAsyncBestEffort(handle);
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

async function readCandidateAsync(filePath: string, maximumBytes: number): Promise<unknown | null> {
  try {
    const stats = await stat(filePath);
    if (!stats.isFile() || stats.size > maximumBytes) return null;
    return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
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

export async function readBoundedJsonWithBackupSourceAsync(
  filePath: string,
  maximumBytes: number,
  accepts: (value: unknown) => boolean = () => true,
): Promise<{ source: 'primary' | 'backup'; value: unknown } | null> {
  const primary = await readCandidateAsync(filePath, maximumBytes);
  if (primary !== null && accepts(primary)) return { source: 'primary', value: primary };
  const backup = await readCandidateAsync(`${filePath}${BACKUP_SUFFIX}`, maximumBytes);
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

export async function writeJsonAtomicallyAsync(filePath: string, value: unknown) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const contents = JSON.stringify(value);
  if (contents === undefined) throw new Error('JSON persistence requires a serializable value');
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  const backupPath = `${filePath}${BACKUP_SUFFIX}`;
  let handle: FileHandle | null = null;
  try {
    handle = await openFile(temporaryPath, 'wx', 0o600);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;

    if (await pathExists(filePath)) {
      await unlinkAsyncBestEffort(backupPath);
      try {
        await rename(filePath, backupPath);
      } catch {
        await copyFile(filePath, backupPath);
        await unlink(filePath);
      }
    }
    await rename(temporaryPath, filePath);
    await syncDirectoryAsync(directory);
  } catch (error) {
    await closeAsyncBestEffort(handle);
    await unlinkAsyncBestEffort(temporaryPath);
    if (!(await pathExists(filePath)) && (await pathExists(backupPath))) {
      try {
        await rename(backupPath, filePath);
      } catch {
        // The readable backup remains available to the recovery reader.
      }
    }
    throw error;
  }
}
