import type { ImportedEditorImage } from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
import type { Dispatch, SetStateAction } from 'react';
import type { AssetDto, SocialPostContentInput } from '@/shared/contracts';

export function appendEditorImage(
  image: ImportedEditorImage,
  setContent: Dispatch<SetStateAction<SocialPostContentInput>>,
  setMediaAssets: Dispatch<SetStateAction<AssetDto[]>>,
) {
  const id = image.binding.assetId;
  setContent((current) => ({
    ...current,
    mediaAssetIds: current.mediaAssetIds.includes(id) ? current.mediaAssetIds : [...current.mediaAssetIds, id],
    coverAssetId: current.coverAssetId ?? id,
  }));
  setMediaAssets((current) =>
    current.some((asset) => asset.id === id)
      ? current
      : [
          ...current,
          {
            id,
            kind: 'REFERENCE',
            originType: 'IMPORT',
            width: image.media.width,
            height: image.media.height,
            mimeType: image.media.mimeType,
            byteSize: image.media.byteSize,
            mediaUrl: image.media.mediaUrl,
            createdAt: new Date().toISOString(),
          },
        ],
  );
}
