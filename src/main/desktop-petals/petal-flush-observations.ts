import type { PetalWindow } from '@/main/desktop-petals/petal-windows';
import type { PetalFlushObservation, PetalFlushReport } from '@/shared/petal-flush';

const observations = new WeakMap<PetalWindow, PetalFlushObservation>();
export const petalFlushObservation = (entry: PetalWindow) => observations.get(entry) ?? null;
export function observePetalFlush(entry: PetalWindow, report: PetalFlushReport) {
  observations.set(entry, { report, checkedAt: Date.now() });
}
