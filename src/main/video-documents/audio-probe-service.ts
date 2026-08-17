import { ALL_FORMATS, FilePathSource, Input } from 'mediabunny';
import type { VideoDocumentAudioInfo, VideoDocumentDto } from '@/shared/contracts/video-document';

interface VideoDocumentAudioProbeDatabase {
  getVideoDocument(documentId: string): VideoDocumentDto;
  resolveAssetFile(assetId: string): { absolutePath: string; mimeType: string } | null;
  updateVideoDocumentAudioInfo(sourceAssetId: string, audio: VideoDocumentAudioInfo): void;
}

function probeFailure(errorCode: string): VideoDocumentAudioInfo {
  return {
    status: 'DETECTION_FAILED',
    trackCount: 0,
    primaryCodec: null,
    detectedAt: new Date().toISOString(),
    errorCode,
  };
}

export class VideoDocumentAudioProbeService {
  private readonly pending = new Map<string, Promise<VideoDocumentDto>>();

  constructor(private readonly database: VideoDocumentAudioProbeDatabase) {}

  async ensure(documentId: string, force = false) {
    const document = this.database.getVideoDocument(documentId);
    const audio = document.source.audio;
    if (!force && (audio.status !== 'DETECTION_FAILED' || audio.detectedAt !== null)) return document;
    const existing = this.pending.get(document.source.asset.id);
    if (existing) return existing;
    const operation = this.probe(document).finally(() => this.pending.delete(document.source.asset.id));
    this.pending.set(document.source.asset.id, operation);
    return operation;
  }

  private async probe(document: VideoDocumentDto) {
    const sourceAssetId = document.source.asset.id;
    const source = this.database.resolveAssetFile(sourceAssetId);
    if (!source || !source.mimeType.startsWith('video/')) {
      this.database.updateVideoDocumentAudioInfo(sourceAssetId, probeFailure('SOURCE_UNAVAILABLE'));
      return this.database.getVideoDocument(document.id);
    }

    const input = new Input({
      formats: ALL_FORMATS,
      source: new FilePathSource(source.absolutePath.replaceAll('\\', '/'), { maxCacheSize: 1024 * 1024 }),
    });
    try {
      if (!(await input.canRead())) {
        this.database.updateVideoDocumentAudioInfo(sourceAssetId, probeFailure('MEDIA_UNREADABLE'));
        return this.database.getVideoDocument(document.id);
      }
      const tracks = await input.getAudioTracks();
      const primary = tracks.length ? await input.getPrimaryAudioTrack() : null;
      const primaryCodec = primary ? await primary.getCodec() : null;
      this.database.updateVideoDocumentAudioInfo(sourceAssetId, {
        status: tracks.length ? 'HAS_AUDIO' : 'NO_AUDIO',
        trackCount: tracks.length,
        primaryCodec,
        detectedAt: new Date().toISOString(),
        errorCode: null,
      });
    } catch {
      this.database.updateVideoDocumentAudioInfo(sourceAssetId, probeFailure('PROBE_FAILED'));
    } finally {
      input.dispose();
    }
    return this.database.getVideoDocument(document.id);
  }
}
