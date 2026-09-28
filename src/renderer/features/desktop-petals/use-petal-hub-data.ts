import { useEffect, useState } from 'react';
import type { DesktopPetalSnapshot } from '@/shared/contracts/desktop-petals';
import { isPetalCenterMetricProvider, type PetalQuota } from '@/shared/contracts/petal-hub';

export function usePetalHubData(snapshot: DesktopPetalSnapshot) {
  const [now, setNow] = useState(Date.now);
  const [quota, setQuota] = useState<PetalQuota | null>(null);
  const { mode, codexLimitId } = snapshot.hubSettings;
  useEffect(() => {
    if (mode !== 'clock' && mode !== 'pomodoro') return;
    const update = () => {
      if (!document.hidden) setNow(Date.now());
    };
    const timer = setInterval(update, 1_000);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, [mode]);
  useEffect(() => {
    setQuota(null);
    const readsMetric = isPetalCenterMetricProvider(mode);
    if (snapshot.suspended || (!readsMetric && snapshot.hubView !== 'settings')) return;
    let live = true;
    const update = () => {
      if (document.hidden) return;
      void window.desktopPetals
        .hubQuota()
        .then((result) => {
          if (live) setQuota(result);
        })
        .catch(() => {
          if (live)
            setQuota({
              state: 'unavailable',
              message: '',
              messageCode: 'unavailable',
              capturedAt: null,
              primary: null,
              secondary: null,
              limits: [],
              providers: [],
            });
        });
    };
    const timer = readsMetric ? setInterval(update, 60_000) : null;
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      live = false;
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, [mode, codexLimitId, snapshot.hubView, snapshot.libraryId, snapshot.suspended]);
  return { now, quota };
}
