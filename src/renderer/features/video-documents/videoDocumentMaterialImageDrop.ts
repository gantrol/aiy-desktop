import type { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import type { RefObject } from 'react';
import type { VideoDocumentMediaBinding, VideoDocumentRevisionMediaDto } from '@/shared/contracts';
import { hasMaterialsDrag, readMaterialsDrag } from '@/renderer/components/albums/albumDrag';
import {
  type VideoDocumentEditorImageImport,
  videoDocumentEditorImageFromAsset,
} from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
import { insertVideoDocumentImage } from '@/renderer/features/video-documents/videoDocumentEditorMedia';

interface ImageMediaSnapshot {
  mediaBindings: readonly VideoDocumentMediaBinding[];
  media: readonly VideoDocumentRevisionMediaDto[];
}

interface ImageImportCallbacks {
  onImageImported(result: VideoDocumentEditorImageImport): void;
  onImageImportError(): void;
}

export function materialImageDropHandler(
  editorRef: RefObject<Editor | null>,
  imageMediaRef: RefObject<ImageMediaSnapshot>,
  queueRef: RefObject<Promise<void>>,
  callbacksRef: RefObject<ImageImportCallbacks>,
) {
  return (view: EditorView, event: DragEvent) => {
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer || !hasMaterialsDrag(dataTransfer)) return false;
    const targets = readMaterialsDrag(dataTransfer);
    if (!targets.length) return false;
    event.preventDefault();
    const position = view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (position) editorRef.current?.commands.setTextSelection(position.pos);

    queueRef.current = queueRef.current.then(async () => {
      let failed = false;
      try {
        const assets = await window.desktopApi.materialImageAssetsResolve({ targets });
        for (const asset of assets) {
          const editor = editorRef.current;
          if (!editor || editor.isDestroyed) return;
          try {
            const existingPath = imageMediaRef.current.mediaBindings.find(
              (binding) => binding.kind === 'IMAGE' && binding.assetId === asset.id,
            )?.path;
            const result = videoDocumentEditorImageFromAsset(asset, existingPath);
            if (!insertVideoDocumentImage(editor, result.attributes)) throw new Error('Image insertion failed');
            callbacksRef.current.onImageImported(result);
          } catch {
            failed = true;
          }
        }
      } catch {
        failed = true;
      }
      const editor = editorRef.current;
      if (failed && editor && !editor.isDestroyed) callbacksRef.current.onImageImportError();
    });
    return true;
  };
}
