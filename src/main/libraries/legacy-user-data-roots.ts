import { readdir } from 'node:fs/promises';
import path from 'node:path';

const MAX_PACKAGE_DIRECTORIES = 2_000;
const DEVELOPMENT_PACKAGE_PREFIX = 'aiyimagetools.dev_';

function pathKey(value: string) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function containsTrash(value: string) {
  return path
    .resolve(value)
    .split(path.sep)
    .some((segment) => segment.toLocaleLowerCase('en-US').includes('trash'));
}

function absoluteEnvironmentPath(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && path.isAbsolute(trimmed) && !containsTrash(trimmed) ? path.resolve(trimmed) : null;
}

export function localSpaceForbiddenDestinationRoots(options: {
  appDataRoot: string;
  homeRoot: string;
  localAppDataRoot: string | undefined;
}) {
  const managedRoot =
    process.platform === 'win32' ? path.dirname(path.resolve(options.appDataRoot)) : path.resolve(options.appDataRoot);
  const localAppData = absoluteEnvironmentPath(options.localAppDataRoot);
  const candidates = [
    managedRoot,
    ...(localAppData ? [path.dirname(localAppData)] : []),
    ...(process.platform === 'win32' ? [path.join(path.resolve(options.homeRoot), 'AppData')] : []),
  ];
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = pathKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function developmentPackageRoots(localAppDataRoot: string | null) {
  if (process.platform !== 'win32' || !localAppDataRoot) return [];
  const packagesRoot = path.join(localAppDataRoot, 'Packages');
  const entries = await readdir(packagesRoot, { withFileTypes: true, encoding: 'utf8' }).catch(() => []);
  const roots: string[] = [];
  for (const entry of entries.slice(0, MAX_PACKAGE_DIRECTORIES)) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (!entry.name.toLocaleLowerCase('en-US').startsWith(DEVELOPMENT_PACKAGE_PREFIX)) continue;
    const packageRoot = path.join(packagesRoot, entry.name);
    roots.push(
      path.join(packageRoot, 'LocalCache', 'Roaming', 'AIY-StorePreview'),
      path.join(packageRoot, 'LocalCache', 'Roaming', 'AIY-Store'),
      path.join(packageRoot, 'LocalCache', 'Roaming', 'AIY'),
      path.join(packageRoot, 'LocalState', 'AIY-StorePreview'),
      path.join(packageRoot, 'LocalState', 'AIY-Store'),
      path.join(packageRoot, 'LocalState', 'AIY'),
    );
  }
  return roots;
}

export async function legacyUserDataRoots(options: {
  configuredRoot: string | null;
  currentUserDataRoot: string;
  appDataRoot: string;
  homeRoot: string;
}) {
  if (options.configuredRoot) return [path.resolve(options.configuredRoot)];
  const environmentAppData = absoluteEnvironmentPath(process.env.APPDATA);
  const environmentLocalAppData = absoluteEnvironmentPath(process.env.LOCALAPPDATA);
  const homeAppData = process.platform === 'win32' ? path.join(options.homeRoot, 'AppData') : null;
  const homeRoamingAppData = homeAppData ? path.join(homeAppData, 'Roaming') : null;
  const homeLocalAppData = homeAppData ? path.join(homeAppData, 'Local') : null;
  const candidates = [
    path.join(options.appDataRoot, 'AIY'),
    ...(environmentAppData ? [path.join(environmentAppData, 'AIY')] : []),
    ...(environmentLocalAppData ? [path.join(path.dirname(environmentLocalAppData), 'Roaming', 'AIY')] : []),
    ...(homeRoamingAppData ? [path.join(homeRoamingAppData, 'AIY')] : []),
    ...(await developmentPackageRoots(environmentLocalAppData)),
    ...(homeLocalAppData && (!environmentLocalAppData || pathKey(homeLocalAppData) !== pathKey(environmentLocalAppData))
      ? await developmentPackageRoots(homeLocalAppData)
      : []),
  ];
  const currentKey = pathKey(options.currentUserDataRoot);
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (containsTrash(candidate)) return false;
    const key = pathKey(candidate);
    if (key === currentKey || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
