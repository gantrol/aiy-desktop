import type { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import { useRef, useState, type DragEvent } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { itemDragIntent } from '@/renderer/components/albums/itemDrag';
import { isContentLinkDrag } from '@/renderer/features/content-editor/contentLinkDrop';
import { readReferenceDrag, referenceDragType, writeReferenceDrag } from '@/renderer/lib/itemReferenceDrag';
import { referenceFailure } from '@/shared/i18n/reference-outline';
import { useContentReferenceHost } from '@/renderer/features/content-editor/ContentReferenceHost';
import { focusOutlineView, rememberOutlineView } from '@/renderer/features/content-editor/outlineActiveView';
import { outlineRowDropPlacement } from '@/renderer/features/content-editor/outlineDropTarget';
import { outlineDropPending } from '@/renderer/features/content-editor/outlineDrop';
import { dropOutlineReferences } from '@/renderer/features/content-editor/outlineReferenceDrop';
import { dropOutlineContentLinks } from '@/renderer/features/content-editor/outlineContentLinkDrop';
import { useOutlineContentLinkHost } from '@/renderer/features/content-editor/OutlineContentLinkHost';
import { moveOutlineSelection } from '@/renderer/features/content-editor/outlineEditing';
import {
  beginOutlineTransfer,
  outlineTransferSource,
  dropOutlineTransfer,
} from '@/renderer/features/content-editor/outlineTransferDrag';
import { outlineSelectionRoots } from '@/renderer/features/content-editor/outlineMove';
import {
  beginOutlineDrag,
  endOutlineDrag,
  outlinePlacementWithinFocus,
  outlineViewState,
  previewOutlineDrop,
  selectOutlineItem,
  type OutlineViewState,
} from '@/renderer/features/content-editor/outlineViewState';

function scrollOutlineDragEdge(element: HTMLElement, pointerY: number) {
  let ancestor = element.parentElement;
  while (ancestor) {
    const overflow = window.getComputedStyle(ancestor).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && ancestor.scrollHeight > ancestor.clientHeight) {
      const bounds = ancestor.getBoundingClientRect();
      const distance = Math.min(pointerY - bounds.top, bounds.bottom - pointerY);
      if (distance < 32) ancestor.scrollBy({ top: pointerY < bounds.top + 32 ? -16 : 16 });
      return;
    }
    ancestor = ancestor.parentElement;
  }
}

