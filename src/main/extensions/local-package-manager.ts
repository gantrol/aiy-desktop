import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LoadedExtensionPackage } from '@/main/extensions/package-loader';
import { loadExtensionPackage } from '@/main/extensions/package-loader';

async function requireDirectory(directoryPath: string, label: string) {
  const entry = await lstat(directoryPath);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error(`${label} must be a regular directory`);
  }
}

async function requireRegularFile(filePath: string, label: string) {
  const entry = await lstat(filePath);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
}

function requireDirectChild(rootPath: string, candidatePath: string) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedCandidate = path.resolve(candidatePath);
  if (path.dirname(resolvedCandidate) !== resolvedRoot || resolvedCandidate === resolvedRoot) {
    throw new Error('Local extension path is outside the managed extension directory');
  }
  return resolvedCandidate;
}

/** Installs declarative extension packages without executing plugin code. */
export class LocalExtensionPackageManager {
  constructor(private readonly rootPath: string) {}

  async inspect(sourcePath: string) {
    const resolvedSource = path.resolve(sourcePath);
    await requireDirectory(resolvedSource, 'Extension package');
    await requireRegularFile(path.join(resolvedSource, 'manifest.json'), 'Extension manifest');
    const candidate = await loadExtensionPackage(resolvedSource, 'LOCAL');
    if (candidate.manifest.language?.catalog) {
      await requireRegularFile(path.join(resolvedSource, candidate.manifest.language.catalog), 'Language catalog');
    }
    return candidate;
  }

  async install(candidate: LoadedExtensionPackage): Promise<LoadedExtensionPackage> {
    await mkdir(this.rootPath, { recursive: true });
    const targetPath = requireDirectChild(this.rootPath, path.join(this.rootPath, candidate.manifest.id));
    const temporaryRoot = await mkdtemp(path.join(path.dirname(this.rootPath), '.aiy-extension-install-'));
    const stagedPath = path.join(temporaryRoot, candidate.manifest.id);
    const backupPath = path.join(temporaryRoot, 'previous');
    let backedUp = false;
    let placedTarget = false;
    let retainBackup = false;
    try {
      await mkdir(stagedPath);
      await writeFile(path.join(stagedPath, 'manifest.json'), JSON.stringify(candidate.manifest, null, 2) + '\n', {
        flag: 'wx',
      });
      if (candidate.manifest.language?.catalog) {
        await writeFile(
          path.join(stagedPath, candidate.manifest.language.catalog),
          JSON.stringify(candidate.languageMessages, null, 2) + '\n',
          { flag: 'wx' },
        );
      }
      const staged = await loadExtensionPackage(stagedPath, 'LOCAL');
      if (staged.manifest.id !== candidate.manifest.id) throw new Error('Extension id changed while installing');
      try {
        await requireDirectory(targetPath, 'Installed extension package');
        await rename(targetPath, backupPath);
        backedUp = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await rename(stagedPath, targetPath);
      placedTarget = true;
      return await loadExtensionPackage(targetPath, 'LOCAL');
    } catch (error) {
      try {
        if (placedTarget) await rm(targetPath, { recursive: true, force: true });
        if (backedUp) await rename(backupPath, targetPath);
      } catch (rollbackError) {
        retainBackup = true;
        throw new AggregateError([error, rollbackError], `Extension recovery required: ${temporaryRoot}`);
      }
      throw error;
    } finally {
      if (!retainBackup) await rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  async uninstall(packagePath: string) {
    const targetPath = requireDirectChild(this.rootPath, packagePath);
    await requireDirectory(targetPath, 'Installed extension package');
    await rm(targetPath, { recursive: true, force: false });
  }
}
