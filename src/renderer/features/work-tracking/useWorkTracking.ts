import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkCommand, WorkErrorCode, WorkMutation, WorkSnapshot } from '@/shared/contracts/work-tracking';

export function useWorkTracking(spaceId: string, active: boolean) {
  const [snapshot, setSnapshot] = useState<WorkSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<WorkErrorCode | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const lastRequest = useRef<{ key: string; input: WorkMutation } | null>(null);
  const refresh = useCallback(async () => {
    if (!active) return;
    const token = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const result = await window.desktopApi.workTracking.read({ spaceId });
      if (generation.current !== token) return;
      if (result.ok) setSnapshot(result.value);
      else setError(result.code);
    } catch {
      if (generation.current === token) setError('storageUnavailable');
    } finally {
      if (generation.current === token) setBusy(false);
    }
  }, [active, spaceId]);
  useEffect(() => {
    const lifecycle = generation;
    if (active) void refresh();
    else setSnapshot(null);
    return () => {
      lifecycle.current++;
    };
  }, [active, refresh]);

  const mutate = async (command: WorkCommand, revision: number) => {
    if (!active || pending.current) return false;
    pending.current = true;
    const token = ++generation.current;
    setBusy(true);
    setError(null);
    const key = JSON.stringify({ spaceId, revision, command });
    const input =
      lastRequest.current?.key === key
        ? lastRequest.current.input
        : { ...command, spaceId, revision, requestId: crypto.randomUUID() };
    lastRequest.current = { key, input };
    try {
      const result = await window.desktopApi.workTracking.mutate(input);
      if (generation.current !== token) return false;
      if (!result.ok) {
        setError(result.code);
        return false;
      }
      setSnapshot(result.value);
      lastRequest.current = null;
      return true;
    } catch {
      if (generation.current === token) setError('storageUnavailable');
      return false;
    } finally {
      pending.current = false;
      if (generation.current === token) setBusy(false);
    }
  };
  return { snapshot, busy, error, refresh, mutate };
}
