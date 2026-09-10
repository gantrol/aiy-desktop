import type { RecordedLibraryChange } from '@/main/database/core/storage';

/** Deferred invalidation, not a commit log: subscribers must read committed state (including after rollback). */
export class LibraryChangeSignal {
  private listeners = new Set<(changes: readonly RecordedLibraryChange[]) => void>();
  private pending = new Map<string, RecordedLibraryChange>();
  subscribe(listener: (changes: readonly RecordedLibraryChange[]) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  record(change: RecordedLibraryChange) {
    if (!this.listeners.size) return;
    const scheduled = this.pending.size > 0;
    this.pending.set(`${change.entityType}:${change.entityId}`, change);
    if (!scheduled) queueMicrotask(() => this.publish());
  }
  private publish() {
    const changes = [...this.pending.values()];
    this.pending.clear();
    if (!changes.length) return;
    for (const listener of this.listeners) {
      try {
        listener(changes);
      } catch (error) {
        console.error('[library-change] subscriber failed', error);
      }
    }
  }
  clear() {
    this.listeners.clear();
    this.pending.clear();
  }
}
