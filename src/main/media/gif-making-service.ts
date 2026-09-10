import { randomUUID } from 'node:crypto';
import type { LibraryDatabase } from '@/main/database';
import { readBoundedImageFile } from '@/main/media/bounded-image-file';
import { gifSourceInfo } from '@/main/media/gif-source';
import { renderGif } from '@/main/media/gif-renderer';
import {
  GIF_MAX_SOURCE_BYTES,
  gifAssetIds,
  gifErrorCode,
  gifPlaybackFrames,
  type GifExportInput,
  type GifProgress,
} from '@/shared/contracts/gif-making';
import type { GifRenderRequest } from '@/shared/gif-render-protocol';
import { gifMetadata } from '@/shared/gif-metadata';

export class GifMakingService {
  private active: { id: string; root: string; controller: AbortController } | null = null;
  private importing = false;
  constructor(private readonly database: LibraryDatabase) {}
  async importImage(input: { name: string; bytes: Uint8Array }) {
    if (this.importing) throw new Error('GIF_BUSY');
    this.importing = true;
    try {
      const info = gifSourceInfo(input.bytes);
      const stored = await this.database.storeGifSourceBuffer(input.bytes, info.extension);
      const assets = this.database.importStoredCreatorReferences('UPLOAD', [
        {
          item: { id: randomUUID(), name: input.name, mimeType: info.mimeType },
          stored,
        },
      ]);
      if (!assets[0]) throw new Error('GIF_FAILED');
      return assets[0];
    } finally {
      this.importing = false;
    }
  }
  cancel(runId: string) {
    if (this.active?.id === runId && this.active.root === this.database.libraryRoot)
      this.active.controller.abort(new Error('GIF_CANCELLED'));
  }
  async export(input: GifExportInput, progress: (value: GifProgress) => void) {
    if (this.active) throw new Error('GIF_BUSY');
    const { document } = this.database.loadGifDocument(input.documentId, input.revision);
    if (document.purpose !== 'GIF' || document.manifest.frames.length < 2) throw new Error('GIF_INVALID');
    const controller = new AbortController();
    this.active = { id: input.runId, root: this.database.libraryRoot, controller };
    const { signal } = controller;
    let started = false;
    try {
      this.database.beginGifExport(input);
      started = true;
      const ids = gifAssetIds(document.manifest);
      const files = await this.database.resolveAssetFilesAsync(ids);
      const sources: GifRenderRequest['sources'] = [];
      let totalBytes = 0;
      progress({ runId: input.runId, stage: 'PREPARING', completed: 0, total: ids.length });
      for (const id of ids) {
        signal.throwIfAborted();
        const file = files.get(id);
        if (!file) throw new Error('GIF_ASSET_UNAVAILABLE');
        if (totalBytes + file.byteSize > GIF_MAX_SOURCE_BYTES) throw new Error('GIF_LIMIT');
        const bytes = await readBoundedImageFile(file.absolutePath, signal, GIF_MAX_SOURCE_BYTES - totalBytes);
        const info = gifSourceInfo(bytes);
        sources.push({ assetId: id, mimeType: info.mimeType, bytes });
        totalBytes += bytes.byteLength;
        progress({ runId: input.runId, stage: 'PREPARING', completed: sources.length, total: ids.length });
      }
      const bytes = await renderGif({ runId: input.runId, manifest: document.manifest, sources }, signal, progress);
      signal.throwIfAborted();
      const metadata = gifMetadata(bytes);
      const frames = gifPlaybackFrames(document.manifest);
      if (
        metadata.width !== document.manifest.width ||
        metadata.height !== document.manifest.height ||
        metadata.durations.length !== frames.length ||
        metadata.durations.some((duration, i) => duration !== frames[i].durationMs) ||
        metadata.loop !== (document.manifest.loop === 'FOREVER' ? 0 : null)
      )
        throw new Error('GIF_INVALID');
      progress({ runId: input.runId, stage: 'SAVING', completed: 0, total: 1 });
      const stored = await this.database.storeGifBuffer(bytes);
      signal.throwIfAborted();
      return this.database.finishGifExport(input, stored);
    } catch (reason) {
      const code = gifErrorCode(reason);
      if (started) this.database.failGifExport(input.runId, code);
      throw new Error(code);
    } finally {
      this.active = null;
    }
  }
}
