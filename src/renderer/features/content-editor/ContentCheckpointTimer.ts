/** Debounce checkpoints without postponing durability indefinitely during continuous typing. */
export class ContentCheckpointTimer {
  private idle: ReturnType<typeof setTimeout> | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private callback: (() => void) | null = null;

  get pending() {
    return this.callback !== null;
  }

  schedule(callback: () => void, idleMs: number, maxWaitMs = 2_000) {
    this.callback = callback;
    if (this.idle !== null) clearTimeout(this.idle);
    this.idle = setTimeout(this.run, idleMs);
    this.deadline ??= setTimeout(this.run, maxWaitMs);
  }

  private run = () => {
    const callback = this.callback;
    this.cancel();
    callback?.();
  };

  cancel() {
    if (this.idle !== null) clearTimeout(this.idle);
    if (this.deadline !== null) clearTimeout(this.deadline);
    this.idle = null;
    this.deadline = null;
    this.callback = null;
  }
}
