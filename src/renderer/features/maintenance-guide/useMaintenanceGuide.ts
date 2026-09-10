import { useCallback, useEffect, useRef, useState } from 'react';
import type { MaintenanceErrorCode, MaintenanceResult, MaintenanceState } from '@/shared/contracts/maintenance-guide';

export function useMaintenanceGuide(active: boolean) {
  const [state, setState] = useState<MaintenanceState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MaintenanceErrorCode | null>(null);
  const pending = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    const token = ++generation.current;
    if (!active) {
      setState(null);
      return;
    }
    setBusy(true);
    setError(null);
    void window.desktopApi.maintenanceGuide
      .list()
      .then((result) => {
        if (token !== generation.current) return;
        if (result.ok) setState(result.value);
        else setError(result.code);
      })
      .catch(() => {
        if (token === generation.current) setError('storageUnavailable');
      })
      .finally(() => {
        if (token === generation.current) setBusy(false);
      });
    return () => {
      generation.current += 1;
    };
  }, [active]);

  const run = useCallback(
    async <T>(operation: () => Promise<MaintenanceResult<T>>, accept?: (value: T) => void) => {
      if (!active || pending.current) return false;
      pending.current = true;
      const token = generation.current;
      setBusy(true);
      setError(null);
      try {
        const result = await operation();
        if (token !== generation.current) return false;
        if (!result.ok) {
          setError(result.code);
          return false;
        }
        accept?.(result.value);
        return true;
      } catch {
        if (token === generation.current) setError('storageUnavailable');
        return false;
      } finally {
        pending.current = false;
        if (token === generation.current) setBusy(false);
      }
    },
    [active],
  );

  const update = useCallback(
    (operation: () => Promise<MaintenanceResult<MaintenanceState>>, accept?: (state: MaintenanceState) => void) =>
      run(operation, (next) => {
        setState(next);
        accept?.(next);
      }),
    [run],
  );
  return { state, busy, error, run, update };
}
