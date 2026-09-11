import { useState } from 'react';
import type {
  ArticleEditorLocationDto,
  ArticleElementPlacementInput,
  VideoDocumentMediaBinding,
} from '@/shared/contracts';
import type { VideoDocumentWysiwygEditorHandle } from '@/renderer/features/video-documents/videoDocumentEditorTypes';

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
  return {
    images: (editor?.getImagePlacements() ?? []).map((image) => ({
      ...image,
      assetId: image.assetId || assetByPath.get(image.path) || '',
    })),
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
