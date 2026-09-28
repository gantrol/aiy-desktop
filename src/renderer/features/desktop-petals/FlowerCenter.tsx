import { useI18n } from '@/renderer/i18n/useI18n';
import { petalQuotaText } from '@/renderer/features/desktop-petals/petal-copy';
import {
  isPetalCenterMetricProvider,
  type PetalHubSettings,
  type PetalQuota,
  type PetalTimer,
} from '@/shared/contracts/petal-hub';
import { petalTimerDuration, petalTimerRemaining, formatPetalDuration } from '@/shared/petal-timer';

export function flowerCenterProgress(
  settings: PetalHubSettings,
  timer: PetalTimer,
  quota: PetalQuota | null,
  now: number,
) {
  if (isPetalCenterMetricProvider(settings.mode))
    return { inner: quota?.primary?.remaining ?? null, outer: quota?.secondary?.remaining ?? null };
  if (settings.mode === 'pomodoro')
    return {
      inner: Math.min(100, (petalTimerRemaining(timer, now) / petalTimerDuration(timer, settings)) * 100),
      outer: null,
    };
  return { inner: null, outer: null };
}

export function FlowerCenter({
  settings,
  timer,
  quota,
  now,
}: {
  settings: PetalHubSettings;
  timer: PetalTimer;
  quota: PetalQuota | null;
  now: number;
}) {
  const { locale, messages } = useI18n();
  const copy = messages.desktopPetals;
  if (settings.mode === 'none') return null;
  if (settings.mode === 'clock')
    return (
      <span
        className="pointer-events-none flex size-full items-center justify-center text-sm tabular-nums"
        title={settings.timeZone}
      >
        {new Intl.DateTimeFormat(locale, {
          timeZone: settings.timeZone,
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).format(now)}
      </span>
    );
  if (settings.mode === 'pomodoro') {
    const remaining = petalTimerRemaining(timer, now);
    return (
      <span
        className="pointer-events-none flex size-full items-center justify-center text-sm tabular-nums"
        title={timer.phase === 'focus' ? copy.timer.focusHint : copy.timer.breakHint}
      >
        {remaining ? formatPetalDuration(remaining) : copy.timer.done}
      </span>
    );
  }
  const primary = quota?.primary?.remaining ?? quota?.secondary?.remaining;
  return (
    <span
      className="pointer-events-none flex size-full items-center justify-center text-sm tabular-nums"
      title={petalQuotaText(quota, copy)}
      data-center-provider={settings.mode}
    >
      {primary === undefined ? '—' : `${Math.round(primary)}%`}
    </span>
  );
}
