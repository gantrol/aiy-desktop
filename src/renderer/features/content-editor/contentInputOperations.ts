/** Tracks imports through insertion, so navigation observes the same settled document as saving. */
export class ContentInputOperations {
  private readonly pending = new Set<Promise<void>>();
  private readonly listeners = new Set<() => void>();
  track = (operation: Promise<void>) => {
    this.pending.add(operation);
    this.notify();
    void operation
      .finally(() => {
        this.pending.delete(operation);
        this.notify();
      })
      .catch(() => undefined);
  };
  isPending = () => this.pending.size > 0;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private notify() {
    for (const listener of this.listeners) listener();
  }
  async settle() {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }
}
