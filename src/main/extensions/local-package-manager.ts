import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { LoadedExtensionPackage } from '@/main/extensions/package-loader';
import { loadExtensionPackage } from '@/main/extensions/package-loader';

function requireDirectory(directoryPath: string, label: string) {
  const entry = lstatSync(directoryPath);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error(`${label} must be a regular directory`);
  }
}

function requireRegularFile(filePath: string, label: string) {
  const entry = lstatSync(filePath);
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

  inspect(sourcePath: string) {
    const resolvedSource = path.resolve(sourcePath);
    requireDirectory(resolvedSource, 'Extension package');
    return loadExtensionPackage(resolvedSource, 'LOCAL');
  }

  install(sourcePath: string): LoadedExtensionPackage {
    const candidate = this.inspect(sourcePath);
    requireRegularFile(path.join(candidate.packagePath, 'manifest.json'), 'Extension manifest');
    if (candidate.manifest.language?.catalog) {
      requireRegularFile(path.join(candidate.packagePath, candidate.manifest.language.catalog), 'Language catalog');
    }
    mkdirSync(this.rootPath, { recursive: true });
    const targetPath = requireDirectChild(this.rootPath, path.join(this.rootPath, candidate.manifest.id));
    const temporaryRoot = mkdtempSync(path.join(path.dirname(this.rootPath), '.aiy-extension-install-'));
    const stagedPath = path.join(temporaryRoot, candidate.manifest.id);
    const backupPath = path.join(temporaryRoot, 'previous');
    let backedUp = false;
    let placedTarget = false;
    try {
      mkdirSync(stagedPath);
      copyFileSync(path.join(candidate.packagePath, 'manifest.json'), path.join(stagedPath, 'manifest.json'));
      if (candidate.manifest.language?.catalog) {
        copyFileSync(
          path.join(candidate.packagePath, candidate.manifest.language.catalog),
          path.join(stagedPath, candidate.manifest.language.catalog),
        );
      }
      const staged = loadExtensionPackage(stagedPath, 'LOCAL');
      if (staged.manifest.id !== candidate.manifest.id) throw new Error('Extension id changed while installing');
      if (existsSync(targetPath)) {
        requireDirectory(targetPath, 'Installed extension package');
        renameSync(targetPath, backupPath);
        backedUp = true;
      }
      renameSync(stagedPath, targetPath);
      placedTarget = true;
      return loadExtensionPackage(targetPath, 'LOCAL');
    } catch (error) {
      if (placedTarget && existsSync(targetPath)) rmSync(targetPath, { recursive: true, force: true });
      if (backedUp && existsSync(backupPath)) renameSync(backupPath, targetPath);
      throw error;
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }

  uninstall(packagePath: string) {
    const targetPath = requireDirectChild(this.rootPath, packagePath);
    requireDirectory(targetPath, 'Installed extension package');
    rmSync(targetPath, { recursive: true, force: false });
  }
}
