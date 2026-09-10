import { randomUUID } from 'node:crypto';
import type { PetalWindow } from '@/main/desktop-petals/petal-windows';
import { isContentPinId } from '@/shared/contracts/petal-board';
export function requestPetalFlush(
  entry: PetalWindow,
  pending: Map<string, { senderId: number; finish(saved: boolean): void }>,
  recover: (id: string) => void,
  save: boolean,
): Promise<boolean> {
  if (!entry.instanceId || isContentPinId(entry.instanceId) || entry.window.isDestroyed()) return Promise.resolve(true);
  // A crashed renderer has no live text to flush; its persisted checkpoints restore on reopening.
  if (entry.window.webContents.isCrashed()) {
    try {
      recover(entry.instanceId);
      return Promise.resolve(true);
    } catch {
      return Promise.resolve(false);
    }
  }
  return new Promise((resolve) => {
    const token = randomUUID();
    const timer = setTimeout(() => finish(false), 8_000);
    const finish = (saved: boolean) => {
      clearTimeout(timer);
      pending.delete(token);
      resolve(saved);
    };
    pending.set(token, { senderId: entry.window.webContents.id, finish });
    entry.window.webContents.send('desktop-petals:flush', token, save);
  });
}
