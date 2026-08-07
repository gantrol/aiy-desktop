import type { ExtensionContributionPoint, ExtensionManifestDto } from '@/shared/contracts';
import { CODEX_IMAGE_DISCOVERY_EXTENSION_ID } from '@/shared/extension-ids';

export const CODEX_IMAGE_DISCOVERY_HOST_RUNTIME_ID = 'codex-image-discovery';

export const CODEX_IMAGE_DISCOVERY_PERMISSIONS = [
  'filesystem.read:codex-generated-images',
  'library.write:creations',
] as const;

const CODEX_IMAGE_DISCOVERY_CONTRIBUTIONS: ExtensionManifestDto['contributes'] = {
  commands: ['codexImages.refresh'],
  workflows: ['codexImages.importGenerated'],
  searchProviders: ['codex.generatedImages'],
};

interface HostRuntimeContract {
  extensionId: string;
  permissions: readonly string[];
  optionalPermissions: readonly string[];
  contributes: ExtensionManifestDto['contributes'];
}

const hostRuntimeContracts: Readonly<Record<string, HostRuntimeContract>> = {
  [CODEX_IMAGE_DISCOVERY_HOST_RUNTIME_ID]: {
    extensionId: CODEX_IMAGE_DISCOVERY_EXTENSION_ID,
    permissions: CODEX_IMAGE_DISCOVERY_PERMISSIONS,
    optionalPermissions: [],
    contributes: CODEX_IMAGE_DISCOVERY_CONTRIBUTIONS,
  },
};

function sameValues(actual: readonly string[], expected: readonly string[]) {
  if (actual.length !== expected.length) return false;
  const expectedValues = new Set(expected);
  return actual.every((value) => expectedValues.has(value));
}

function sameContributions(actual: ExtensionManifestDto['contributes'], expected: ExtensionManifestDto['contributes']) {
  const points = new Set<ExtensionContributionPoint>([
    ...(Object.keys(actual) as ExtensionContributionPoint[]),
    ...(Object.keys(expected) as ExtensionContributionPoint[]),
  ]);
  return [...points].every((point) => sameValues(actual[point] ?? [], expected[point] ?? []));
}

/** Fails closed: packaged capabilities can only bind to an exact host-owned runtime contract. */
export function validatePackagedCapabilityRuntime(manifest: ExtensionManifestDto) {
  const runtimeId = manifest.runtime?.kind === 'HOST' ? manifest.runtime.id : '';
  const contract = hostRuntimeContracts[runtimeId];
  if (!contract) throw new Error(`Unsupported packaged capability runtime: ${runtimeId || 'missing'}`);
  if (manifest.id !== contract.extensionId) {
    throw new Error(`Runtime ${runtimeId} is reserved for extension ${contract.extensionId}`);
  }
  if (!sameValues(manifest.permissions, contract.permissions)) {
    throw new Error(`Extension ${manifest.id} does not match the host runtime permission contract`);
  }
  if (!sameValues(manifest.optionalPermissions, contract.optionalPermissions)) {
    throw new Error(`Extension ${manifest.id} does not match the host runtime optional permission contract`);
  }
  if (!sameContributions(manifest.contributes, contract.contributes)) {
    throw new Error(`Extension ${manifest.id} does not match the host runtime contribution contract`);
  }
  if (manifest.configuration) {
    throw new Error(`Host runtime extension ${manifest.id} cannot declare a separate configuration protocol`);
  }
}
