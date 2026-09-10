import type { VideoDocumentEditorImageAttributes } from '@/renderer/features/video-documents/videoDocumentEditorMedia';
import type { AssetDto, VideoDocumentMediaBinding, VideoDocumentRevisionMediaDto } from '@/shared/contracts';
export interface VideoDocumentEditorImageImport {
  binding: VideoDocumentMediaBinding;
  media: VideoDocumentRevisionMediaDto;
}

export interface ImportedEditorImage extends VideoDocumentEditorImageImport {
  attributes: VideoDocumentEditorImageAttributes;
}

export function editorImageFromAsset(
  asset: AssetDto,
  fallbackByteSize: number,
  alt: string | null,
  sourcePath: string,
): ImportedEditorImage {
  if (
    asset.mimeType !== 'image/png' &&
    asset.mimeType !== 'image/jpeg' &&
    asset.mimeType !== 'image/webp' &&
    asset.mimeType !== 'image/gif' &&
    asset.mimeType !== 'image/svg+xml'
  ) {
    throw new Error('Image import produced an unsupported asset');
  }
  const mimeType = asset.mimeType;
  const binding: VideoDocumentMediaBinding = {
    path: sourcePath,
    assetId: asset.id,
    kind: 'IMAGE',
    timestampMs: null,
    endTimestampMs: null,
    posterAssetId: null,
  };
  const media: VideoDocumentRevisionMediaDto = {
    assetId: asset.id,
    mediaUrl: asset.mediaUrl,
    mimeType,
    width: asset.width,
    height: asset.height,
    byteSize: Math.max(1, asset.byteSize ?? fallbackByteSize),
    durationMs: null,
  };
  return {
    binding,
    media,
    attributes: { assetId: binding.assetId, src: media.mediaUrl, sourcePath: binding.path, title: null, alt },
  };
}

export function videoDocumentEditorImageFromAsset(asset: AssetDto): ImportedEditorImage {
  const extension =
    asset.mimeType === 'image/png'
      ? 'png'
      : asset.mimeType === 'image/webp'
        ? 'webp'
        : asset.mimeType === 'image/gif'
          ? 'gif'
          : asset.mimeType === 'image/svg+xml'
            ? 'svg'
            : 'jpg';
  return editorImageFromAsset(asset, 1, null, `assets/material-${crypto.randomUUID()}.${extension}`);
}
