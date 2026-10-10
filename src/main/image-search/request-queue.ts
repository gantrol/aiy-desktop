/** One running request and one latest replacement, with cooperative cancellation. */
export class SearchRequestQueue {
  private current: { id: string; controller: AbortController } | null = null;
  private waiting: { id: string; run(): void; cancel(): void } | null = null;

  run<T>(id: string, execute: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = async () => {
        const task = { id, controller: new AbortController() };
        this.current = task;
        try {
          const value = await execute(task.controller.signal);
          task.controller.signal.throwIfAborted();
          resolve(value);
        } catch (error) {
          reject(error);
        } finally {
          if (this.current === task) this.current = null;
          const next = this.waiting;
          this.waiting = null;
          next?.run();
        }
      };
      if (this.current) {
        this.current.controller.abort(new Error('CANCELLED'));
        this.waiting?.cancel();
        this.waiting = { id, run: () => void run(), cancel: () => reject(new Error('CANCELLED')) };
      } else void run();
    });
  }

  cancel(id: string) {
    if (this.current?.id === id) this.current.controller.abort(new Error('CANCELLED'));
    if (this.waiting?.id === id) {
      this.waiting.cancel();
      this.waiting = null;
    }
  }

  stop() {
    this.current?.controller.abort(new Error('CANCELLED'));
    this.waiting?.cancel();
    this.waiting = null;
  }
}
