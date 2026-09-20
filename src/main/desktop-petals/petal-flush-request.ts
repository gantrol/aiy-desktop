import { randomUUID } from 'node:crypto';
import { canLeavePetal, normalizePetalFlush, type PetalFlushReport } from '@/shared/petal-flush';

export interface PendingPetalFlush {
  senderId: number;
  finish(saved: boolean, report?: PetalFlushReport): void;
}
interface FlushPorts {
  senderId: number;
  send(token: string, deadline: number): void;
  report(report: PetalFlushReport): void;
  timeoutMs?: number;
}

/** Sender validation is performed by the controller before calling finish. */
export function requestFlushAcknowledgement(ports: FlushPorts, pending: Map<string, PendingPetalFlush>) {
  return new Promise<boolean>((resolve) => {
    const token = randomUUID();
    const timeoutMs = ports.timeoutMs ?? 8_000;
    let settled = false;
    const finish = (saved: boolean, observation?: PetalFlushReport) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pending.delete(token);
      const report = normalizePetalFlush(saved, observation);
      ports.report(report);
      resolve(canLeavePetal(report));
    };
    const timer = setTimeout(() => finish(false, { status: 'blocked', reason: 'timeout' }), timeoutMs);
    pending.set(token, { senderId: ports.senderId, finish });
    try {
      ports.send(token, Date.now() + timeoutMs);
    } catch {
      finish(false, { status: 'blocked', reason: 'rendererUnavailable' });
    }
  });
}
