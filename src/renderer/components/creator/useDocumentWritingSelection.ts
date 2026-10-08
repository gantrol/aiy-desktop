import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Editor } from '@tiptap/core';
import { documentWritingSelection } from '@/renderer/components/creator/documentWritingEditor';

/** Selection chrome never takes focus or starts a request while the author is selecting. */
export function useDocumentWritingSelection(editor: Editor | null, surface: RefObject<HTMLDivElement | null>) {
  const [selectionKey, setSelectionKey] = useState('');
  const dismissed = useRef('');
  const anchor = useRef({ getBoundingClientRect: () => new DOMRect() });
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const dom = editor.view.dom;
    const owner = dom.ownerDocument;
    const viewport = dom.closest('[data-creation-document-workspace]');
    let dragging = false;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (editor.isDestroyed) return;
        const selected = documentWritingSelection(editor);
        const key = selected ? `${selected.from}:${selected.to}:${selected.text}` : '';
        if (!key || key !== dismissed.current) dismissed.current = '';
        const focused = editor.isFocused || surface.current?.contains(owner.activeElement);
        if (!selected || dragging || !focused || key === dismissed.current) {
          setSelectionKey('');
          return;
        }
        const point = editor.view.coordsAtPos(editor.state.selection.head);
        const bounds = viewport?.getBoundingClientRect();
        const toolbarBottom = viewport
          ?.querySelector('[data-creation-document-toolbar]')
          ?.getBoundingClientRect().bottom;
        const inView = !bounds || (point.top >= (toolbarBottom ?? bounds.top) && point.bottom <= bounds.bottom);
        const head = editor.state.selection.head;
        anchor.current = {
          getBoundingClientRect: () => {
            if (editor.isDestroyed) return new DOMRect();
            const position = editor.view.coordsAtPos(Math.min(head, editor.state.doc.content.size));
            return new DOMRect(position.left, position.top, 1, position.bottom - position.top);
          },
        };
        setSelectionKey(inView ? key : '');
      });
    };
    const start = () => {
      dragging = true;
      setSelectionKey('');
    };
    const finish = () => {
      dragging = false;
      update();
    };
    editor.on('selectionUpdate', update).on('update', update).on('focus', update).on('blur', update);
    dom.addEventListener('pointerdown', start);
    owner.addEventListener('pointerup', finish);
    owner.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      editor.off('selectionUpdate', update).off('update', update).off('focus', update).off('blur', update);
      dom.removeEventListener('pointerdown', start);
      owner.removeEventListener('pointerup', finish);
      owner.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [editor, surface]);
  return {
    visible: Boolean(selectionKey),
    anchor,
    dismiss() {
      const selected = documentWritingSelection(editor);
      dismissed.current = selected ? `${selected.from}:${selected.to}:${selected.text}` : '';
      setSelectionKey('');
    },
  };
}
