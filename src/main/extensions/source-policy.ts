import type { ExtensionManifestDto, ExtensionSource } from '@/shared/contracts';
import { BUILTIN_TOOL_RUNTIMES, isBuiltinToolExtension } from '@/shared/builtin-tools';

const reservedRuntimes = new Set(Object.values(BUILTIN_TOOL_RUNTIMES));

export class ReservedExtensionIdentityError extends Error {
  constructor() {
    super('Extension identity is reserved for an AIY built-in capability');
  }
}

export function isExtensionSourceAllowed(manifest: ExtensionManifestDto, source: ExtensionSource | undefined) {
  const claimsIdentity =
    Object.hasOwn(BUILTIN_TOOL_RUNTIMES, manifest.id) || reservedRuntimes.has(manifest.runtime?.id ?? '');
  return !claimsIdentity || (source !== undefined && isBuiltinToolExtension({ manifest, source }));
}

export function assertExtensionSource(manifest: ExtensionManifestDto, source: ExtensionSource) {
  if (!isExtensionSourceAllowed(manifest, source)) throw new ReservedExtensionIdentityError();
}
