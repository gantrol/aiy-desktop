import type { ProviderConnectionDto, ProviderConnectionSaveInput } from '@/shared/contracts/provider-connections';

export interface ProviderConnectionAdapter {
  readonly connectionId: string;
  snapshot(): ProviderConnectionDto;
  save(input: ProviderConnectionSaveInput): Promise<ProviderConnectionDto>;
  verify(): Promise<ProviderConnectionDto>;
  remove(): Promise<ProviderConnectionDto>;
}

/** Host-owned control plane for provider connection configuration. */
export class ProviderConnectionRegistry {
  private readonly adapters: ReadonlyMap<string, ProviderConnectionAdapter>;

  constructor(adapters: readonly ProviderConnectionAdapter[]) {
    const byId = new Map<string, ProviderConnectionAdapter>();
    for (const adapter of adapters) {
      if (byId.has(adapter.connectionId)) {
        throw new Error(`Duplicate provider connection adapter: ${adapter.connectionId}`);
      }
      byId.set(adapter.connectionId, adapter);
    }
    this.adapters = byId;
  }

  list() {
    return [...this.adapters.values()].map((adapter) => adapter.snapshot());
  }

  save(input: ProviderConnectionSaveInput) {
    return this.require(input.connectionId).save(input);
  }

  verify(connectionId: string) {
    return this.require(connectionId).verify();
  }

  remove(connectionId: string) {
    return this.require(connectionId).remove();
  }

  private require(connectionId: string) {
    const adapter = this.adapters.get(connectionId);
    if (!adapter) throw new Error(`Unknown provider connection: ${connectionId}`);
    return adapter;
  }
}
