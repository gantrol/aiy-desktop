import type { Editor } from '@tiptap/core';
import { useEffect } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import {
  insertContentFigureReference,
  refreshContentFigureReferenceLabels,
} from '@/renderer/features/content-editor/contentFigureReference';
import { contentImageNumber } from '@/shared/content-image-number';
import { figureReferenceMessages } from '@/shared/i18n/figure-reference';

function documentImageIds(editor: Editor) {
  const ids: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'image' && typeof node.attrs.assetId === 'string' && node.attrs.assetId)
      ids.push(node.attrs.assetId);
  });
  return ids;
}

export function useContentFigureReferences(
  editor: Editor | null,
  assetIds: readonly string[] | undefined,
  input: { isInputPending(): boolean; subscribeInput(listener: () => void): () => void },
) {
  const { locale, messages } = useI18n();
  const copy = messages.desktopPetals.document;
  const figureCopy = figureReferenceMessages(locale);
  const refresh = useStableCallback(() => {
    if (!editor || editor.isDestroyed || input.isInputPending()) return;
    refreshContentFigureReferenceLabels(
      editor,
      assetIds ?? documentImageIds(editor),
      (index) => copy.imageNumber.replace('{number}', contentImageNumber(index + 1, copy.numbering)),
      figureCopy.missing,
    );
  });
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    let frame = 0;
    // Defer until the editor has published the current update or settled an IME composition.
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(refresh);
    };
    schedule();
    editor.on('update', schedule);
    const unsubscribeInput = input.subscribeInput(schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      editor.off('update', schedule);
      unsubscribeInput();
    };
  }, [editor, assetIds, copy.imageNumber, copy.numbering, figureCopy.missing, input, refresh]);

  return useStableCallback((assetId: string, label: string) =>
    Boolean(editor && insertContentFigureReference(editor, assetId, label, locale)),
  );
}
