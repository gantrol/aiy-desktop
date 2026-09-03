import type { ExtensionContributionPoint, ExtensionManifestDto } from '@/shared/contracts';
import {
  CODEX_HISTORY_SEARCH_EXTENSION_ID,
  CODEX_IMAGE_DISCOVERY_EXTENSION_ID,
  CODEX_VISUALIZATION_DISCOVERY_EXTENSION_ID,
  CODEX_VISUALIZATION_THREAD_CONTENT_PERMISSION,
  CODEX_USAGE_INVESTIGATOR_EXTENSION_ID,
  FEATURE_DEMO_EXTENSION_ID,
  NATURAL_WATERMARK_EXTENSION_ID,
  WEIBO_CHANNEL_EXTENSION_ID,
} from '@/shared/extension-ids';
import { EXTENSION_PERMISSION } from '@/shared/extension-permissions';

export const CODEX_IMAGE_DISCOVERY_HOST_RUNTIME_ID = 'codex-image-discovery';
export const CODEX_HISTORY_SEARCH_HOST_RUNTIME_ID = 'codex-history-search';
export const CODEX_VISUALIZATION_DISCOVERY_HOST_RUNTIME_ID = 'codex-visualization-discovery';
export const CODEX_USAGE_INVESTIGATOR_HOST_RUNTIME_ID = 'codex-usage-investigator';
export const FEATURE_DEMO_HOST_RUNTIME_ID = 'feature-demo';
export const ARTICLE_DELIVERY_HOST_RUNTIME_ID = 'article-draft-delivery';
export const WEIBO_BROWSER_HANDOFF_HOST_RUNTIME_ID = 'weibo-browser-handoff';
export const NATURAL_WATERMARK_HOST_RUNTIME_ID = 'natural-watermark';

export const CODEX_IMAGE_DISCOVERY_PERMISSIONS = [
  EXTENSION_PERMISSION.filesystemReadCodexGeneratedImages,
  EXTENSION_PERMISSION.libraryCreateCreations,
] as const;

export const CODEX_HISTORY_SEARCH_PERMISSIONS = [
  EXTENSION_PERMISSION.filesystemReadCodexSessionMetadata,
  EXTENSION_PERMISSION.filesystemReadCodexThreadContent,
] as const;

export const CODEX_VISUALIZATION_DISCOVERY_PERMISSIONS = [
  EXTENSION_PERMISSION.filesystemReadCodexVisualizations,
  EXTENSION_PERMISSION.filesystemReadCodexSessionMetadata,
] as const;

export const CODEX_VISUALIZATION_DISCOVERY_OPTIONAL_PERMISSIONS = [
  CODEX_VISUALIZATION_THREAD_CONTENT_PERMISSION,
] as const;

export const CODEX_USAGE_INVESTIGATOR_PERMISSIONS = [EXTENSION_PERMISSION.filesystemReadCodexSessionUsage] as const;

export const CODEX_USAGE_INVESTIGATOR_OPTIONAL_PERMISSIONS = [EXTENSION_PERMISSION.accountReadCodexRateLimits] as const;

export const CODEX_IMAGE_DISCOVERY_CONTRIBUTIONS: ExtensionManifestDto['contributes'] = {
  commands: ['codexImages.refresh'],
  workflows: ['codexImages.importGenerated', 'codexImages.recoverGeneration'],
  searchProviders: ['codex.generatedImages'],
};

export const CODEX_HISTORY_SEARCH_CONTRIBUTIONS: ExtensionManifestDto['contributes'] = {
  commands: ['codexHistory.refresh', 'codexHistory.rebuild'],
  workflows: ['codexHistory.search'],
  searchProviders: ['codex.threads'],
};

export const CODEX_VISUALIZATION_DISCOVERY_CONTRIBUTIONS: ExtensionManifestDto['contributes'] = {
  commands: [
    'codexVisualizations.refresh',
    'codexVisualizations.preview',
    'codexVisualizations.open',
    'codexVisualizations.reveal',
    'codexVisualizations.export',
  ],
  workflows: ['codexVisualizations.manage'],
  searchProviders: ['codex.visualizations'],
};

export const CODEX_USAGE_INVESTIGATOR_CONTRIBUTIONS: ExtensionManifestDto['contributes'] = {
  commands: ['codexUsage.scan', 'codexUsage.pause', 'codexUsage.resume', 'codexUsage.export'],
  workflows: ['codexUsage.investigate'],
};

const FEATURE_DEMO_CONTRIBUTIONS: ExtensionManifestDto['contributes'] = {
  commands: ['featureDemo.play', 'featureDemo.export2k'],
};

const WEIBO_BROWSER_HANDOFF_CONTRIBUTIONS: ExtensionManifestDto['contributes'] = {
  workflows: ['delivery.weibo.fillDraft'],
  deliveryChannels: ['weibo'],
};

