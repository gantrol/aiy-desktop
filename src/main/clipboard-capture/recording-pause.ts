import type { ClipboardPause, ClipboardPauseDuration } from '@/shared/contracts/clipboard-capture';

/** A pause belongs to the running app, not a window, library or persisted recording switch. */
export class ClipboardRecordingPause {
  private value: ClipboardPause | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly changed: () => void) {}

  get state() {
    return this.value;
  }

  pause(duration: ClipboardPauseDuration) {
    this.clearTimer();
    this.value =
      duration === 'untilRestart'
        ? { kind: 'untilRestart' }
        : { kind: 'timed', until: new Date(Date.now() + duration * 60_000).toISOString() };
    this.checkExpiry();
    this.changed();
  }

  resume() {
    this.clearTimer();
    this.value = null;
    this.changed();
  }

  // Recheck after system wake, and reschedule if the wall clock moved backwards.
  checkExpiry() {
    this.clearTimer();
    if (this.value?.kind !== 'timed') return;
    const remaining = Date.parse(this.value.until) - Date.now();
    if (remaining <= 0) {
      this.resume();
      return;
    }
    this.timer = setTimeout(() => this.checkExpiry(), Math.min(remaining, 600_000));
    this.timer.unref();
  }

  dispose() {
    this.clearTimer();
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
