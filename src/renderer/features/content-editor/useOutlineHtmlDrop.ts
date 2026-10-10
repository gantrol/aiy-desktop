import { useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import type { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { useOutlineContentLinkHost } from '@/renderer/features/content-editor/OutlineContentLinkHost';
import { dropOutlineItems, outlineDropPending } from '@/renderer/features/content-editor/outlineDrop';
import { outlineEdgeDrop, outlineRowDropPlacement } from '@/renderer/features/content-editor/outlineDropTarget';
import { focusOutlineView, rememberOutlineView } from '@/renderer/features/content-editor/outlineActiveView';
import {
  endOutlineDrag,
  outlineViewState,
  previewOutlineDrop,
} from '@/renderer/features/content-editor/outlineViewState';
import { htmlFileBatchLimit, htmlFileByteLimit, htmlFileNameSchema } from '@/shared/contracts/html-file';
import type { BlockNode } from '@/shared/contracts/block-document';

type DropEvent = DragEvent | ReactDragEvent;
const key = new PluginKey('outlineHtmlDrop');
const htmlName = (name: string) => /\.html?$/iu.test(name);

export function useOutlineHtmlDrop(editor: Editor, enabled: boolean) {
  const host = useOutlineContentLinkHost();
  const copy = useI18n().messages.htmlFiles;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const accepts = (view: EditorView, event: DropEvent) => {
    if (!enabled || !host || !event.dataTransfer?.types.includes('Files')) return false;
    const element = event.target instanceof Element ? event.target : null;
    if (element?.closest('[data-reference-editor]')) return false;
    const targetView = element?.closest('.ProseMirror');
    if (targetView && targetView !== view.dom) return false;
    const files = Array.from(event.dataTransfer.files);
    if (files.length) return files.some((file) => htmlName(file.name));
    return Array.from(event.dataTransfer.items).some(
      (item) => item.kind === 'file' && (!item.type || item.type === 'text/html'),
    );
  };
  const allowed = (view: EditorView) =>
    !editor.isDestroyed &&
    editor.isEditable &&
    !view.isDestroyed &&
    !view.composing &&
    !pending.current &&
    !outlineDropPending(editor);
  const destination = (view: EditorView, event: DropEvent) => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>('.aiy-outline-item') : null;
    if (row && row.closest('.ProseMirror') === view.dom) {
      const id = row.dataset.outlineId;
      if (id)
        return { id, placement: outlineRowDropPlacement(row, event, outlineViewState(editor.state).focus === id) };
    }
    return outlineEdgeDrop(editor, view, event.clientY);
  };
  const over = useStableCallback((view: EditorView, event: DropEvent) => {
    if (!accepts(view, event)) return false;
    event.preventDefault();
    event.stopPropagation();
    const canDrop = allowed(view);
    const target = canDrop ? destination(view, event) : null;
    event.dataTransfer!.dropEffect = canDrop ? 'copy' : 'none';
    previewOutlineDrop(editor, target?.id ?? null, target?.placement);
    return true;
  });
  const drop = useStableCallback((view: EditorView, event: DropEvent) => {
    if (!accepts(view, event)) return false;
    event.preventDefault();
    event.stopPropagation();
    if (!allowed(view)) return true;
    const files = Array.from(event.dataTransfer!.files);
    if (
      !files.length ||
      files.length > htmlFileBatchLimit ||
      files.some((file) => !htmlFileNameSchema.safeParse(file.name).success)
    ) {
      setError(copy.invalidBatch);
      endOutlineDrag(editor);
      return true;
    }
    if (files.some((file) => file.size > htmlFileByteLimit)) {
      setError(copy.tooLarge);
      endOutlineDrag(editor);
      return true;
    }
    if (files.some((file) => !file.size)) {
      setError(copy.importFailed);
      endOutlineDrag(editor);
      return true;
    }
    const target = destination(view, event);
    const spaceId = host!.spaceId;
    rememberOutlineView(editor, view);
    pending.current = true;
    setBusy(true);
    setError('');
    void dropOutlineItems(editor, target?.id ?? null, target?.placement ?? 'AFTER', async (assertCurrent) => {
      const items: BlockNode[] = [];
      for (const file of files) {
        assertCurrent();
        const bytes = new Uint8Array(await file.arrayBuffer());
        assertCurrent();
        const attrs = await window.desktopApi.htmlFileImport({ spaceId, fileName: file.name, bytes });
        assertCurrent();
        items.push({
          type: 'listItem',
          attrs: { blockId: crypto.randomUUID() },
          content: [
            { type: 'paragraph', attrs: { blockId: crypto.randomUUID() }, content: [{ type: 'htmlFile', attrs }] },
          ],
        });
      }
      return items;
    })
      .then(() => {
        if (!view.isDestroyed) focusOutlineView(editor, view);
      })
      .catch((reason) => {
        if (!editor.isDestroyed)
          setError(String(reason).includes('REFERENCE_TARGET_CHANGED') ? copy.changed : copy.importFailed);
      })
      .finally(() => {
        pending.current = false;
        if (!editor.isDestroyed) {
          setBusy(false);
          endOutlineDrag(editor);
        }
      });
    return true;
  });
  const leave = useStableCallback((view: EditorView, event: DropEvent) => {
    if (
      event.dataTransfer?.types.includes('Files') &&
      !(event.relatedTarget instanceof Node && view.dom.contains(event.relatedTarget))
    )
      previewOutlineDrop(editor, null);
    return false;
  });
  useEffect(() => {
    if (!enabled || !host) return;
    const clear = () => {
      if (!editor.isDestroyed) previewOutlineDrop(editor, null);
    };
    editor.registerPlugin(new Plugin({ key, props: { handleDOMEvents: { dragover: over, drop, dragleave: leave } } }));
    window.addEventListener('dragend', clear, true);
    window.addEventListener('drop', clear);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('dragend', clear, true);
      window.removeEventListener('drop', clear);
      window.removeEventListener('blur', clear);
      if (!editor.isDestroyed) editor.unregisterPlugin(key);
    };
  }, [editor, enabled, host, over, drop, leave]);
  const outsideView = (event: ReactDragEvent) =>
    event.target instanceof Element &&
    (Boolean(event.target.closest('[data-outline-append]')) ||
      !event.target.closest('.ProseMirror, button, input, textarea, [role="toolbar"], [role="menu"]'));
  return {
    error,
    status: busy ? copy.importing : '',
    onDragOverCapture: (event: ReactDragEvent) => (outsideView(event) ? over(editor.view, event) : false),
    onDropCapture: (event: ReactDragEvent) => (outsideView(event) ? drop(editor.view, event) : false),
    onDragLeaveCapture: (event: ReactDragEvent) => leave(editor.view, event),
  };
}
