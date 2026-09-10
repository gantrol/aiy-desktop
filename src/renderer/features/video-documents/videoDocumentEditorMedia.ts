import type { Editor } from '@tiptap/core';
import type { VideoDocumentFrameCaptureResult } from '@/shared/contracts';

export interface VideoDocumentEditorImageAttributes {
  assetId?: string;
  src: string;
  sourcePath: string;
  title: string | null;
  alt: string | null;
}

export function videoDocumentFrameImageAttributes(
  result: VideoDocumentFrameCaptureResult,
): VideoDocumentEditorImageAttributes {
  return {
    assetId: result.binding.assetId,
    src: result.media.mediaUrl,
    sourcePath: result.binding.path,
    title: null,
    alt: null,
  };
}

export function insertVideoDocumentImage(
  editor: Editor,
  attributes: VideoDocumentEditorImageAttributes,
  replaceSelectedImage = false,
) {
  if (editor.isDestroyed) return false;
  if (replaceSelectedImage && editor.isActive('image')) {
    return editor.chain().focus().updateAttributes('image', attributes).run();
  }
  return editor.chain().focus().insertContent({ type: 'image', attrs: attributes }).run();
}
