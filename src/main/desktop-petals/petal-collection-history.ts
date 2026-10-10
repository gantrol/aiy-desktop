import type { Rectangle } from 'electron';
import { randomUUID } from 'node:crypto';
import type { PetalWindow } from '@/main/desktop-petals/petal-windows';

/** One short-lived collection undo; editor content and its undo stack are independent. */
export class PetalCollectionHistory {
  private last?: {
    entry: PetalWindow;
    libraryId: string;
    bounds: Rectangle;
    expanded: boolean;
    token: string;
    expiresAt: number;
  };
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private readonly changed: () => void,
    private readonly canRestore: (entry: PetalWindow) => boolean,
  ) {}
  record(entry: PetalWindow, bounds: Rectangle, libraryId = entry.libraryId) {
    this.clear();
    // Undo belongs to the receiving flower; temporary content keeps its own library identity.
    this.last = {
      entry,
      libraryId,
      bounds,
      expanded: entry.expanded,
      token: randomUUID(),
      expiresAt: Date.now() + 10_000,
    };
    this.timer = setTimeout(() => this.clear(), 10_000);
    this.changed();
  }
  current(libraryId: string) {
    const last = this.last;
    if (
      !last ||
      last.libraryId !== libraryId ||
      last.expiresAt <= Date.now() ||
      last.entry.window.isDestroyed() ||
      last.entry.window.isVisible() ||
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
