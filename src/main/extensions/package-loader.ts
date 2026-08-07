import { readFileSync, readdirSync, statSync } from 'node:fs';
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

function readJsonFile(filePath: string, maximumBytes: number): unknown {
  const size = statSync(filePath).size;
  if (size > maximumBytes) throw new Error(`Extension file is too large: ${filePath}`);
  return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
}

function asCatalog(value: unknown, extensionId: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Language extension ${extensionId} catalog must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

export function loadExtensionPackage(packagePath: string, source: ExtensionSource): LoadedExtensionPackage {
  const manifest = parseExtensionManifest(readJsonFile(path.join(packagePath, 'manifest.json'), MAX_MANIFEST_BYTES));
  if (manifest.kind === 'CAPABILITY') {
    validatePackagedCapabilityRuntime(manifest);
    return { manifest, source, packagePath, languageMessages: null };
  }
  if (!manifest.language?.catalog)
    throw new Error(`External language extension ${manifest.id} is missing language.catalog`);
  const catalogPath = path.join(packagePath, manifest.language.catalog);
  const languageMessages = asCatalog(readJsonFile(catalogPath, MAX_LANGUAGE_CATALOG_BYTES), manifest.id);
  return { manifest, source, packagePath, languageMessages };
}

/** Discover one extension package per direct child directory. Invalid packages are isolated. */
export function loadExtensionPackages(roots: readonly ExtensionPackageRoot[]): LoadedExtensionPackage[] {
  const packages: LoadedExtensionPackage[] = [];
  for (const root of roots) {
    let entries;
    try {
      entries = readdirSync(root.rootPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory()) continue;
      const packagePath = path.join(root.rootPath, entry.name);
      try {
        packages.push(loadExtensionPackage(packagePath, root.source));
      } catch (error) {
        console.warn('[extensions] skipped invalid package', packagePath, error);
      }
    }
  }
  return packages;
}
