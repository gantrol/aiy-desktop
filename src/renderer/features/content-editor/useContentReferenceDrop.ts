import { useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { useI18n } from '@/renderer/i18n/useI18n';
import { readReferenceDrag, referenceDragType } from '@/renderer/lib/itemReferenceDrag';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { itemDragIntent } from '@/renderer/components/albums/itemDrag';
import { useArticleEditorSessions } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import type { ContentSource } from '@/shared/contracts/content-source';
import { referenceFailure } from '@/shared/i18n/reference-outline';
import { isContentLinkDrag } from '@/renderer/features/content-editor/contentLinkDrop';
import { dropContentReferences } from '@/renderer/features/content-editor/contentReferenceDrop';
import { useOutlineContentLinkHost } from '@/renderer/features/content-editor/OutlineContentLinkHost';
import { dropOutlineContentLinks } from '@/renderer/features/content-editor/outlineContentLinkDrop';
import { dropOutlineReferences } from '@/renderer/features/content-editor/outlineReferenceDrop';
import { focusOutlineView, rememberOutlineView } from '@/renderer/features/content-editor/outlineActiveView';
import { outlineEdgeDrop } from '@/renderer/features/content-editor/outlineDropTarget';
import { outlineDropPending } from '@/renderer/features/content-editor/outlineDrop';
import {
  endOutlineDrag,
  outlineNavigationFocus,
  previewOutlineDrop,
} from '@/renderer/features/content-editor/outlineViewState';

type DropEvent = DragEvent | ReactDragEvent;
const dropKey = new PluginKey('contentReferenceDrop');

export function useContentReferenceDrop(editor: Editor, source?: ContentSource) {
  const copy = useI18n().messages.referenceOutline;
  const sessions = useArticleEditorSessions();
  const linkHost = useOutlineContentLinkHost();
  const pending = useRef(false);
  const [error, setError] = useState('');
  const accepts = (view: EditorView, event: DropEvent) => {
    if (!event.dataTransfer?.types.includes(referenceDragType)) return false;
    if (event.target instanceof Element && event.target.closest('[data-reference-editor]')) return false;
    // Every object dropped on an outline row belongs to that row, including sidebar links.
    if (
      outlineNavigationFocus(editor.state) !== undefined &&
      event.target instanceof Element &&
      event.target.closest('.aiy-outline-item')
    )
      return false;
    const targetView = event.target instanceof Element ? event.target.closest('.ProseMirror') : null;
    if (targetView && targetView !== view.dom) return false;
    return true;
  };
  const allowed = (view: EditorView, event: DropEvent) => {
    const intent = itemDragIntent(event);
    return (
      !editor.isDestroyed &&
      editor.isEditable &&
      !view.isDestroyed &&
      !view.composing &&
      !pending.current &&
      !outlineDropPending(editor) &&
      (intent === 'MOVE' || intent === 'REFERENCE') &&
      // Moving outline items requires an explicit structural destination.
      (intent === 'REFERENCE' || !event.dataTransfer?.types.includes('application/x-aiy-outline'))
    );
  };
  const insert = async (view: EditorView, event: DropEvent) => {
    const payload = readReferenceDrag(event.dataTransfer!);
    if (!payload) return setError(copy.dragUnavailable);
    const linkSpaceId = linkHost && isContentLinkDrag(event) ? linkHost.spaceId : undefined;
    rememberOutlineView(editor, view);
    pending.current = true;
    setError('');
    try {
      if (outlineNavigationFocus(editor.state) !== undefined) {
        const target = outlineEdgeDrop(editor, view, event.clientY);
        if (!target) throw new Error('REFERENCE_LOCATION_MISSING');
        if (linkSpaceId) await dropOutlineContentLinks(editor, payload, linkSpaceId, target.id, target.placement);
        else await dropOutlineReferences(editor, payload, target.id, target.placement);
      } else {
        const location = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!location) throw new Error('REFERENCE_LOCATION_MISSING');
        await dropContentReferences({ editor, view, position: location.pos, payload, source, sessions, linkSpaceId });
      }
      if (!view.isDestroyed) focusOutlineView(editor, view);
    } catch (reason) {
      if (!editor.isDestroyed)
        setError(referenceFailure(reason, copy, linkSpaceId ? copy.linkFailed : copy.captureFailed));
    } finally {
      pending.current = false;
      if (!editor.isDestroyed && outlineNavigationFocus(editor.state) !== undefined) endOutlineDrag(editor);
    }
  };
  const over = useStableCallback((view: EditorView, event: DropEvent) => {
    if (!accepts(view, event)) return false;
    event.preventDefault();
    event.stopPropagation();
    const accepted = allowed(view, event);
    if (outlineNavigationFocus(editor.state) !== undefined) {
      const target = accepted ? outlineEdgeDrop(editor, view, event.clientY) : null;
      event.dataTransfer!.dropEffect = target ? 'link' : 'none';
      previewOutlineDrop(editor, target?.id ?? null, target?.placement);
    } else event.dataTransfer!.dropEffect = accepted ? 'link' : 'none';
    return true;
  });
  const drop = useStableCallback((view: EditorView, event: DropEvent) => {
    if (!accepts(view, event)) return false;
    event.preventDefault();
    event.stopPropagation();
    if (allowed(view, event)) void insert(view, event);
    return true;
  });
  const leave = useStableCallback((view: EditorView, event: DropEvent) => {
    if (
      event.dataTransfer?.types.includes(referenceDragType) &&
      !(event.relatedTarget instanceof Node && view.dom.contains(event.relatedTarget)) &&
      outlineNavigationFocus(editor.state) !== undefined
    )
      previewOutlineDrop(editor, null);
    return false;
  });
  useEffect(() => {
    if (editor.isDestroyed) return;
    const clear = () => {
      if (!editor.isDestroyed) endOutlineDrag(editor);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clear();
    };
    // Sidebar sources do not own the outline's preview or receive its dragend callback.
    window.addEventListener('dragend', clear, true);
    window.addEventListener('drop', clear);
    window.addEventListener('blur', clear);
    window.addEventListener('keydown', escape, true);
    // A ProseMirror handler receives the actual view in both panes; wrapper-only handlers miss the split view.
    editor.registerPlugin(
      new Plugin({ key: dropKey, props: { handleDOMEvents: { dragover: over, drop, dragleave: leave } } }),
    );
    return () => {
      window.removeEventListener('dragend', clear, true);
      window.removeEventListener('drop', clear);
      window.removeEventListener('blur', clear);
      window.removeEventListener('keydown', escape, true);
      clear();
      if (!editor.isDestroyed) editor.unregisterPlugin(dropKey);
    };
  }, [editor, over, drop, leave]);
  const outsideView = (event: ReactDragEvent) => {
    if (!(event.target instanceof Element) || !event.currentTarget.contains(event.target)) return false;
    if (event.target.closest('[data-outline-append]')) return true;
    return !event.target.closest('.ProseMirror, button, input, textarea, [role="toolbar"], [role="menu"]');
  };
  return {
    error,
    onDragOverCapture(event: ReactDragEvent) {
      if (outsideView(event)) over(editor.view, event);
    },
    onDropCapture(event: ReactDragEvent) {
      if (outsideView(event)) drop(editor.view, event);
    },
    onDragLeaveCapture(event: ReactDragEvent) {
      leave(editor.view, event);
    },
  };
}
