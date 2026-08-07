import { describe, expect, it } from 'vitest';
import { clipboardImageFiles, imageMimeType } from '../src/renderer/components/creator/imageImport';

describe('image intake parsing', () => {
  it('prefers clipboard item images over the duplicate files representation', () => {
    const image = { name: 'clipboard.png', type: 'image/png', size: 10 } as File;
    const duplicate = { name: 'duplicate.png', type: 'image/png', size: 10 } as File;
    const transfer = {
      items: [
        { kind: 'file', type: 'image/png', getAsFile: () => image },
        { kind: 'string', type: 'text/plain', getAsFile: () => null },
      ],
      files: [image, duplicate],
    } as unknown as DataTransfer;

    expect(clipboardImageFiles(transfer)).toEqual([image]);
  });

  it('recognizes supported image extensions when the clipboard omits MIME type', () => {
    expect(imageMimeType({ name: 'reference.WEBP', type: '' } as File)).toBe('image/webp');
    expect(imageMimeType({ name: 'notes.txt', type: '' } as File)).toBeNull();
  });
});
