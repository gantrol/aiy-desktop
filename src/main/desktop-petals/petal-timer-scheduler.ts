import type { PetalLayoutStore } from '@/main/desktop-petals/petal-layout-store';
/** One main-process deadline; no renderer polling, duplicated notifications or auto-started cycles. */
export class PetalTimerScheduler {
  private timeout: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private readonly layouts: PetalLayoutStore,
    private readonly complete: (deadline: number) => Promise<void>,
  ) {}
  refresh() {
    this.dispose();
    const deadline = this.layouts.timer.endsAt;
    if (deadline === null) return;
    this.timeout = setTimeout(
      () => {
        this.timeout = null;
        void this.complete(deadline).catch((error) => console.error('[desktop-petals] timer completion failed', error));
      },
      Math.max(0, Math.min(2_147_483_647, deadline - Date.now())),
    );
    this.timeout.unref();
  }
  dispose() {
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
  }
}
