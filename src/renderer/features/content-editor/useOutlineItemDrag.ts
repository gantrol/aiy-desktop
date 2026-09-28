import type { Editor } from '@tiptap/core';
import type { NodeViewProps } from '@tiptap/react';
import { useRef, useState, type DragEvent } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { itemDragIntent } from '@/renderer/components/albums/itemDrag';
import { readReferenceDrag, referenceDragType, writeReferenceDrag } from '@/renderer/lib/itemReferenceDrag';
import { referenceFailure } from '@/shared/i18n/reference-outline';
import { useContentReferenceHost } from '@/renderer/features/content-editor/ContentReferenceHost';
import { focusOutlineView } from '@/renderer/features/content-editor/outlineActiveView';
import { dropOutlineReferences } from '@/renderer/features/content-editor/outlineReferenceDrop';
import { moveOutlineSelection } from '@/renderer/features/content-editor/outlineEditing';
import {
  beginOutlineTransfer,
  outlineTransferSource,
  dropOutlineTransfer,
} from '@/renderer/features/content-editor/outlineTransferDrag';
import { outlineSelectionRoots, type OutlineDropPlacement } from '@/renderer/features/content-editor/outlineMove';
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
  id,
  selected,
  view,
  editable,
  visibility,
  getPos,
}: {
  editor: Editor;
  id: string;
  selected: boolean;
  view: OutlineViewState;
  editable: boolean;
  visibility: 'inside' | 'path' | 'outside';
  getPos: NodeViewProps['getPos'];
}) {
  const copy = useI18n().messages.referenceOutline;
  const dragged = useRef(false);
  const referenceHost = useContentReferenceHost();
  const referencePending = useRef(false);
  const [dragError, setDragError] = useState('');
  return {
    draggable: editable && view.focus !== id,
    dragged,
    dragError,
    markerBindings: {
      onDragStart: (event: DragEvent<HTMLElement>) => {
        if (!editable || view.focus === id || visibility !== 'inside') {
          event.preventDefault();
          return;
        }
        const ids = outlineSelectionRoots(editor.state.doc.toJSON(), selected ? view.selected : [id]);
        if (!ids.length) {
          event.preventDefault();
          return;
        }
        dragged.current = true;
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
        const intent = itemDragIntent(event);
        const reference = intent === 'REFERENCE' && event.dataTransfer.types.includes(referenceDragType);
        if (
          !event.dataTransfer.types.includes(referenceDragType) &&
          !event.dataTransfer.types.includes('application/x-aiy-outline')
        )
          return;
        if (event.target instanceof Element && event.target.closest('.aiy-outline-item') !== event.currentTarget)
          return;
        const drag = outlineViewState(editor.state).drag;
        const transfer = outlineTransferSource(event.dataTransfer, editor, referenceHost);
        if (
          !editable ||
          referencePending.current ||
          intent === 'NONE' ||
          (intent === 'REFERENCE' && !reference) ||
          visibility !== 'inside' ||
          (!reference && !transfer && !drag?.validTargets.has(id))
        ) {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'none';
          previewOutlineDrop(editor, null);
          return;
        }
        const title = event.currentTarget.querySelector<HTMLElement>(
          ':scope > [data-node-view-content] > [data-node-view-content-react] > p:first-child',
        );
        const rect = title?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
        const position = getPos();
        const resolved = position === undefined ? null : editor.state.doc.resolve(position + 1);
        const firstSibling = resolved !== null && resolved.index(resolved.depth - 1) === 0;
        const placement: OutlineDropPlacement =
          view.focus === id || event.clientX >= rect.left + 24
            ? 'INSIDE'
            : firstSibling && event.clientY <= rect.top + Math.min(10, rect.height * 0.3)
              ? 'BEFORE'
              : 'AFTER';
        if (
          !outlinePlacementWithinFocus(
            editor.state.doc,
            outlineViewState(editor.state),
            reference || transfer ? [] : drag!.ids,
            id,
            placement,
          )
        ) {
          previewOutlineDrop(editor, null);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = reference ? 'link' : intent === 'COPY' ? 'copy' : 'move';
        scrollOutlineDragEdge(event.currentTarget, event.clientY);
        previewOutlineDrop(editor, id, placement);
      },
      onDragLeaveCapture: (event: DragEvent<HTMLElement>) => {
        if (
          !event.dataTransfer.types.includes('application/x-aiy-outline') &&
          !event.dataTransfer.types.includes(referenceDragType)
        )
          return;
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        previewOutlineDrop(editor, null);
      },
      onDropCapture: (event: DragEvent<HTMLElement>) => {
        const intent = itemDragIntent(event);
        const reference = intent === 'REFERENCE' && event.dataTransfer.types.includes(referenceDragType);
        if (
          !event.dataTransfer.types.includes(referenceDragType) &&
          !event.dataTransfer.types.includes('application/x-aiy-outline')
        )
          return;
        if (event.target instanceof Element && event.target.closest('.aiy-outline-item') !== event.currentTarget)
          return;
        event.preventDefault();
        event.stopPropagation();
        const drop = outlineViewState(editor.state).drop;
        const ids = outlineViewState(editor.state).drag?.ids ?? [];
        if (drop?.id === id && editable && !referencePending.current) {
          if (reference) {
            const payload = readReferenceDrag(event.dataTransfer);
            if (payload) {
              referencePending.current = true;
              setDragError('');
              void dropOutlineReferences(editor, payload, id, drop.placement)
                .then(() => focusOutlineView(editor))
                .catch((reason) => setDragError(referenceFailure(reason, copy, copy.captureFailed)))
                .finally(() => {
                  referencePending.current = false;
                });
            } else setDragError(copy.dragUnavailable);
          } else if (intent === 'MOVE' || intent === 'COPY') {
            const transfer = outlineTransferSource(event.dataTransfer, editor, referenceHost);
            if (transfer) {
              referencePending.current = true;
              setDragError('');
              void dropOutlineTransfer(transfer, editor, referenceHost, id, drop.placement, intent === 'COPY')
                .then(() => focusOutlineView(editor))
                .catch((reason) => setDragError(referenceFailure(reason, copy, copy.transferFailed)))
                .finally(() => {
                  referencePending.current = false;
                });
            } else if (
              moveOutlineSelection(editor, ids, id, drop.placement, { copy: intent === 'COPY', expandTarget: true })
            )
              focusOutlineView(editor);
          }
        }
        endOutlineDrag(editor);
      },
    },
  };
}
