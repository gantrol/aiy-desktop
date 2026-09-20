import type { ImportedEditorImage } from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
import type { Dispatch, SetStateAction } from 'react';
import type { AssetDto, SocialPostContentInput } from '@/shared/contracts';
import { socialPostMediaLimit } from '@/shared/contracts/social-post';

export function appendEditorImage(
  image: ImportedEditorImage,
  setContent: Dispatch<SetStateAction<SocialPostContentInput>>,
  setMediaAssets: Dispatch<SetStateAction<AssetDto[]>>,
) {
  const id = image.binding.assetId;
  // The save session applies this update synchronously, before an import replaces its placeholder.
  setContent((current) => {
    if (!current.mediaAssetIds.includes(id) && current.mediaAssetIds.length >= socialPostMediaLimit)
      throw new Error('SOCIAL_POST_IMAGE_LIMIT');
    return {
      ...current,
      mediaAssetIds: current.mediaAssetIds.includes(id) ? current.mediaAssetIds : [...current.mediaAssetIds, id],
      coverAssetId: current.coverAssetId ?? id,
    };
  });
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
