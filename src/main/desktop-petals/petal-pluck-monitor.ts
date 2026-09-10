import type { PetalWindow } from '@/main/desktop-petals/petal-windows';
import type { PetalInputMonitor } from '@/main/desktop-petals/petal-input-monitor';

/** Native release fallback for capture lost while the transparent flower changes bounds. */
export class PetalPluckMonitor {
  private active?: { entry: PetalWindow; token: string; stop(): void };
  constructor(private readonly input: PetalInputMonitor) {}
  watch(entry: PetalWindow, token: string, active: boolean) {
    if (!active) {
      if (this.active?.entry === entry && this.active.token === token) this.clear();
      return false;
    }
    if (!this.input.canWatchPointer) return false;
    this.clear();
    const send = (point: Electron.Point, released: boolean, cancelled = false) => {
      if (entry.window.isDestroyed()) return this.clear();
      entry.window.webContents.send('desktop-petals:pluck-pointer', { token, point, released, cancelled });
      if (released || cancelled) this.clear();
    };
    const stopPointer = this.input.watchPointer(send, () => send({ x: 0, y: 0 }, false, true));
    const timeout = setTimeout(() => send({ x: 0, y: 0 }, false, true), 60_000);
    const closed = () => this.clear();
    entry.window.once('closed', closed);
    this.active = {
      entry,
      token,
      stop: () => {
        stopPointer();
        clearTimeout(timeout);
        entry.window.removeListener('closed', closed);
      },
    };
    return true;
  }
  clear() {
    this.active?.stop();
    this.active = undefined;
  }
}
