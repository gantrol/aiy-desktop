import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { Locale } from '@/shared/contracts';
import type { PetalHubSettings, PetalQuota } from '@/shared/contracts/petal-hub';
import { CODEX_PETAL_CENTER_PROVIDER_ID } from '@/shared/contracts/petal-hub';
import { CODEX_EXTENSION_ID } from '@/shared/extension-ids';
import { localizeExtensionManifest } from '@/shared/extension-localization';
import { CODEX_QUOTA_METRIC_PROVIDER_ID } from '@/shared/extension-metrics';

type FlowerCenterProviders = NonNullable<PetalQuota['providers']>;

export interface FlowerCenterProviderAdapter {
  id: string;
  extensionId: string;
  contributionId: string;
  read(context: ActiveLibraryContext, settings: PetalHubSettings): Promise<PetalQuota>;
}

const codexQuotaAdapter: FlowerCenterProviderAdapter = {
  id: CODEX_PETAL_CENTER_PROVIDER_ID,
  extensionId: CODEX_EXTENSION_ID,
  contributionId: CODEX_QUOTA_METRIC_PROVIDER_ID,
  read: (context, settings) => context.codexContent.quota.read(settings.codexLimitId),
};

function empty(messageCode: 'notSelected' | 'unavailable', providers: FlowerCenterProviders): PetalQuota {
  return {
    state: 'unavailable',
    message: '',
    messageCode,
    capturedAt: null,
    primary: null,
    secondary: null,
    limits: [],
    providers,
  };
}

/**
 * Flower-center plugins contribute stable metric identifiers; trusted host adapters
 * turn those metrics into the bounded center snapshot. Manifests never inject UI or IPC names.
 */
export class FlowerCenterProviderRegistry {
  private readonly adapters = new Map<string, FlowerCenterProviderAdapter>();

  constructor(adapters: readonly FlowerCenterProviderAdapter[] = [codexQuotaAdapter]) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.id)) throw new Error(`Duplicate flower center provider: ${adapter.id}`);
      this.adapters.set(adapter.id, adapter);
    }
  }

  list(context: ActiveLibraryContext, locale: Locale): FlowerCenterProviders {
    const extensions = new Map(context.extensions.list().map((extension) => [extension.manifest.id, extension]));
    return [...this.adapters.values()].flatMap((adapter) => {
      const extension = extensions.get(adapter.extensionId);
      if (!extension?.compatible || !extension.manifest.contributes.metricProviders?.includes(adapter.contributionId))
        return [];
      return [{ id: adapter.id, name: localizeExtensionManifest(extension.manifest, locale).displayName }];
    });
  }

  async read(context: ActiveLibraryContext, settings: PetalHubSettings, locale: Locale): Promise<PetalQuota> {
    const providers = this.list(context, locale);
    const adapter = this.adapters.get(settings.mode);
    if (!adapter) return empty('notSelected', providers);
    if (!providers.some((provider) => provider.id === adapter.id)) return empty('unavailable', providers);
    const result = await adapter.read(context, settings);
    return { ...result, providers };
  }
}
