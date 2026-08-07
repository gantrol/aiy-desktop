export type LibraryContextState = 'READY' | 'ACTIVE' | 'DRAINING' | 'DISPOSED';

/**
 * Process-local lease barrier for one library context. Acquiring and claiming
 * are synchronous, so a transition cannot race a new operation across its
 * first await.
 */
export class LibraryContextLifecycle {
  private currentState: LibraryContextState = 'READY';
  private activeOperationCount = 0;
  private readonly idleWaiters = new Set<() => void>();
  private disposal: Promise<void> | null = null;

  get state() {
    return this.currentState;
  }

  activate() {
    if (this.currentState !== 'READY') throw new Error('Local-space context cannot be activated');
    this.currentState = 'ACTIVE';
  }

  acquireOperation() {
    if (this.currentState !== 'ACTIVE') {
      throw new Error('The active local space is changing; retry after the transition finishes');
    }
    this.activeOperationCount += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeOperationCount = Math.max(0, this.activeOperationCount - 1);
      if (this.activeOperationCount !== 0) return;
      for (const resolve of this.idleWaiters) resolve();
      this.idleWaiters.clear();
    };
  }

  async drain() {
    if (this.currentState === 'DISPOSED') return;
    this.currentState = 'DRAINING';
    await this.waitForOperations();
  }

  resume() {
    if (this.currentState === 'DRAINING' && !this.disposal) this.currentState = 'ACTIVE';
  }

  dispose(cleanup: () => void | Promise<void>) {
    if (this.disposal) return this.disposal;
    this.currentState = 'DRAINING';
    this.disposal = (async () => {
      await this.waitForOperations();
      try {
        await cleanup();
      } finally {
        this.currentState = 'DISPOSED';
      }
    })();
    return this.disposal;
  }

  private waitForOperations() {
    if (this.activeOperationCount === 0) return Promise.resolve();
    return new Promise<void>((resolve) => this.idleWaiters.add(resolve));
  }
}
