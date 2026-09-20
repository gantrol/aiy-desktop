import type { ExtensionRegistry } from '@/main/extensions/registry';
import {
  extensionMetricQuerySchema,
  extensionMetricQueryResultSchema,
  extensionMetricRefreshSchema,
  extensionMetricRefreshResultSchema,
  extensionMetricSourcesSchema,
  type ExtensionMetricCoverage,
  type ExtensionMetricQuery,
  type ExtensionMetricQueryResult,
  type ExtensionMetricRefresh,
  type ExtensionMetricScope,
  type ExtensionMetricSource,
} from '@/shared/extension-metrics';

export interface MetricOperationContext {
  readonly spaceId: string;
  readonly scope: Readonly<ExtensionMetricScope>;
  readonly signal: AbortSignal;
  /** Call immediately before reading external credentials and before committing a refreshed cache. */
  assertActive(): void;
}

type SourceDescription = Pick<ExtensionMetricSource, 'scope' | 'notes'> & {
  unavailableReason?: 'UNCONFIGURED' | 'UNAVAILABLE' | null;
};

export type MetricProviderPage = Pick<
  ExtensionMetricQueryResult,
  'snapshot' | 'facts' | 'hasMore' | 'nextCursor' | 'coverage'
>;

/** Registered host code implements this protocol. Manifests cannot supply JS, SQL, paths or IPC names. */
export interface ExtensionMetricProvider {
  readonly id: string;
  readonly extensionId: string;
  readonly nameKey: string;
  readonly kinds: ExtensionMetricSource['kinds'];
  readonly requiredPermissions: readonly string[];
  readonly refreshPermissions?: readonly string[];
  readonly refreshMode: ExtensionMetricSource['refresh'];
  describe(spaceId: string): SourceDescription | Promise<SourceDescription>;
  /** Cache-only. It must not scan external directories or contact an account. */
  query(input: ExtensionMetricQuery, context: MetricOperationContext): MetricProviderPage | Promise<MetricProviderPage>;
  refresh?(input: ExtensionMetricRefresh, context: MetricOperationContext): Promise<ExtensionMetricCoverage>;
}

interface CurrentSpace {
  spaceId: string;
  /** The active database connection (not a newly allocated wrapper). */
  instance: object;
}

interface Options {
  extensions: ExtensionRegistry;
  currentSpace(): CurrentSpace;
}

export class ExtensionMetricsRegistry {
  private readonly providers = new Map<string, ExtensionMetricProvider>();

  constructor(private readonly options: Options) {}

  register(provider: ExtensionMetricProvider) {
    if (this.providers.has(provider.id)) throw new Error('Duplicate extension metric provider');
    this.providers.set(provider.id, provider);
    return this;
  }

  async listSources(expectedSpaceId: string): Promise<ExtensionMetricSource[]> {
    const current = this.current(expectedSpaceId);
    const sources = (
      await Promise.all(
        [...this.providers.values()].map(async (provider) => {
          const extension = this.options.extensions.get(provider.extensionId);
          if (!extension?.manifest.contributes.metricProviders?.includes(provider.id)) return null;
          const description = await provider.describe(current.spaceId);
          if (description.scope.kind === 'SPACE' && description.scope.id !== current.spaceId) {
            throw new Error('EXTENSION_METRICS_SCOPE_INVALID');
          }
          const missingPermissions = [...new Set(provider.requiredPermissions)].filter(
            (permission) => !this.options.extensions.isPermissionGranted(provider.extensionId, permission),
          );
          const activated = this.options.extensions.isActivated(provider.extensionId);
          const unavailableReason =
            !extension.enabled || !extension.compatible
              ? 'DISABLED'
              : missingPermissions.length || !activated
                ? 'PERMISSION_REQUIRED'
                : (description.unavailableReason ?? null);
          return {
            id: provider.id,
            extensionId: provider.extensionId,
            nameKey: provider.nameKey,
            kinds: provider.kinds,
            scope: description.scope,
            available: unavailableReason === null,
            unavailableReason,
            missingPermissions,
            refreshMissingPermissions: [...new Set(provider.refreshPermissions ?? [])].filter(
              (permission) => !this.options.extensions.isPermissionGranted(provider.extensionId, permission),
            ),
            refresh: provider.refreshMode,
            notes: description.notes,
          };
        }),
      )
    ).filter((source): source is ExtensionMetricSource => source !== null);
    return extensionMetricSourcesSchema.parse(sources);
  }