/** Owns one item's drag gesture and pending reference capture; text selection stays with the view. */
export function useOutlineItemDrag({
  editor,
  editorView,
  id,
  selected,
  view,
  editable,
  visibility,
}: {
  editor: Editor;
  editorView: EditorView;
  id: string;
  selected: boolean;
  view: OutlineViewState;
  editable: boolean;
  visibility: 'inside' | 'path' | 'outside';
}) {
  const copy = useI18n().messages.referenceOutline;
  const dragged = useRef(false);
  const referenceHost = useContentReferenceHost();
  const linkHost = useOutlineContentLinkHost();
  const referencePending = useRef(false);
  const [dragError, setDragError] = useState('');
  const isContentLink = (event: DragEvent) => Boolean(linkHost) && isContentLinkDrag(event);
  const ownsEvent = (event: DragEvent<HTMLElement>) => {
    if (!(event.target instanceof Element)) return false;
    return (
      event.target.closest('.aiy-outline-item') === event.currentTarget &&
      event.target.closest('.ProseMirror') === editorView.dom &&
      !event.target.closest('[data-reference-editor]')
    );
  };
  const destination = (event: DragEvent<HTMLElement>) => {
    const current = outlineViewState(editor.state);
    const intent = itemDragIntent(event);
    const reference =
      isContentLink(event) || (intent === 'REFERENCE' && event.dataTransfer.types.includes(referenceDragType));
    const transfer = outlineTransferSource(event.dataTransfer, editor, referenceHost);
    if (
      editor.isDestroyed ||
      editorView.isDestroyed ||
      !editor.isEditable ||
      editorView.composing ||
      referencePending.current ||
      outlineDropPending(editor) ||
      intent === 'NONE' ||
      (intent === 'REFERENCE' && !reference) ||
      visibility !== 'inside' ||
      (!reference && !transfer && !current.drag?.validTargets.has(id))
    )
      return null;
    const placement = outlineRowDropPlacement(event.currentTarget, event, current.focus === id);
    return outlinePlacementWithinFocus(
      editor.state.doc,
      current,
      reference || transfer ? [] : current.drag!.ids,
      id,
      placement,
    )
      ? { placement, reference, transfer, intent }
      : null;
  };
  return {
    draggable: editable && view.focus !== id,
    dragged,
    dragError,
    markerBindings: {
      onDragStart: (event: DragEvent<HTMLElement>) => {
        if (
          !editor.isEditable ||
          editorView.composing ||
          outlineDropPending(editor) ||
          view.focus === id ||
          visibility !== 'inside'
        ) {
          event.preventDefault();
          return;
        }
        const ids = outlineSelectionRoots(editor.state.doc.toJSON(), selected ? view.selected : [id]);
        if (!ids.length) {
          event.preventDefault();
          return;
        }
        dragged.current = true;
        rememberOutlineView(editor, editorView);
        if (!selected) selectOutlineItem(editor, id);
        beginOutlineDrag(editor, ids);
        beginOutlineTransfer(event.dataTransfer, editor, referenceHost, ids);
        event.dataTransfer.setData('application/x-aiy-outline', id);
        event.dataTransfer.effectAllowed = 'all';
        if (referenceHost.source)
          writeReferenceDrag(
            event.dataTransfer,
            ids.map((blockId) => ({
              source: referenceHost.source!,
              blockId,
              scope: referenceHost.source!.kind === 'ARTICLE' ? 'SELF' : 'SUBTREE',
            })),
            referenceHost.beforeCapture,
            referenceHost.source.kind === 'ARTICLE' ? 'FOLLOW' : 'FIXED',
          );
        event.stopPropagation();
      },
      onDragEnd: () => {
        endOutlineDrag(editor);
        window.setTimeout(() => {
          dragged.current = false;
        }, 0);
      },
    },
    dropBindings: {
      onDragOverCapture: (event: DragEvent<HTMLElement>) => {
        if (
          !event.dataTransfer.types.includes(referenceDragType) &&
          !event.dataTransfer.types.includes('application/x-aiy-outline')
        )
          return;
        if (!ownsEvent(event)) return;
        event.preventDefault();
        event.stopPropagation();
        rememberOutlineView(editor, editorView);
        const target = destination(event);
        event.dataTransfer.dropEffect = !target
          ? 'none'
          : target.reference
            ? 'link'
            : target.intent === 'COPY'
              ? 'copy'
              : 'move';
        if (!target) {
          previewOutlineDrop(editor, null);
          return;
        }
        scrollOutlineDragEdge(event.currentTarget, event.clientY);
        previewOutlineDrop(editor, id, target.placement);
      },
      onDragLeaveCapture: (event: DragEvent<HTMLElement>) => {
        if (
          !event.dataTransfer.types.includes('application/x-aiy-outline') &&
          !event.dataTransfer.types.includes(referenceDragType)
        )
          return;
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        previewOutlineDrop(editor, null);
      },
      onDropCapture: (event: DragEvent<HTMLElement>) => {
        const link = isContentLink(event);
        if (
          !event.dataTransfer.types.includes(referenceDragType) &&
          !event.dataTransfer.types.includes('application/x-aiy-outline')
        )
          return;
        if (!ownsEvent(event)) return;
        event.preventDefault();
        event.stopPropagation();
        rememberOutlineView(editor, editorView);
        const drop = destination(event);
        const ids = outlineViewState(editor.state).drag?.ids ?? [];
        if (drop) {
          const { intent, reference, transfer } = drop;
          if (reference) {
            const payload = readReferenceDrag(event.dataTransfer);
            if (payload) {
              referencePending.current = true;
              setDragError('');
              const operation = link
                ? dropOutlineContentLinks(editor, payload, linkHost!.spaceId, id, drop.placement)
                : dropOutlineReferences(editor, payload, id, drop.placement);
              void operation
                .then(() => focusOutlineView(editor, editorView))
                .catch((reason) =>
                  setDragError(referenceFailure(reason, copy, link ? copy.linkFailed : copy.captureFailed)),
                )
                .finally(() => {
                  referencePending.current = false;
                });
            } else setDragError(copy.dragUnavailable);
          } else if (intent === 'MOVE' || intent === 'COPY') {
            if (transfer) {
              referencePending.current = true;
              setDragError('');
              void dropOutlineTransfer(transfer, editor, referenceHost, id, drop.placement, intent === 'COPY')
                .then(() => focusOutlineView(editor, editorView))
                .catch((reason) => setDragError(referenceFailure(reason, copy, copy.transferFailed)))
                .finally(() => {
                  referencePending.current = false;
                });
            } else if (
              moveOutlineSelection(editor, ids, id, drop.placement, { copy: intent === 'COPY', expandTarget: true })
            )
              focusOutlineView(editor, editorView);
          }
        }
        endOutlineDrag(editor);
      },
    },
  };
}
