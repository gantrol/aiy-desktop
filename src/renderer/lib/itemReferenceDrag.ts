import { referenceTargetSchema, type ContentSource, type ReferenceTarget } from '@/shared/contracts/content-source';

export const referenceDragType = 'application/x-aiy-reference-targets';
type ReferenceDragMode = 'FIXED' | 'FOLLOW';
let session: {
  token: string;
  mode: ReferenceDragMode;
  prepare?: () => Promise<ContentSource | null>;
  dispose(): void;
} | null = null;

export function writeReferenceDrag(
  transfer: DataTransfer,
  targets: readonly ReferenceTarget[],
  prepare?: () => Promise<ContentSource | null>,
  mode: ReferenceDragMode = 'FIXED',
) {
  session?.dispose();
  const token = crypto.randomUUID();
  const dispose = () => {
    if (session?.token === token) session = null;
    disconnect?.();
    window.removeEventListener('dragend', dispose);
  };
  const disconnect = window.desktopApi?.onLocalSpaceTransition?.(dispose);
  session = { token, prepare, mode, dispose };
  transfer.setData(referenceDragType, JSON.stringify({ token, targets, mode }));
  window.addEventListener('dragend', dispose, { once: true });
}

export function readReferenceDrag(transfer: DataTransfer) {
  try {
    const raw = transfer.getData(referenceDragType);
    if (!raw || raw.length > 100_000) return null;
    const value = JSON.parse(raw) as { token?: unknown; targets?: unknown; mode?: unknown };
    const targets = referenceTargetSchema.array().min(1).max(200).parse(value.targets);
    if (value.mode !== undefined && value.mode !== 'FIXED' && value.mode !== 'FOLLOW') return null;
    const mode = value.mode ?? 'FIXED';
    // A serialized ID alone cannot authorize cross-window/space following.
    // Other hosts keep the existing fixed-reference drag contract.
    if (mode === 'FOLLOW' && (value.token !== session?.token || session?.mode !== 'FOLLOW')) return null;
    return { targets, mode, prepare: value.token === session?.token ? session?.prepare : undefined };
  } catch {
    return null;
  }
}
