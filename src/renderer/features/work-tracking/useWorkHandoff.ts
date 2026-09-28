import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';

export function useWorkHandoff(spaceId: string, active: boolean, notify: (message: string) => void) {
  const l = useI18n().messages.workTracking;
  const [copying, setCopying] = useState(false);
  const epoch = useRef(0);
  useEffect(() => {
    const lifecycle = epoch;
    setCopying(false);
    return () => {
      lifecycle.current++;
    };
  }, [spaceId, active]);
  const copy = async (taskId: string) => {
    if (copying || !active) return;
    const token = epoch.current;
    setCopying(true);
    try {
      const result = await window.desktopApi.workTracking.handoff({ spaceId, taskId });
      if (epoch.current !== token) return;
      if (!result.ok) {
        notify(l.errors[result.code]);
        return;
      }
      await navigator.clipboard.writeText(result.value);
      if (epoch.current === token) notify(l.copied);
    } catch {
      if (epoch.current === token) notify(l.copyFailed);
    } finally {
      if (epoch.current === token) setCopying(false);
    }
  };
  return { copying, copy };
}
