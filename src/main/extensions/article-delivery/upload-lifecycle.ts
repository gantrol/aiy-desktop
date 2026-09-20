function interruptedUpload() {
  return Object.assign(
    new Error('Upload stopped locally. Check the destination before retrying; the remote request may have completed.'),
    { code: 'DELIVERY_INTERRUPTED' },
  );
}

/** Connection loading only reads user-level configuration; cancellation can stop the local wait. */
export function waitForUploadPreparation<T>(operation: Promise<T>, signal: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      complete();
    };
    const onAbort = () => finish(() => reject(signal.reason));
    operation.then(
      (value) => finish(() => resolve(value)),
      (reason) => finish(() => reject(reason)),
    );
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** One library context owns both queued uploads and legacy direct requests. */
export class ArticleDeliveryUploadLifecycle {
  private accepting = true;
  private readonly active = new Set<AbortController>();
  private readonly idleWaiters = new Set<() => void>();

  acquire() {
    if (!this.accepting) throw interruptedUpload();
    const controller = new AbortController();
    this.active.add(controller);
    return {
      signal: controller.signal,
      release: () => {
        if (!this.active.delete(controller) || this.active.size) return;
        for (const resolve of this.idleWaiters) resolve();
        this.idleWaiters.clear();
      },
    };
  }

  stopAndDrain() {
    this.accepting = false;
    const reason = interruptedUpload();
    for (const controller of this.active) controller.abort(reason);
    if (!this.active.size) return Promise.resolve();
    return new Promise<void>((resolve) => this.idleWaiters.add(resolve));
  }

  resume() {
    this.accepting = true;
  }
}
