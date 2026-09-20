/** A recovery checkpoint is not a committed revision. Keep that distinction across IPC. */
export const PETAL_FLUSH_REASONS = [
  'composing',
  'pendingWork',
  'conflict',
  'persistence',
  'timeout',
  'rendererUnavailable',
  'unconfirmed',
  'unknown',
] as const;
export type PetalFlushReason = (typeof PETAL_FLUSH_REASONS)[number];
export interface PetalFlushReport {
  status: 'unchanged' | 'saved' | 'recoverable' | 'blocked';
  reason?: PetalFlushReason;
}
export interface PetalFlushObservation {
  report: PetalFlushReport;
  checkedAt: number;
}
export const canLeavePetal = (report: PetalFlushReport): boolean => report.status !== 'blocked';

/** Old renderers can confirm safety, but cannot prove that a revision was committed. */
export function normalizePetalFlush(saved: boolean, report?: PetalFlushReport): PetalFlushReport {
  if (report) return canLeavePetal(report) === saved ? report : { status: 'blocked', reason: 'unknown' };
  return saved ? { status: 'recoverable', reason: 'unconfirmed' } : { status: 'blocked', reason: 'unknown' };
}
