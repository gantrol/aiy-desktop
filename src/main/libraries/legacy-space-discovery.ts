import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { LegacyLocalSpaceCandidateDto } from '@/shared/contracts/local-space';

const MAX_REGISTRY_BYTES = 2 * 1024 * 1024;
const MAX_LEGACY_SPACES = 200;

const legacyRegistrySpaceSchema = z
  .object({
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    rootPath: z.string().min(1).max(32_768),
    createdAt: z.string().min(1).max(200),
    lastOpenedAt: z.string().min(1).max(200),
  })
  .passthrough();

const legacyRegistrySchema = z
  .object({
    version: z.literal(1),
    libraries: z.array(legacyRegistrySpaceSchema).max(MAX_LEGACY_SPACES),
  })
  .passthrough();

const legacyManifestSchema = z
  .object({
    version: z.literal(1).optional(),
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    createdAt: z.string().min(1).max(200),
  })
  .passthrough();

interface LegacyRegistrySpace {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  lastOpenedAt: string;
}

export interface LegacyLocalSpaceSource extends LegacyLocalSpaceCandidateDto {
  rootPath: string;
}

function pathKey(value: string) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function samePath(left: string, right: string) {
  return pathKey(left) === pathKey(right);
}

function isWithin(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function pathContainsTrash(value: string) {
  return path
    .resolve(value)
    .split(path.sep)
    .some((segment) => segment.toLocaleLowerCase('en-US').includes('trash'));
}

function stableCandidateId(rootPath: string) {
  return `legacy-${createHash('sha256').update(pathKey(rootPath)).digest('hex').slice(0, 32)}`;
}

function timestampOr(value: string, fallback: string) {
  return Number.isFinite(Date.parse(value)) ? value : fallback;
}

async function readBoundedJson(filePath: string): Promise<unknown> {
  const stats = await lstat(filePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_REGISTRY_BYTES) {
    throw new Error('Legacy local-space metadata is invalid');
  }
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
}

async function readLegacyRegistry(legacyUserDataRoot: string) {
  const registryPath = path.join(legacyUserDataRoot, 'libraries', 'index.json');
  try {
    return legacyRegistrySchema.parse(await readBoundedJson(registryPath)).libraries;
  } catch {
    return [];
  }
}

async function readLegacyManifest(rootPath: string) {
  try {
    return legacyManifestSchema.parse(await readBoundedJson(path.join(rootPath, 'library.json')));
  } catch {
    return null;
  }
}

async function usableLibraryRoot(rootPath: string) {
  if (pathContainsTrash(rootPath)) return null;
  try {
    const [rootStats, databaseStats] = await Promise.all([
      lstat(rootPath),
      lstat(path.join(rootPath, 'library.sqlite3')),
    ]);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) return null;
    if (!databaseStats.isFile() || databaseStats.isSymbolicLink()) return null;
    return databaseStats.mtime.toISOString();
  } catch {
    return null;
  }
}

async function fallbackRegistrySpaces(legacyUserDataRoot: string) {
  const roots = [path.join(legacyUserDataRoot, 'library')];
  const librariesRoot = path.join(legacyUserDataRoot, 'libraries');
  try {
    const entries = await readdir(librariesRoot, { withFileTypes: true });
    for (const entry of entries.slice(0, MAX_LEGACY_SPACES)) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.toLocaleLowerCase('en-US').includes('trash')) {
        continue;
      }
      roots.push(path.join(librariesRoot, entry.name));
    }
  } catch {
    // The single pre-registry local space may still be available.
  }

  const spaces: LegacyRegistrySpace[] = [];
  for (const rootPath of roots.slice(0, MAX_LEGACY_SPACES)) {
    const [manifest, fallbackTimestamp] = await Promise.all([
      readLegacyManifest(rootPath),
      usableLibraryRoot(rootPath),
    ]);
    if (!manifest || !fallbackTimestamp) continue;
    spaces.push({
      id: manifest.id,
      name: manifest.name,
      rootPath,
      createdAt: timestampOr(manifest.createdAt, fallbackTimestamp),
      lastOpenedAt: fallbackTimestamp,
    });
  }
  return spaces;
}

function registryRootCandidates(legacyUserDataRoot: string, source: LegacyRegistrySpace) {
  const candidates = [source.rootPath, path.join(legacyUserDataRoot, 'libraries', source.id)];
  if (path.isAbsolute(source.rootPath)) {
    candidates.push(path.join(legacyUserDataRoot, 'libraries', path.basename(source.rootPath)));
  }
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (!path.isAbsolute(candidate)) return false;
    const key = pathKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function resolveLegacyRoot(legacyUserDataRoot: string, source: LegacyRegistrySpace) {
  for (const rootPath of registryRootCandidates(legacyUserDataRoot, source)) {
    const [manifest, fallbackTimestamp] = await Promise.all([
      readLegacyManifest(rootPath),
      usableLibraryRoot(rootPath),
    ]);
    if (manifest?.id === source.id && fallbackTimestamp) {
      return { rootPath: path.resolve(rootPath), manifest, fallbackTimestamp };
    }
  }
  return null;
}

export async function discoverLegacyLocalSpaces(options: {
  legacyUserDataRoot: string | null;
  currentUserDataRoot: string;
  copyRequiredRoots: readonly string[];
  registeredSpaceIds: ReadonlySet<string>;
}) {
  const { legacyUserDataRoot, currentUserDataRoot, copyRequiredRoots, registeredSpaceIds } = options;
  if (!legacyUserDataRoot || samePath(legacyUserDataRoot, currentUserDataRoot)) return [];

  const registrySpaces = await readLegacyRegistry(legacyUserDataRoot);
  const sources = registrySpaces.length ? registrySpaces : await fallbackRegistrySpaces(legacyUserDataRoot);
  const seenRoots = new Set<string>();
  const seenIds = new Set<string>();
  const discovered: LegacyLocalSpaceSource[] = [];

  for (const source of sources) {
    if (discovered.length >= MAX_LEGACY_SPACES || registeredSpaceIds.has(source.id) || seenIds.has(source.id)) continue;
    const resolvedSource = await resolveLegacyRoot(legacyUserDataRoot, source);
    if (!resolvedSource) continue;
    const { rootPath, manifest, fallbackTimestamp } = resolvedSource;
    const rootKey = pathKey(rootPath);
    if (seenRoots.has(rootKey) || isWithin(currentUserDataRoot, rootPath)) continue;
    seenRoots.add(rootKey);
    seenIds.add(source.id);
    discovered.push({
      candidateId: stableCandidateId(rootPath),
      spaceId: manifest.id,
      name: manifest.name,
      createdAt: timestampOr(manifest.createdAt, fallbackTimestamp),
      lastOpenedAt: timestampOr(source.lastOpenedAt, fallbackTimestamp),
      requiresCopy:
        isWithin(legacyUserDataRoot, rootPath) ||
        copyRequiredRoots.some((managedRoot) => isWithin(managedRoot, rootPath)),
      rootPath,
    });
  }
  return discovered.sort((left, right) => Date.parse(right.lastOpenedAt) - Date.parse(left.lastOpenedAt));
}
