import type { BrowserWindow } from 'electron';
import { imagePrivacyCommandSchema, type ImagePrivacyResult } from '@/shared/contracts/image-privacy';
import { inspectUploadImage } from '@/shared/upload-image-policy';
import { IMAGE_EDIT_MAX_EDGE, IMAGE_EDIT_MAX_PIXELS } from '@/shared/contracts/image-edit';
import { recognizeWindowsImage } from '@/main/image-privacy/windows-ocr';
import { findSensitiveRegions } from '@/main/image-privacy/sensitive-regions';

/** One image in flight across all petal windows; cancellation is scoped to owner and request. */
export class ImagePrivacyScanner {
  private active?: { owner: BrowserWindow; requestId: string; abort: AbortController };

  async execute(owner: BrowserWindow, raw: unknown): Promise<ImagePrivacyResult> {
    const input = imagePrivacyCommandSchema.parse(raw);
    if (input.kind === 'cancel') {
      if (this.active?.owner === owner && this.active.requestId === input.requestId) this.active.abort.abort();
      return { status: 'cancelled' };
    }
    if (process.platform !== 'win32') return { status: 'unsupported' };
    if (owner.isDestroyed() || !owner.isVisible()) return { status: 'cancelled' };
    if (this.active) return { status: 'busy' };
    try {
      const image = inspectUploadImage(input.bytes, 'image/png');
      if (
        image.animated ||
        image.width > IMAGE_EDIT_MAX_EDGE ||
        image.height > IMAGE_EDIT_MAX_EDGE ||
        image.width * image.height > IMAGE_EDIT_MAX_PIXELS
      )
        return { status: 'tooLarge' };
      const task = { owner, requestId: input.requestId, abort: new AbortController() };
      const contents = owner.webContents;
      this.active = task;
      const cancel = () => task.abort.abort();
      owner.once('closed', cancel);
      owner.once('hide', cancel);
      contents.once('render-process-gone', cancel);
      contents.once('did-start-navigation', cancel);
      try {
        const ocr = await recognizeWindowsImage(input.bytes, task.abort.signal);
        if (task.abort.signal.aborted) return { status: 'cancelled' };
        if (ocr.status !== 'ready') return ocr;
        if (input.kind === 'recognize') {
          const text = ocr.lines.map((line) => line.text ?? line.words.map((word) => word.text).join(' ')).join('\n');
          return text.length <= 262144 ? { status: 'ready', regions: [], text } : { status: 'tooLarge' };
        }
        const regions = findSensitiveRegions(ocr, input.options, image.width, image.height);
        return regions ? { status: 'ready', regions } : { status: 'tooMany' };
      } finally {
        owner.removeListener('closed', cancel);
        owner.removeListener('hide', cancel);
        contents.removeListener('render-process-gone', cancel);
        contents.removeListener('did-start-navigation', cancel);
        if (this.active === task) this.active = undefined;
      }
    } catch {
      return { status: 'failed' };
    }
  }

  dispose() {
    this.active?.abort.abort();
  }
}
