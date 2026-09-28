import type { PetalWindow } from '@/main/desktop-petals/petal-windows';
import type { PetalNativeVisibilityState } from '@/main/desktop-petals/petal-native-visibility';

/** System transitions are independent of saved placement and editor lifetime. */
export class PetalDesktopRecovery {
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private readonly candidates: () => PetalWindow[],
    private readonly sample: (handles: readonly string[]) => Promise<Map<string, PetalNativeVisibilityState> | null>,
    private readonly record: (details: object) => void,
  ) {}
  request(reason: string) {
    const generation = ++this.generation;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.reconcile(generation, reason, 0), 50);
  }
  private async reconcile(generation: number, reason: string, attempt: number) {
    const started = performance.now();
    try {
      const entries = this.candidates();
      if (!entries.length || generation !== this.generation) return;
      const handles = entries.map((entry) => {
        const bytes = entry.window.getNativeWindowHandle();
        return bytes.length >= 8 ? bytes.readBigUInt64LE().toString() : bytes.readUInt32LE().toString();
      });
      // Bounded batches share one helper and preserve cancellation between batches.
      let repaired = 0,
        unavailable = 0;
      for (let start = 0; start < handles.length; start += 128) {
        const states = await this.sample(handles.slice(start, start + 128));
        if (generation !== this.generation) return;
        const eligible = new Set(this.candidates());
        for (let index = start; index < Math.min(start + 128, handles.length); index++) {
          const entry = entries[index],
            state = states?.get(handles[index]);
          if (!eligible.has(entry) || entry.window.isDestroyed()) continue;
          if (!state) {
            unavailable++;
            continue;
          }
          // DWM cloaking includes windows on another virtual desktop. Never
          // pull those windows into the current desktop as a side effect.
          if (state.cloaked || (state.visible && state.topmost && !state.minimized && !state.desktopOccluded)) continue;
          entry.window.showInactive();
          if (!state.topmost) entry.window.setAlwaysOnTop(true, 'normal');
          entry.window.moveTop();
          repaired++;
        }
      }
      this.record({
        reason,
        attempt,
        candidates: entries.length,
        repaired,
        unavailable,
        durationMs: Math.round(performance.now() - started),
      });
      // Verify once and repair only remaining mismatches. No second unconditional pass.
      if ((repaired || unavailable) && attempt === 0 && generation === this.generation)
        this.timer = setTimeout(() => void this.reconcile(generation, reason, 1), 200);
    } catch (error) {
      this.record({ reason, attempt, failed: true, error: String(error).slice(0, 200) });
    }
  }
  dispose() {
    this.generation++;
    clearTimeout(this.timer);
  }
}
