import { open, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ExtensionManifestDto, ExtensionSource } from '@/shared/contracts';
import { parseExtensionManifest } from '@/main/extensions/manifest';
import { validatePackagedCapabilityRuntime } from '@/main/extensions/host-runtime-contracts';

const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_LANGUAGE_CATALOG_BYTES = 2 * 1024 * 1024;

export interface ExtensionPackageRoot {
  rootPath: string;
  source: ExtensionSource;
}

export interface LoadedExtensionPackage {
  manifest: ExtensionManifestDto;
  source: ExtensionSource;
  packagePath: string;
  languageMessages: Record<string, unknown> | null;
}

async function readJsonFile(filePath: string, maximumBytes: number): Promise<unknown> {
  const file = await open(filePath, 'r');
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > maximumBytes) throw new Error(`Invalid extension file: ${filePath}`);
    const buffer = Buffer.alloc(maximumBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maximumBytes) throw new Error(`Extension file is too large: ${filePath}`);
    return JSON.parse(buffer.toString('utf8', 0, length)) as unknown;
  } finally {
    await file.close();
  }
}

function asCatalog(value: unknown, extensionId: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Language extension ${extensionId} catalog must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

export async function loadExtensionPackage(
  packagePath: string,
  source: ExtensionSource,
): Promise<LoadedExtensionPackage> {
  const manifest = parseExtensionManifest(
    await readJsonFile(path.join(packagePath, 'manifest.json'), MAX_MANIFEST_BYTES),
  );
  if (manifest.kind === 'CAPABILITY') {
    validatePackagedCapabilityRuntime(manifest);
    return { manifest, source, packagePath, languageMessages: null };
  }
  if (!manifest.language?.catalog)
    throw new Error(`External language extension ${manifest.id} is missing language.catalog`);
  const catalogPath = path.join(packagePath, manifest.language.catalog);
  const languageMessages = asCatalog(await readJsonFile(catalogPath, MAX_LANGUAGE_CATALOG_BYTES), manifest.id);
  return { manifest, source, packagePath, languageMessages };
}

/** Discover one extension package per direct child directory. Invalid packages are isolated. */
export async function loadExtensionPackages(roots: readonly ExtensionPackageRoot[]): Promise<LoadedExtensionPackage[]> {
  const packages: LoadedExtensionPackage[] = [];
  for (const root of roots) {
    let entries;
    try {
      entries = await readdir(root.rootPath, { withFileTypes: true });
    } catch {
      continue;
    }
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name));
    for (let index = 0; index < directories.length; index += 4) {
      const loaded = await Promise.all(
        directories.slice(index, index + 4).map(async (entry) => {
          const packagePath = path.join(root.rootPath, entry.name);
          try {
            return await loadExtensionPackage(packagePath, root.source);
          } catch (error) {
            console.warn('[extensions] skipped invalid package', packagePath, error);
            return null;
          }
        }),
      );
      for (const candidate of loaded) if (candidate) packages.push(candidate);
    }
  }
  return packages;
}
