import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { Locale } from '@/shared/contracts';
import { PetalLayoutStore } from '@/main/desktop-petals/petal-layout-store';
import { petalHubSettingsSchema, petalTimerActionSchema, type PetalQuota } from '@/shared/contracts/petal-hub';
import { changePetalTimer, normalizePetalTimer } from '@/shared/petal-timer';
import { PetalTimerScheduler } from '@/main/desktop-petals/petal-timer-scheduler';
import { FlowerCenterProviderRegistry } from '@/main/desktop-petals/flower-center-provider-registry';

/** Hub settings are machine-local; contributed center data reuses existing extension permissions. */
export class PetalHubService {
  private writes: Promise<void> = Promise.resolve();
  private readonly centers = new FlowerCenterProviderRegistry();
  readonly scheduler: PetalTimerScheduler;
  constructor(
    readonly layouts: PetalLayoutStore,
    private readonly onComplete?: (phase: 'focus' | 'break') => void,
    private readonly locale: () => Locale = () => 'en',
  ) {
    this.scheduler = new PetalTimerScheduler(layouts, (deadline) =>
      this.enqueue(async () => {
        const timer = layouts.timer;
        if (timer.endsAt !== deadline || deadline > Date.now()) return;
        await layouts.saveHub(layouts.hubSettings, { ...timer, endsAt: null, remainingMs: 0 });
        this.onComplete?.(timer.phase);
      }),
    );
  }
  private enqueue(write: () => Promise<void>) {
    this.writes = this.writes.catch(() => undefined).then(write);
    return this.writes;
  }
  configure(raw: unknown) {
    const settings = petalHubSettingsSchema.parse(raw);
    return this.enqueue(async () => {
      const timer = normalizePetalTimer(this.layouts.timer, this.layouts.hubSettings);
      await this.layouts.saveHub(settings, timer);
      this.scheduler.refresh();
    });
  }
  timerAction(raw: unknown) {
    const action = petalTimerActionSchema.parse(raw);
    return this.enqueue(async () => {
      await this.layouts.saveHub(
        this.layouts.hubSettings,
        changePetalTimer(this.layouts.timer, action, this.layouts.hubSettings, Date.now()),
      );
      this.scheduler.refresh();
    });
  }
  configureQuota(limitId: string | null) {
    return this.enqueue(() =>
      this.layouts.saveHub({ ...this.layouts.hubSettings, codexLimitId: limitId }, this.layouts.timer),
    );
  }
  quota(context: ActiveLibraryContext): Promise<PetalQuota> {
    return this.centers.read(context, this.layouts.hubSettings, this.locale());
  }
}
