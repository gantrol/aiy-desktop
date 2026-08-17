import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function exists(filePath: string) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function assertDirectory(directoryPath: string) {
  const details = await stat(directoryPath);
  if (!details.isDirectory()) {
    const error = new Error('Export destination is not a directory') as NodeJS.ErrnoException;
    error.code = 'ENOTDIR';
    throw error;
  }
}

function directChildPath(parentDirectory: string, name: string) {
  if (!name || name === '.' || name === '..' || path.basename(name) !== name) {
    const error = new Error('Export name must be one path component') as NodeJS.ErrnoException;
    error.code = 'EINVAL';
    throw error;
  }
  const candidate = path.resolve(parentDirectory, name);
  if (path.dirname(candidate) !== parentDirectory) {
    const error = new Error('Export path escaped its selected parent') as NodeJS.ErrnoException;
    error.code = 'EINVAL';
    throw error;
  }
  return candidate;
}

export async function writeDirectoryAtomically(
  parentDirectory: string,
  candidateName: (collisionIndex: number) => string,
  writeContents: (temporaryDirectory: string, finalName: string) => Promise<void>,
) {
  const absoluteParent = path.resolve(parentDirectory);
  await assertDirectory(absoluteParent);
  for (let collisionIndex = 1; collisionIndex <= 10_000; collisionIndex += 1) {
    const finalName = candidateName(collisionIndex);
    const finalPath = directChildPath(absoluteParent, finalName);
    if (await exists(finalPath)) continue;

    const temporaryPath = directChildPath(absoluteParent, `.aiy-video-export-${randomUUID()}.tmp`);
    await mkdir(temporaryPath);
    try {
      await writeContents(temporaryPath, finalName);
      if (await exists(finalPath)) {
        await rm(temporaryPath, { recursive: true, force: true });
        continue;
      }
      try {
        await rename(temporaryPath, finalPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EEXIST' || code === 'ENOTEMPTY') {
          await rm(temporaryPath, { recursive: true, force: true });
          continue;
        }
        throw error;
      }
      return { directoryPath: finalPath, directoryName: finalName };
    } catch (error) {
      await rm(temporaryPath, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }
  const error = new Error('No available export directory name') as NodeJS.ErrnoException;
  error.code = 'EEXIST';
  throw error;
}

async function replaceExistingFile(temporaryPath: string, destinationPath: string) {
  if (!(await exists(destinationPath))) {
    await rename(temporaryPath, destinationPath);
    return;
  }

  try {
    await rename(temporaryPath, destinationPath);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES') throw error;
  }

  const backupPath = path.join(path.dirname(destinationPath), `.aiy-video-export-${randomUUID()}.bak`);
  await rename(destinationPath, backupPath);
  try {
    await rename(temporaryPath, destinationPath);
  } catch (error) {
    await rename(backupPath, destinationPath).catch(() => undefined);
    throw error;
  }
  await unlink(backupPath).catch(() => undefined);
}

export async function writeValidatedFileAtomically(
  destinationPath: string,
  contents: Buffer,
  validate: (persistedContents: Buffer) => void,
) {
  await assertDirectory(path.dirname(destinationPath));
  const temporaryPath = path.join(path.dirname(destinationPath), `.aiy-video-export-${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, contents, { flag: 'wx' });
    validate(await readFile(temporaryPath));
    await replaceExistingFile(temporaryPath, destinationPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
