import { useCallback, useEffect, useRef, useState } from 'react';

export function useNoteApplicationPanel(height: number, enabled: boolean, onError: (reason: unknown) => void) {
  const [currentHeight, setHeight] = useState(height);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const queue = useRef(Promise.resolve(0));
  const request = useRef(0);
  const change = useCallback(
    (next: number) => {
      const token = ++request.current;
      if (mounted.current) setBusy(true);
      // Closing on hide/unmount follows any pending open instead of racing its IPC.
      queue.current = queue.current.catch(() => 0).then(() => window.desktopPetals.setApplicationPanelHeight(next));
      void queue.current
        .then((actual) => {
          if (mounted.current && token === request.current) setHeight(actual);
        })
        .catch((reason) => {
          if (mounted.current) onError(reason);
        })
        .finally(() => {
          if (mounted.current && token === request.current) setBusy(false);
        });
    },
    [onError],
  );
  useEffect(() => {
    setHeight(height);
  }, [height]);
  useEffect(() => {
    if (!enabled) change(0);
  }, [enabled, change]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      change(0);
    };
  }, [change]);
  return { height: currentHeight, busy, change };
}
