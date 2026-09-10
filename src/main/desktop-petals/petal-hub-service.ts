import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import { PetalLayoutStore } from '@/main/desktop-petals/petal-layout-store';
import { petalHubSettingsSchema, petalTimerActionSchema, type PetalQuota } from '@/shared/contracts/petal-hub';
import { petalError } from '@/shared/petal-errors';
import { changePetalTimer } from '@/shared/petal-timer';
import { PetalTimerScheduler } from '@/main/desktop-petals/petal-timer-scheduler';

const empty = (state: PetalQuota['state'], messageCode: NonNullable<PetalQuota['messageCode']>): PetalQuota => ({
  state,
  message: '',
  messageCode,
  capturedAt: null,
  primary: null,
  secondary: null,
  limits: [],
});

/** Hub settings are machine-local; quota reads reuse the library's existing Codex service and permissions. */
export class PetalHubService {
  private writes: Promise<void> = Promise.resolve();
  readonly scheduler: PetalTimerScheduler;
  constructor(
    readonly layouts: PetalLayoutStore,
    private readonly onComplete?: (phase: 'focus' | 'break') => void,
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
      const previous = this.layouts.hubSettings;
      settings.codexLimitId = previous.codexLimitId;
      const durationChanged =
        settings.focusMinutes !== previous.focusMinutes || settings.breakMinutes !== previous.breakMinutes;
      if (durationChanged && this.layouts.timer.endsAt !== null) throw petalError('pauseTimer');
      const timer = durationChanged
        ? changePetalTimer(this.layouts.timer, 'reset', settings, Date.now())
        : this.layouts.timer;
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
    if (this.layouts.hubSettings.mode !== 'codex') return Promise.resolve(empty('unavailable', 'notSelected'));
    return context.codexContent.quota.read(this.layouts.hubSettings.codexLimitId);
  }
}
