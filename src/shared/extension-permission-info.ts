import type { ExtensionDto, ExtensionPermissionDto } from '@/shared/contracts';
import { EXTENSION_PERMISSION, isExtensionPermissionTemplate } from '@/shared/extension-permissions';

export type ExtensionPermissionGroup = 'content' | 'files' | 'network' | 'credentials' | 'execution' | 'other';
export type ExtensionPermissionFilter = 'all' | 'missing' | 'granted' | 'optional' | 'runtime';
export type ExtensionPermissionName =
  keyof typeof EXTENSION_PERMISSION | 'network' | 'credentials' | 'template' | 'unknown';
export interface ExtensionPermissionRow extends ExtensionPermissionDto {
  template: boolean;
  group: ExtensionPermissionGroup;
  name: ExtensionPermissionName;
  scope: string;
}

const names = new Map<string, keyof typeof EXTENSION_PERMISSION>(
  Object.entries(EXTENSION_PERMISSION).map(([name, permission]) => [
    permission,
    name as keyof typeof EXTENSION_PERMISSION,
  ]),
);

export function extensionPermissionInfo(key: string) {
  const name = names.get(key);
  const template = isExtensionPermissionTemplate(key);
  let group: ExtensionPermissionGroup = 'other';
  if (key.startsWith('library.')) group = 'content';
  else if (key.startsWith('filesystem.')) group = 'files';
  else if (key.startsWith('network:')) group = 'network';
  else if (key.startsWith('credentials.')) group = 'credentials';
  else if (/^(process\.|integration\.|browser\.|codex\.)/u.test(key)) group = 'execution';
  return {
    group,
    name: (name ??
      (template
        ? 'template'
        : group === 'network'
          ? 'network'
          : group === 'credentials'
            ? 'credentials'
            : 'unknown')) as ExtensionPermissionName,
    scope: key.includes(':') ? key.slice(key.indexOf(':') + 1) : key,
    template,
  };
}

/** Templates describe an owner workflow; they are never wildcard grants. */
export function extensionPermissionRows(
  extension: Pick<ExtensionDto, 'manifest' | 'permissions'>,
): ExtensionPermissionRow[] {
  const rows = extension.permissions.map((permission) => ({
    ...permission,
    ...extensionPermissionInfo(permission.key),
  }));
  const present = new Set(rows.map((row) => row.key));
  for (const key of extension.manifest.optionalPermissions) {
    if (!isExtensionPermissionTemplate(key) || present.has(key)) continue;
    rows.push({ key, required: false, granted: false, runtimeScoped: false, ...extensionPermissionInfo(key) });
    present.add(key);
  }
  return rows;
}

export function permissionMatchesFilter(row: ExtensionPermissionRow, filter: ExtensionPermissionFilter) {
  if (filter === 'missing') return row.required && !row.granted;
  if (filter === 'granted') return row.granted && !row.template;
  if (filter === 'optional') return !row.required && !row.runtimeScoped && !row.template;
  if (filter === 'runtime') return row.runtimeScoped || row.template;
  return true;
}

export function visiblePermissionSelection(rows: readonly ExtensionPermissionRow[], selected: ReadonlySet<string>) {
  return rows.filter((row) => row.granted && !row.template && selected.has(row.key)).map((row) => row.key);
}

export type ExtensionListFilter = 'all' | 'enabled' | 'attention' | 'local';
export function extensionMatchesFilter(extension: ExtensionDto, filter: ExtensionListFilter) {
  if (filter === 'enabled') return extension.enabled;
  if (filter === 'local') return extension.source === 'LOCAL';
  if (filter === 'attention') return extension.enabled && extension.connectionState !== 'READY';
  return true;
}
