import type { Rectangle } from 'electron';
import { randomUUID } from 'node:crypto';
import type { PetalWindow } from '@/main/desktop-petals/petal-windows';

/** One short-lived collection undo; editor content and its undo stack are independent. */
export class PetalCollectionHistory {
  private last?: { entry: PetalWindow; bounds: Rectangle; token: string; expiresAt: number };
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private readonly changed: () => void,
    private readonly canRestore: (entry: PetalWindow) => boolean,
  ) {}
  record(entry: PetalWindow, bounds: Rectangle) {
    this.clear();
    this.last = { entry, bounds, token: randomUUID(), expiresAt: Date.now() + 10_000 };
    this.timer = setTimeout(() => this.clear(), 10_000);
    this.changed();
  }
  current(libraryId: string) {
    const last = this.last;
    if (
      !last ||
      last.entry.libraryId !== libraryId ||
      last.expiresAt <= Date.now() ||
      last.entry.window.isDestroyed() ||
      last.entry.window.isVisible() ||
      last.entry.expanded ||
      !this.canRestore(last.entry)
    )
      return null;
    return last;
  }
  clear(entry?: PetalWindow) {
    if (entry && this.last?.entry !== entry) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    const previous = this.last;
    this.last = undefined;
    if (previous) this.changed();
  }
}
