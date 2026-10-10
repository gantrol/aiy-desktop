import { dialog } from 'electron';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { ClipboardStore, type ClipboardPayload } from '@/main/clipboard-capture/store';
import type { CaptureHistoryCommand, ClipboardResult, ClipboardStatus } from '@/shared/contracts/clipboard-capture';

export class CaptureHistory {
  readonly store: ClipboardStore;
  private error: string | null = null;
  private readonly thumbnails = new Map<string, string>();
  constructor(
    root: string,
    private readonly actions: {
      status(): ClipboardStatus;
      enabled(): boolean;
      copy(payload: ClipboardPayload): Promise<void>;
      open(id: string, bytes: Buffer, edit: boolean): Promise<void>;
      changed(): void;
    },
  ) {
    this.store = new ClipboardStore(root, { recording: true, limitCount: 200, limitMiB: 128, retentionDays: 30 });
  }
  async record(image: Buffer, id: string, accepted: () => boolean, partial = false) {
    await this.store
      .run(async () => {
        if (!this.store.settings.recording) return;
        // Only a confirmed PNG crop is retained; full frozen displays never reach this store.
        const dimensions =
          image.length >= 24 && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            ? { width: image.readUInt32BE(16), height: image.readUInt32BE(20) }
            : undefined;
        await this.store.add(
          { text: '', html: '', image, source: partial ? 'capture-partial' : 'capture', reference: false, dimensions },
          accepted,
          true,
          id,
        );
      })
      .then(
        () => {
          this.error = null;
        },
        (error) => {
          this.error = 'captureHistoryFailed';
          throw error;
        },
      );
    this.actions.changed();
  }
  private status(): ClipboardStatus {
    const status = this.actions.status();
    return {
      ...status,
      enabled: this.actions.enabled(),
      settings: {
        ...this.store.settings,
        captureShortcut: status.settings.captureShortcut,
        pinShortcut: status.settings.pinShortcut,
        historyShortcut: status.settings.historyShortcut,
        pasteNextShortcut: status.settings.pasteNextShortcut,
      },
      recording: this.store.settings.recording,
      starting: false,
      pause: null,
      canRecord: true,
      count: this.store.items.length,
      usedBytes: this.store.usedBytes,
      limitCount: this.store.limitCount,
      limitBytes: this.store.limitBytes,
      queuedCount: 0,
      error: this.error,
    };
  }
  async execute(command: CaptureHistoryCommand): Promise<ClipboardResult> {
    await this.store.ready;
    if (command.kind === 'status') return { kind: 'status', value: this.status() };
    return this.store.run(async () => {
      if (command.kind === 'list') {
        await this.store.expire();
        return this.store.list(command.query, command.filter, command.offset, () => true);
      }
      if (command.kind === 'configure') {
        await this.store.configure(command.settings);
        this.actions.changed();
        return { kind: 'status', value: this.status() };
      }
      if (command.kind === 'remove') await this.store.remove(command.id);
      else if (command.kind === 'removeMany') await this.store.removeMany(command.ids);
      else if (command.kind === 'clearHistory')
        await this.store.removeMany(
          this.store.items.filter((item) => command.includePinned || !item.pinned).map((item) => item.id),
        );
      else if (command.kind === 'pin') await this.store.pin(command.id, command.pinned);
      else if (command.kind === 'rename') await this.store.rename(command.id, command.title);
      else return this.useImage(command);
      this.error = null;
      this.thumbnails.clear();
      this.actions.changed();
      return { kind: 'done' };
    });
  }
  private async useImage(
    command: Extract<CaptureHistoryCommand, { id: string }> & {
      kind: 'read' | 'thumbnail' | 'copy' | 'open' | 'editImage' | 'export' | 'remove';
    },
  ): Promise<ClipboardResult> {
    const entry = this.store.entry(command.id);
    if (command.kind === 'thumbnail' && this.thumbnails.has(entry.id))
      return { kind: 'detail', text: '', image: this.thumbnails.get(entry.id)! };
    const payload = await this.store.read(entry.id);
    if (!payload.image) throw new Error('corrupt');
    if (command.kind === 'read')
      return { kind: 'detail', text: '', image: `data:image/png;base64,${payload.image.toString('base64')}` };
    if (command.kind === 'thumbnail') {
      const bytes = await sharp(payload.image, { limitInputPixels: 32_000_000 })
        .resize({ width: 160, height: 100, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
      const image = `data:image/png;base64,${bytes.toString('base64')}`;
      if (this.thumbnails.size >= 50) this.thumbnails.delete(this.thumbnails.keys().next().value!);
      this.thumbnails.set(entry.id, image);
      return { kind: 'detail', text: '', image };
    }
    if (command.kind === 'copy') await this.actions.copy(payload);
    else if (command.kind === 'open' || command.kind === 'editImage')
      await this.actions.open(randomUUID(), payload.image, command.kind === 'editImage');
    else if (command.kind === 'export') {
      const result = await dialog.showSaveDialog({
        defaultPath: `${entry.title || `Capture-${entry.createdAt.replace(/[:.]/gu, '-')}`}.png`,
        filters: [{ name: 'PNG', extensions: ['png'] }],
      });
      if (!result.canceled && result.filePath) await writeFile(result.filePath, payload.image, { flush: true });
    }
    return { kind: 'done' };
  }
}
