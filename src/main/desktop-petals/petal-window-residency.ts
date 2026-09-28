import type { PetalWindow } from '@/main/desktop-petals/petal-windows';

/** Hidden views retain a short undo window, then release only after preservation succeeds. */
export class PetalWindowResidency {
  private hidden = new Map<PetalWindow, number>();
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private releasing = false;
  constructor(
    private readonly canRelease: (entry: PetalWindow) => boolean,
    private readonly preserve: (entry: PetalWindow) => Promise<boolean>,
  ) {}

  track(entry: PetalWindow) {
    entry.window.on('hide', () => {
      if (!this.canRelease(entry)) return;
      this.hidden.set(entry, Date.now() + 15_000);
      this.schedule();
    });
    const clear = () => {
      this.hidden.delete(entry);
      this.schedule();
    };
    entry.window.on('show', clear);
    entry.window.on('closed', clear);
  }

  private schedule() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.releasing || !this.hidden.size) return;
    const next = Math.min(...this.hidden.values());
    this.timer = setTimeout(() => void this.release(), Math.max(0, next - Date.now()));
    this.timer.unref();
  }

  private async release() {
    if (this.releasing) return;
    this.releasing = true;
    const generation = this.generation;
    // Preserve one editor at a time; no parallel flush storm during hide-all.
    for (const [entry, deadline] of [...this.hidden]) {
      if (deadline > Date.now()) continue;
      const current = () =>
        generation === this.generation &&
        this.hidden.get(entry) === deadline &&
        !entry.window.isDestroyed() &&
        !entry.window.isVisible() &&
        this.canRelease(entry);
      try {
        if (current() && (await this.preserve(entry)) && current()) entry.window.destroy();
      } catch (error) {
        console.error('[desktop-petals] idle preservation failed', error);
      }
      if (this.hidden.get(entry) === deadline) this.hidden.delete(entry);
    }
    this.releasing = false;
    this.schedule();
  }

  dispose() {
    this.generation++;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.hidden.clear();
  }
}
