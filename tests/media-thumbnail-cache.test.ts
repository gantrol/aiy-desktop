import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  createThumbnailFromPath: vi.fn(),
}));

vi.mock('electron', () => ({
  nativeImage: { createThumbnailFromPath: electronMocks.createThumbnailFromPath },
}));

import { MediaThumbnailCache } from '@/main/media-thumbnail-cache';

const roots: string[] = [];

afterEach(() => {
  electronMocks.createThumbnailFromPath.mockReset();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('media thumbnail cache lifecycle', () => {
  it('rejects queued work and waits for an active native thumbnail operation during disposal', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'aiy-thumbnail-cache-'));
    roots.push(root);
    let releaseThumbnail!: (thumbnail: unknown) => void;
    const thumbnailGate = new Promise((resolve) => {
      releaseThumbnail = resolve;
    });
    electronMocks.createThumbnailFromPath.mockReturnValue(thumbnailGate);
    const cache = new MediaThumbnailCache(root, path.join(root, 'thumbnail-worker.js'), 1);
    const first = cache.get('asset-1', path.join(root, 'asset-1.png'), 96);
    const second = cache.get('asset-2', path.join(root, 'asset-2.png'), 96);
    const firstRejection = expect(first).rejects.toThrow('Media thumbnail cache is closed');
    const secondRejection = expect(second).rejects.toThrow('Media thumbnail cache is closed');
    await vi.waitFor(() => expect(electronMocks.createThumbnailFromPath).toHaveBeenCalledOnce());
    let disposed = false;

    const disposal = cache.dispose().then(() => {
      disposed = true;
    });
    await Promise.resolve();

    expect(disposed).toBe(false);
    releaseThumbnail({});
    await Promise.all([firstRejection, secondRejection, disposal]);
    expect(disposed).toBe(true);
    await expect(cache.get('asset-3', path.join(root, 'asset-3.png'), 96)).rejects.toThrow(
      'Media thumbnail cache is closed',
    );
  });
});
