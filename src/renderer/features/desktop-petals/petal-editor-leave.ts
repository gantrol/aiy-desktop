import { canLeavePetal, type PetalFlushReport } from '@/shared/petal-flush';

interface LeavePorts {
  settleFiles(): Promise<boolean>;
  settleEditor(requireRevision: boolean): Promise<boolean>;
  settleReferences(): Promise<boolean>;
  freeze(value: boolean): boolean;
  preserve(requireRevision: boolean): Promise<PetalFlushReport>;
  current(): boolean;
  deadline?: number;
}

/** A late callback must neither confirm nor freeze a newer editor operation. */
export async function leavePetalEditor(ports: LeavePorts, requireRevision: boolean): Promise<PetalFlushReport> {
  const expired = () => !ports.current() || (ports.deadline !== undefined && Date.now() >= ports.deadline);
  let safe = false;
  try {
    if (expired()) return { status: 'blocked', reason: 'timeout' };
    for (const settle of [ports.settleFiles, () => ports.settleEditor(requireRevision), ports.settleReferences]) {
      const settled = await settle();
      if (expired()) return { status: 'blocked', reason: 'timeout' };
      if (!settled) return { status: 'blocked', reason: 'pendingWork' };
    }
    if (!ports.freeze(true)) return { status: 'blocked', reason: 'composing' };
    const report = await ports.preserve(requireRevision);
    if (expired()) return { status: 'blocked', reason: 'timeout' };
    safe = canLeavePetal(report);
    return report;
  } catch {
    return { status: 'blocked', reason: 'unknown' };
  } finally {
    if (!safe && ports.current()) ports.freeze(false);
  }
}
