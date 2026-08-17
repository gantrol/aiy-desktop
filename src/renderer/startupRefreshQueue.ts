export interface TrailingRefreshQueue<Key> {
  requested: boolean;
  running: Promise<void> | null;
  synchronized: boolean;
  synchronizedKey: Key | undefined;
}

export function createTrailingRefreshQueue<Key>(): TrailingRefreshQueue<Key> {
  return {
    requested: false,
    running: null,
    synchronized: false,
    synchronizedKey: undefined,
  };
}

/** Coalesce invalidations that arrive during a load into one trailing refresh. */
export function requestTrailingRefresh<Key>(queue: TrailingRefreshQueue<Key>, load: () => Promise<unknown>) {
  queue.requested = true;
  if (!queue.running) {
    queue.running = (async () => {
      try {
        while (queue.requested) {
          queue.requested = false;
          await load();
        }
      } finally {
        queue.running = null;
      }
    })();
  }
  return queue.running;
}

/**
 * Synchronize declarative state once per observed key. React StrictMode replays
 * effects with the same key, which should share the first load rather than
 * being interpreted as a second invalidation.
 */
export function synchronizeRefresh<Key>(queue: TrailingRefreshQueue<Key>, key: Key, load: () => Promise<unknown>) {
  if (queue.synchronized && Object.is(queue.synchronizedKey, key)) {
    return queue.running ?? Promise.resolve();
  }
  queue.synchronized = true;
  queue.synchronizedKey = key;
  return requestTrailingRefresh(queue, load);
}
