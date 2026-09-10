import type { CodexService } from '@/main/assistant/codex-service';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import { CODEX_EXTENSION_ID } from '@/shared/extension-ids';
import { EXTENSION_PERMISSION } from '@/shared/extension-permissions';
import type { PetalQuota } from '@/shared/contracts/petal-hub';

const empty = (state: PetalQuota['state'], messageCode: NonNullable<PetalQuota['messageCode']>): PetalQuota => ({
  state,
  message: '',
  messageCode,
  capturedAt: null,
  primary: null,
  secondary: null,
  limits: [],
});
/** The Codex plugin contributes quota data; the flower only renders the selected contribution. */
export class CodexPetalQuota {
  private cache: { id: string | null; until: number; result: Promise<PetalQuota> } | null = null;
  constructor(
    private readonly codex: CodexService,
    private readonly extensions: ExtensionRegistry,
  ) {}
  read(selectedId: string | null): Promise<PetalQuota> {
    if (
      !this.extensions.isActivated(CODEX_EXTENSION_ID) ||
      !this.extensions.isPermissionGranted(CODEX_EXTENSION_ID, EXTENSION_PERMISSION.accountReadCodexRateLimits)
    ) {
      this.cache = null;
      return Promise.resolve(empty('permission-required', 'permissionRequired'));
    }
    if (this.cache?.id === selectedId && this.cache.until > Date.now()) return this.cache.result;
    const result = this.fetch(selectedId);
    this.cache = { id: selectedId, until: Date.now() + 60000, result };
    return result;
  }
  private async fetch(selectedId: string | null): Promise<PetalQuota> {
    if (!this.codex.readUsageQuota) return empty('unavailable', 'unavailable');
    try {
      const quota = await this.codex.readUsageQuota(AbortSignal.timeout(6000));
      const limits = quota.limits.map((limit, index) => ({
        id: limit.limitId ?? `default-${index}`,
        name: limit.limitName ?? limit.limitId ?? '',
      }));
      const selected = selectedId
        ? limits.findIndex((limit) => limit.id === selectedId)
        : quota.limits.findIndex((limit) => limit.limitId === 'codex');
      const limit =
        selected >= 0 ? quota.limits[selected] : !selectedId && quota.limits.length === 1 ? quota.limits[0] : null;
      if (!limit) return { ...empty('select-limit', 'selectLimit'), capturedAt: quota.capturedAt, limits };
      const project = (window: typeof limit.primary) =>
        window
          ? {
              remaining: Math.min(100, Math.max(0, 100 - window.usedPercent)),
              durationMins: window.windowDurationMins,
              resetsAt: window.resetsAt,
            }
          : null;
      if (!limit.primary && !limit.secondary)
        return { ...empty('unavailable', 'noData'), capturedAt: quota.capturedAt, limits };
      return {
        state: 'ready',
        message: '',
        messageCode: 'remaining',
        capturedAt: quota.capturedAt,
        limits,
        primary: project(limit.primary),
        secondary: project(limit.secondary),
      };
    } catch {
      return empty('unavailable', 'unavailable');
    }
  }
}
