import { useState } from 'react';
import type {
  ArticleEditorLocationDto,
  ArticleElementPlacementInput,
  VideoDocumentMediaBinding,
} from '@/shared/contracts';
import type { VideoDocumentWysiwygEditorHandle } from '@/renderer/features/video-documents/videoDocumentEditorTypes';

export interface ArticleUnplacedImage {
  assetId: string;
}

export function useArticleEditorMedia({
  bindings,
  elements,
  onEditorHandleChange,
  onNavigate,
}: {
  bindings: readonly VideoDocumentMediaBinding[];
  elements: readonly ArticleElementPlacementInput[];
  onEditorHandleChange(
    handle: VideoDocumentWysiwygEditorHandle | null,
    previous: VideoDocumentWysiwygEditorHandle | null,
  ): void;
  onNavigate(location: ArticleEditorLocationDto): void;
}) {
  const [editor, setEditor] = useState<VideoDocumentWysiwygEditorHandle | null>(null);
  const assetByPath = new Map(bindings.map((binding) => [binding.path, binding.assetId]));
  const images = (editor?.getImagePlacements() ?? []).map((image) => ({
    ...image,
    assetId: image.assetId || assetByPath.get(image.path) || '',
  }));
  const placedAssetIds = new Set(images.map((image) => image.assetId));
  const unplacedAssetIds = new Set<string>();
  const unplaced: ArticleUnplacedImage[] = editor
    ? bindings.flatMap((binding) => {
        if (placedAssetIds.has(binding.assetId) || unplacedAssetIds.has(binding.assetId)) return [];
        unplacedAssetIds.add(binding.assetId);
        return [{ assetId: binding.assetId }];
      })
    : [];
  return {
    images,
    unplaced,
    onEditorHandleChange(
      handle: VideoDocumentWysiwygEditorHandle | null,
      previous: VideoDocumentWysiwygEditorHandle | null,
    ) {
      setEditor(handle);
      onEditorHandleChange(handle, previous);
    },
    onImageMove: (elementId: string, targetId: string) => editor?.moveImage(elementId, targetId) ?? false,
    onImageRemove: (elementId: string) => editor?.removeImage(elementId) ?? false,
    onImageUndo: () => editor?.undo() ?? false,
    onImageRedo: () => editor?.redo() ?? false,
    onImageLocate(elementId: string) {
      const element = elements.find((candidate) => candidate.elementId === elementId);
      if (element) onNavigate({ elementId, relativeOffset: 0, blockIndex: element.blockIndex });
    },
  };
}
