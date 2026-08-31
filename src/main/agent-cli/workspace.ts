import { lstat, readFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { resolveBrowserCompanionDataPath } from '@/main/browser-companion/data-path';
import { parseModelWorkerDescriptor, type ModelWorkerDescriptor } from '@/main/model-worker/protocol';
import { STORE_USER_DATA_DIRECTORY_NAME, USER_DATA_DIRECTORY_NAME } from '@/shared/product';

const MAX_REGISTRY_BYTES = 4 * 1024 * 1024;
const MAX_DESCRIPTOR_BYTES = 64 * 1024;

const librarySchema = z
  .object({
    id: z.string().min(1).max(512),
    name: z.string().min(1).max(1_000),
    rootPath: z.string().min(1).max(32_768),
  })
  .passthrough();

const registrySchema = z
  .object({
    version: z.literal(1),
    currentLibraryId: z.string().min(1).max(512),
    libraries: z.array(librarySchema).min(1).max(10_000),
  })
  .passthrough();

export interface AgentCliWorkspace {
  userDataRoot: string;
  browserCompanionDataPath: string;
  library: { id: string; name: string; rootPath: string };
  descriptor: ModelWorkerDescriptor;
}

function workspaceError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

async function readPlainBoundedText(filePath: string, maximumBytes: number, unavailableCode: string) {
  let stats;
  try {
    stats = await lstat(filePath);
  } catch {
    throw workspaceError(unavailableCode, `Required AIY runtime file is unavailable: ${filePath}`);
  }
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size < 1 || stats.size > maximumBytes) {
    throw workspaceError(unavailableCode, `AIY runtime file is invalid: ${filePath}`);
  }
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    throw workspaceError(unavailableCode, `Required AIY runtime file is unavailable: ${filePath}`);
  }
}

function applicationDataRoot() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA?.trim();
    if (!appData) throw workspaceError('AIY_AGENT_USER_DATA_UNAVAILABLE', 'APPDATA is unavailable');
    return path.resolve(appData);
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support');
  }
  return path.resolve(process.env.XDG_CONFIG_HOME?.trim() || path.join(home, '.config'));
}

function defaultUserDataRoots(appDataRoot: string) {
  const roots = [path.join(appDataRoot, USER_DATA_DIRECTORY_NAME)];
  if (process.platform === 'win32') roots.push(path.join(appDataRoot, STORE_USER_DATA_DIRECTORY_NAME));
  return roots;
}

async function registryExists(userDataRoot: string) {
  try {
    const stats = await lstat(path.join(userDataRoot, 'libraries', 'index.json'));
    return stats.isFile() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

async function resolveUserDataRoot(appDataRoot: string, configuredPath?: string) {
  const override = configuredPath?.trim() || process.env.AIY_USER_DATA_DIR?.trim();
  if (override) return { path: path.resolve(override), configured: true } as const;
  const candidates = defaultUserDataRoots(appDataRoot);
  const available: string[] = [];
  for (const candidate of candidates) {
    if (await registryExists(candidate)) available.push(candidate);
  }
  if (available.length > 1) {
    throw workspaceError(
      'AIY_AGENT_USER_DATA_AMBIGUOUS',
      'Multiple AIY data roots are available; pass --user-data-dir explicitly',
    );
  }
  if (available.length === 1) return { path: available[0], configured: false } as const;
  throw workspaceError('AIY_AGENT_USER_DATA_UNAVAILABLE', 'AIY user data was not found; start AIY once first');
}

export async function resolveAgentCliWorkspace(configuredUserDataPath?: string): Promise<AgentCliWorkspace> {
  const appDataRoot = applicationDataRoot();
  const resolvedUserData = await resolveUserDataRoot(appDataRoot, configuredUserDataPath);
  const userDataRoot = resolvedUserData.path;
  const registryPath = path.join(userDataRoot, 'libraries', 'index.json');
  let registryValue: unknown;
  try {
    registryValue = JSON.parse(
      await readPlainBoundedText(registryPath, MAX_REGISTRY_BYTES, 'AIY_AGENT_REGISTRY_INVALID'),
    ) as unknown;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) throw error;
    throw workspaceError('AIY_AGENT_REGISTRY_INVALID', 'AIY library registry contains malformed JSON');
  }
  const parsed = registrySchema.safeParse(registryValue);
  if (!parsed.success) throw workspaceError('AIY_AGENT_REGISTRY_INVALID', 'AIY library registry is invalid');
  const current = parsed.data.libraries.find((library) => library.id === parsed.data.currentLibraryId);
  if (!current) throw workspaceError('AIY_AGENT_LIBRARY_UNAVAILABLE', 'Current AIY library is missing');

  const libraryRoot = path.resolve(current.rootPath);
  let resolvedLibraryRoot: string;
  try {
    resolvedLibraryRoot = await realpath(libraryRoot);
    const databaseStats = await lstat(path.join(resolvedLibraryRoot, 'library.sqlite3'));
    if (!databaseStats.isFile() || databaseStats.isSymbolicLink()) throw new Error('invalid database');
  } catch {
    throw workspaceError('AIY_AGENT_LIBRARY_UNAVAILABLE', 'Current AIY library is unavailable');
  }

  const descriptorPath = path.join(resolvedLibraryRoot, 'temp', 'model-worker.json');
  let descriptor: ModelWorkerDescriptor | null;
  try {
    descriptor = parseModelWorkerDescriptor(
      await readPlainBoundedText(descriptorPath, MAX_DESCRIPTOR_BYTES, 'AIY_AGENT_WORKER_UNAVAILABLE'),
    );
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) throw error;
    descriptor = null;
  }
  if (!descriptor) {
    throw workspaceError('AIY_AGENT_WORKER_UNAVAILABLE', 'AIY background service is unavailable; open AIY and retry');
  }
  return {
    userDataRoot,
    browserCompanionDataPath: resolveBrowserCompanionDataPath({
      appDataRoot,
      configuredUserDataPath: resolvedUserData.configured ? userDataRoot : undefined,
    }),
    library: { id: current.id, name: current.name, rootPath: resolvedLibraryRoot },
    descriptor,
  };
}
