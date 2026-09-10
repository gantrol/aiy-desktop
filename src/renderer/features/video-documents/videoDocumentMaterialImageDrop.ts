import { hasMaterialsDrag, readMaterialsDrag } from '@/renderer/components/albums/albumDrag';
import {
  type VideoDocumentEditorImageImport,
  videoDocumentEditorImageFromAsset,
} from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
import type { Editor, EditorEvents } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import type { RefObject } from 'react';

interface ImageImportCallbacks {
  onImageImported(result: VideoDocumentEditorImageImport): void;
  onImageImportError(): void;
}

export function materialImageDropHandler(
  editorRef: RefObject<Editor | null>,
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
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) return false;
    let target = position?.pos ?? editor.state.selection.from;
    let removed = false;
    const mapTarget = ({ transaction, appendedTransactions }: EditorEvents['transaction']) => {
      for (const change of [transaction, ...appendedTransactions]) {
        const mapped = change.mapping.mapResult(target, 1);
        target = mapped.pos;
        removed ||= mapped.deleted;
      }
    };
    editor.on('transaction', mapTarget);
    queueRef.current = queueRef.current
      .catch(() => undefined)
      .then(async () => {
        let failed = false;
        try {
          const assets = await window.desktopApi.materialImageAssetsResolve({ targets });
          if (removed || editor.isDestroyed || editorRef.current !== editor) return;
          const images = assets.map(videoDocumentEditorImageFromAsset);
          editor.off('transaction', mapTarget);
          images.forEach((image) => callbacksRef.current.onImageImported(image));
          if (
            !editor.commands.insertContentAt(
              target,
              images.map((image) => ({ type: 'image', attrs: image.attributes })),
            )
          )
            failed = true;
        } catch {
          failed = true;
        }
        if (failed && !editor.isDestroyed) callbacksRef.current.onImageImportError();
      })
      .finally(() => editor.off('transaction', mapTarget));
    return true;
  };
}
