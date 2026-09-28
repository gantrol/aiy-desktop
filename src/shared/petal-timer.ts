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

function phaseDuration(phase: PetalTimer['phase'], settings: PetalHubSettings) {
  return (phase === 'focus' ? settings.focusMinutes : settings.breakMinutes) * 60_000;
}

export function petalTimerDuration(timer: PetalTimer, settings: PetalHubSettings) {
  return timer.durationMs ?? phaseDuration(timer.phase, settings);
}

export function hasPetalTimerSession(timer: PetalTimer, settings: PetalHubSettings, now: number) {
  return timer.endsAt !== null || petalTimerRemaining(timer, now) < petalTimerDuration(timer, settings);
}

/** Persist the current period length before changing defaults so an active session keeps its meaning. */
export function normalizePetalTimer(timer: PetalTimer, settings: PetalHubSettings): PetalTimer {
  if (timer.durationMs !== undefined) return timer;
  return { ...timer, durationMs: phaseDuration(timer.phase, settings) };
}

export function changePetalTimer(
  timer: PetalTimer,
  action: PetalTimerAction,
  settings: PetalHubSettings,
  now: number,
): PetalTimer {
  const current = normalizePetalTimer(timer, settings);
  const remaining = petalTimerRemaining(current, now);
  if (action === 'pause') return { ...current, remainingMs: remaining, endsAt: null };
  if (action === 'start') {
    if (current.endsAt !== null || remaining === 0) return current;
    return { ...current, endsAt: now + remaining };
  }
  const phase = action === 'next' ? (current.phase === 'focus' ? 'break' : 'focus') : current.phase;
  const durationMs = phaseDuration(phase, settings);
  return {
    phase,
    durationMs,
    remainingMs: durationMs,
    endsAt: action === 'next' ? now + durationMs : null,
  };
}