const NATURAL_WATERMARK_CONTRIBUTIONS: ExtensionManifestDto['contributes'] = {
  filters: ['image.naturalWatermark'],
  workflows: ['browserCompanion.stageWatermarkedMedia'],
};

interface HostRuntimeContract {
  extensionId: string;
  permissions: readonly string[];
  optionalPermissions: readonly string[];
  contributes: ExtensionManifestDto['contributes'];
}

const hostRuntimeContracts: Readonly<Record<string, HostRuntimeContract>> = {
  [CODEX_HISTORY_SEARCH_HOST_RUNTIME_ID]: {
    extensionId: CODEX_HISTORY_SEARCH_EXTENSION_ID,
    permissions: CODEX_HISTORY_SEARCH_PERMISSIONS,
    optionalPermissions: [],
    contributes: CODEX_HISTORY_SEARCH_CONTRIBUTIONS,
  },
  [CODEX_IMAGE_DISCOVERY_HOST_RUNTIME_ID]: {
    extensionId: CODEX_IMAGE_DISCOVERY_EXTENSION_ID,
    permissions: CODEX_IMAGE_DISCOVERY_PERMISSIONS,
    optionalPermissions: [],
    contributes: CODEX_IMAGE_DISCOVERY_CONTRIBUTIONS,
  },
  [CODEX_VISUALIZATION_DISCOVERY_HOST_RUNTIME_ID]: {
    extensionId: CODEX_VISUALIZATION_DISCOVERY_EXTENSION_ID,
    permissions: CODEX_VISUALIZATION_DISCOVERY_PERMISSIONS,
    optionalPermissions: CODEX_VISUALIZATION_DISCOVERY_OPTIONAL_PERMISSIONS,
    contributes: CODEX_VISUALIZATION_DISCOVERY_CONTRIBUTIONS,
  },
  [CODEX_USAGE_INVESTIGATOR_HOST_RUNTIME_ID]: {
    extensionId: CODEX_USAGE_INVESTIGATOR_EXTENSION_ID,
    permissions: CODEX_USAGE_INVESTIGATOR_PERMISSIONS,
    optionalPermissions: CODEX_USAGE_INVESTIGATOR_OPTIONAL_PERMISSIONS,
    contributes: CODEX_USAGE_INVESTIGATOR_CONTRIBUTIONS,
  },
  [FEATURE_DEMO_HOST_RUNTIME_ID]: {
    extensionId: FEATURE_DEMO_EXTENSION_ID,
    permissions: [],
    optionalPermissions: [],
    contributes: FEATURE_DEMO_CONTRIBUTIONS,
  },
  [WEIBO_BROWSER_HANDOFF_HOST_RUNTIME_ID]: {
    extensionId: WEIBO_CHANNEL_EXTENSION_ID,
    permissions: [EXTENSION_PERMISSION.browserHandoffWeibo],
    optionalPermissions: [],
    contributes: WEIBO_BROWSER_HANDOFF_CONTRIBUTIONS,
  },
  [NATURAL_WATERMARK_HOST_RUNTIME_ID]: {
    extensionId: NATURAL_WATERMARK_EXTENSION_ID,
    permissions: [EXTENSION_PERMISSION.libraryReadSelectedReferences],
    optionalPermissions: [],
    contributes: NATURAL_WATERMARK_CONTRIBUTIONS,
  },
};

function validateArticleDeliveryRuntime(manifest: ExtensionManifestDto) {
  const configuration = manifest.configuration;
  if (configuration?.kind !== 'ARTICLE_DELIVERY') {
    throw new Error(`Runtime ${ARTICLE_DELIVERY_HOST_RUNTIME_ID} requires ARTICLE_DELIVERY configuration`);
  }
  const channels = manifest.contributes.deliveryChannels ?? [];
  if (
    channels.length !== 1 ||
    !sameContributions(manifest.contributes, {
      workflows: ['articleDelivery.uploadDraft'],
      deliveryChannels: channels,
    })
  ) {
    throw new Error(`Extension ${manifest.id} does not match the article delivery contribution contract`);
  }
  const credentialPermissions = manifest.permissions.filter((permission) => permission.startsWith('credentials.use:'));
  const expectedPermissions = [
    ...configuration.endpoints.map((endpoint) => `network:${endpoint.siteUrl}`),
    ...credentialPermissions,
  ];
  if (credentialPermissions.length !== 1 || !sameValues(manifest.permissions, expectedPermissions)) {
    throw new Error(`Extension ${manifest.id} does not match the article delivery permission contract`);
  }
  if (manifest.optionalPermissions.length) {
    throw new Error(`Extension ${manifest.id} article delivery runtime does not accept optional permissions`);
  }
}

function sameValues(actual: readonly string[], expected: readonly string[]) {
  if (actual.length !== expected.length) return false;
  if (new Set(actual).size !== actual.length) return false;
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
  if (runtimeId === ARTICLE_DELIVERY_HOST_RUNTIME_ID) {
    validateArticleDeliveryRuntime(manifest);
    return;
  }
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