  async query(raw: unknown, expectedSpaceId: string): Promise<ExtensionMetricQueryResult> {
    const input = extensionMetricQuerySchema.parse(raw);
    const { provider, source, context } = await this.operation(input.sourceId, expectedSpaceId, false);
    const page = await provider.query(input, context);
    context.assertActive();
    const result = extensionMetricQueryResultSchema.parse({
      ...page,
      source,
      startAt: input.startAt,
      endAt: input.endAt,
      rangeMatch: 'OVERLAP',
    });
    if (input.snapshot && input.snapshot !== result.snapshot) throw new Error('EXTENSION_METRICS_CURSOR_STALE');
    if (result.facts.length > (input.limit ?? 100)) throw new Error('EXTENSION_METRICS_RESULT_INVALID');
    const ids = new Set<string>();
    for (const fact of result.facts) {
      const start = Date.parse(fact.period.startAt);
      const end = Date.parse(fact.period.endAt);
      const overlaps =
        start < Date.parse(input.endAt) &&
        (start === end ? start >= Date.parse(input.startAt) : end > Date.parse(input.startAt));
      if (
        ids.has(fact.id) ||
        !provider.kinds.includes(fact.kind) ||
        (input.kinds && !input.kinds.includes(fact.kind)) ||
        !overlaps
      ) {
        throw new Error('EXTENSION_METRICS_RESULT_INVALID');
      }
      ids.add(fact.id);
    }
    return result;
  }

  async refresh(raw: unknown, expectedSpaceId: string) {
    const input = extensionMetricRefreshSchema.parse(raw);
    const { provider, source, context } = await this.operation(input.sourceId, expectedSpaceId, true);
    if (!provider.refresh || provider.refreshMode === 'NONE') throw new Error('EXTENSION_METRICS_REFRESH_UNSUPPORTED');
    const coverage = await provider.refresh(input, context);
    context.assertActive();
    return extensionMetricRefreshResultSchema.parse({ source, refreshedAt: new Date().toISOString(), coverage });
  }

  private current(expectedSpaceId: string) {
    const current = this.options.currentSpace();
    if (typeof expectedSpaceId !== 'string' || !expectedSpaceId || current.spaceId !== expectedSpaceId) {
      throw new Error('EXTENSION_METRICS_SPACE_CHANGED');
    }
    return current;
  }

  private async operation(sourceId: string, expectedSpaceId: string, refreshing: boolean) {
    const current = this.current(expectedSpaceId);
    const provider = this.providers.get(sourceId);
    const source = (await this.listSources(expectedSpaceId)).find((item) => item.id === sourceId);
    if (!provider || !source) throw new Error('EXTENSION_METRICS_SOURCE_UNAVAILABLE');
    const permissions = [...provider.requiredPermissions, ...(refreshing ? (provider.refreshPermissions ?? []) : [])];
    const extension = this.options.extensions.get(provider.extensionId);
    const accessStamp = JSON.stringify([extension?.updatedAt, extension?.enabled, extension?.permissions]);
    const signal = AbortSignal.timeout(60_000);
    const assertActive = () => {
      signal.throwIfAborted();
      const next = this.current(expectedSpaceId);
      if (next.instance !== current.instance) throw new Error('EXTENSION_METRICS_SPACE_CHANGED');
      const fresh = this.options.extensions.get(provider.extensionId);
      if (
        !this.options.extensions.isActivated(provider.extensionId) ||
        !fresh?.manifest.contributes.metricProviders?.includes(provider.id) ||
        permissions.some(
          (permission) => !this.options.extensions.isPermissionGranted(provider.extensionId, permission),
        ) ||
        accessStamp !== JSON.stringify([fresh?.updatedAt, fresh?.enabled, fresh?.permissions])
      ) {
        throw new Error('EXTENSION_METRICS_PERMISSION_REQUIRED');
      }
      if (!source.available) throw new Error('EXTENSION_METRICS_SOURCE_UNAVAILABLE');
    };
    const context: MetricOperationContext = {
      spaceId: current.spaceId,
      scope: Object.freeze({ ...source.scope }),
      signal,
      assertActive,
    };
    assertActive();
    return { provider, source, context };
  }
}
