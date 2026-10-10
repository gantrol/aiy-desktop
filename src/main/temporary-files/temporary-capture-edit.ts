import type { PetalWindow, PetalWindows } from '@/main/desktop-petals/petal-windows';
import type { TemporaryFilesStore } from '@/main/temporary-files/temporary-files-store';
import { readBoundedImageFile } from '@/main/media/bounded-image-file';
import { petalError } from '@/shared/petal-errors';

interface Session {
  entry: PetalWindow;
  finishing: boolean;
  settle(image: Buffer | null): void;
}
/** Reuses the existing image editor, but returns the adopted pixels to its capture task. */
export class TemporaryCaptureEdit {
  private readonly sessions = new Map<string, Session>();
  constructor(
    private readonly store: TemporaryFilesStore,
    private readonly windows: PetalWindows,
    private readonly changed: () => void,
  ) {}
  active(id: string) {
    return this.sessions.has(id);
  }
  open(entry: PetalWindow, signal: AbortSignal): Promise<Buffer | null> {
    signal.throwIfAborted();
    const id = entry.instanceId!;
    if (this.sessions.has(id)) throw petalError('unsaved');
    return new Promise((resolve) => {
      const cancel = () => {
        if (!session.finishing) session.settle(null);
      };
      const abandon = () => session.settle(null);
      const session: Session = {
        entry,
        finishing: false,
        settle: (image) => {
          if (this.sessions.get(id) !== session) return;
          this.sessions.delete(id);
          signal.removeEventListener('abort', abandon);
          entry.window.removeListener('hide', cancel);
          entry.window.removeListener('closed', cancel);
          this.changed();
          resolve(image);
        },
      };
      this.sessions.set(id, session);
      signal.addEventListener('abort', abandon, { once: true });
      entry.window.on('hide', cancel);
      entry.window.once('closed', cancel);
      this.changed();
    });
  }
  async finish(id: string, sender?: PetalWindow) {
    const session = this.sessions.get(id);
    if (!session || session.entry !== sender || session.finishing) throw petalError('sourceUnavailable');
    session.finishing = true;
    try {
      const image = await this.store.run(async () => {
        const body = await this.store.body(id);
        const assetId = body.note.references[0]?.assetId;
        if (!assetId || !this.store.manifest(id).attachments.some((item) => item.id === assetId))
          throw petalError('sourceUnavailable');
        return readBoundedImageFile(this.store.file(assetId, 'bin'), undefined, 24 * 1024 * 1024);
      });
      if (this.sessions.get(id) !== session) return;
      if (!(await this.windows.hide(session.entry))) throw petalError('unsaved');
      session.settle(image);
    } finally {
      session.finishing = false;
    }
  }
}
