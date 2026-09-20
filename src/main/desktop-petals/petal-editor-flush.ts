import type { PetalWindow } from '@/main/desktop-petals/petal-windows';
import type { PetalNoteService } from '@/main/desktop-petals/petal-note-service';
import { isBlankPetalInput } from '@/shared/petal-input-preservation';
import { petalError } from '@/shared/petal-errors';
import { isContentPinId } from '@/shared/contracts/petal-board';
import type { PetalFlushReport } from '@/shared/petal-flush';
import { requestFlushAcknowledgement, type PendingPetalFlush } from '@/main/desktop-petals/petal-flush-request';
import { observePetalFlush } from '@/main/desktop-petals/petal-flush-observations';

const queues = new WeakMap<PetalWindow, Promise<boolean>>();

export async function flushPetalInput(
  entry: PetalWindow,
  pending: Map<string, PendingPetalFlush>,
  notes: PetalNoteService | null,
  save = false,
): Promise<boolean> {
  const safe = await requestPetalFlush(
    entry,
    pending,
    (id) => {
      if (!notes) throw petalError('libraryUnavailable');
      const draft = notes.draft(id);
      notes.recover(id);
      if (notes.isPending(id) && draft && !isBlankPetalInput(draft)) throw petalError('unsaved');
    },
    save,
  );
  if (!safe || !entry.instanceId || !notes?.isPending(entry.instanceId)) return safe;
  // A missing editor may report unchanged; its main-process draft must also be empty.
  const note = notes.get(entry.instanceId);
  const input = notes.draft(entry.instanceId) ?? {
    text: note.text,
    title: note.title,
    document: note.document,
    referenceAssetIds: note.references.map((reference) => reference.assetId),
  };
  if (!isBlankPetalInput(input) || note.files?.length) {
    observePetalFlush(entry, { status: 'blocked', reason: 'unconfirmed' });
    return false;
  }
  observePetalFlush(entry, { status: 'unchanged' });
  return true;
}

export function requestPetalFlush(
  entry: PetalWindow,
  pending: Map<string, PendingPetalFlush>,
  recover: (id: string) => void,
  save: boolean,
): Promise<boolean> {
  const observe = (report: PetalFlushReport) => observePetalFlush(entry, report);
  // Different callers may request checkpoints and commits concurrently. Serialize them;
  // never satisfy a commit request using an earlier checkpoint acknowledgement.
  const previous = queues.get(entry);
  const request = (previous ?? Promise.resolve(true))
    .catch(() => false)
    .then(() => {
      if (!entry.instanceId || isContentPinId(entry.instanceId) || entry.window.isDestroyed()) {
        observe({ status: 'unchanged' });
        return true;
      }
      if (entry.window.webContents.isCrashed()) {
        try {
          recover(entry.instanceId);
          // Recovery only proves preservation, not that this requested revision was committed.
          if (save) {
            observe({ status: 'blocked', reason: 'rendererUnavailable' });
            return false;
          }
          observe({ status: 'recoverable', reason: 'unconfirmed' });
          return true;
        } catch {
          observe({ status: 'blocked', reason: 'persistence' });
          return false;
        }
      }
      return requestFlushAcknowledgement(
        {
          senderId: entry.window.webContents.id,
          send: (token, deadline) => entry.window.webContents.send('desktop-petals:flush', token, save, deadline),
          report: observe,
        },
        pending,
      );
    });
  queues.set(entry, request);
  void request
    .finally(() => {
      if (queues.get(entry) === request) queues.delete(entry);
    })
    .catch(() => undefined);
  return request;
}
