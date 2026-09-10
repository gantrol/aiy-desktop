import { useCallback, useEffect, useRef, useState } from 'react';
import type { CodexContentState } from '@/shared/contracts/codex-content';
import type { DesktopPetalMessages } from '@/shared/i18n/desktop-petals';

export const isContentTaskActive = (status: string) => ['STARTING', 'RUNNING', 'COLLECTING'].includes(status);
export function codexContentError(reason: unknown, copy: DesktopPetalMessages['codex']) {
  const code = String(reason).match(/\[aiy-codex-content:([a-zA-Z]+)\]/)?.[1];
  return code && code in copy.errors ? copy.errors[code as keyof typeof copy.errors] : copy.errors.execution;
}
export function useCodexContent(stashId: string, enabled = true) {
  const [state, setState] = useState<CodexContentState | null>(null);
  const [error, setError] = useState<unknown>(null);
  const revision = useRef(0);
  const invalidate = useCallback(() => {
    revision.current++;
  }, []);
  const refresh = useCallback(async () => {
    const current = ++revision.current;
    try {
      const next = await window.desktopPetals.codex.state(stashId);
      if (current === revision.current) {
        setState(next);
        setError(null);
      }
    } catch (reason) {
      if (current === revision.current) setError(reason);
    }
  }, [stashId]);
  useEffect(() => {
    setState(null);
    setError(null);
    if (!enabled) return;
    void refresh();
    const unsubscribe = window.desktopPetals.codex.onChanged((event) => {
      if (!event || event.stashId === stashId) void refresh();
    });
    window.addEventListener('focus', refresh);
    return () => {
      invalidate();
      unsubscribe();
      window.removeEventListener('focus', refresh);
    };
  }, [enabled, refresh, invalidate, stashId]);
  return { state, error, refresh };
}
