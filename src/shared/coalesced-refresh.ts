/** At most one refresh in flight and one follow-up, even during an event burst. */
export function createCoalescedRefresh(refresh: () => Promise<void>, onError: (error: unknown) => void) {
  let running = false;
  let requested = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = async () => {
    timer = undefined;
    if (disposed || running || !requested) return;
    requested = false;
    running = true;
    try {
      await refresh();
    } catch (error) {
      if (!disposed) onError(error);
    } finally {
      running = false;
      if (requested && !disposed) request();
    }
  };
  const request = () => {
    if (disposed) return;
    requested = true;
    if (!running && timer === undefined) timer = setTimeout(() => void run(), 0);
  };
  return {
    request,
    dispose() {
      disposed = true;
      requested = false;
      clearTimeout(timer);
    },
  };
}
