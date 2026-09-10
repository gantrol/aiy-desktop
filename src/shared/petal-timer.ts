import type { PetalHubSettings, PetalTimer, PetalTimerAction } from '@/shared/contracts/petal-hub';

export function formatPetalDuration(remainingMs: number) {
  const seconds = Math.ceil(Math.max(0, remainingMs) / 1000);
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

export function petalTimerRemaining(timer: PetalTimer, now: number) {
  return Math.max(0, timer.endsAt === null ? timer.remainingMs : timer.endsAt - now);
}
export function changePetalTimer(
  timer: PetalTimer,
  action: PetalTimerAction,
  settings: PetalHubSettings,
  now: number,
): PetalTimer {
  const remaining = petalTimerRemaining(timer, now);
  if (action === 'pause') return { ...timer, remainingMs: remaining, endsAt: null };
  if (action === 'start') {
    if (timer.endsAt !== null || remaining === 0) return timer;
    return { ...timer, endsAt: now + remaining };
  }
  const phase = action === 'next' ? (timer.phase === 'focus' ? 'break' : 'focus') : timer.phase;
  const remainingMs = (phase === 'focus' ? settings.focusMinutes : settings.breakMinutes) * 60_000;
  return { phase, remainingMs, endsAt: action === 'next' ? now + remainingMs : null };
}
