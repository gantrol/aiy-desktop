import { useRef, useState, type DragEvent } from 'react';
import type { Editor } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import { TextSelection } from '@tiptap/pm/state';
import { useI18n } from '@/renderer/i18n/useI18n';
import { readReferenceDrag, referenceDragType } from '@/renderer/lib/itemReferenceDrag';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { captureReferenceInsertion } from '@/renderer/features/content-editor/referenceInsertion';
import { useArticleEditorSessions } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { followingPresentation } from '@/shared/content-reference-token';
import type { ContentSource, ReferenceTarget } from '@/shared/contracts/content-source';
import { referenceFailure } from '@/shared/i18n/reference-outline';
import { revealInsertedReferences } from '@/renderer/features/content-editor/referenceToolbarState';

async function resolveBodyTarget(target: ReferenceTarget) {
  const preview = await contentLibraryApi().referenceInspect(target);
  if (target.source.kind !== 'CREATION_ITEM' || preview.selector?.kind !== 'MEMBERS') return { target, preview };
  const bodies = preview.selector.members.filter((member) => member.kind === 'ARTICLE');
  if (bodies.length !== 1) throw new Error('REFERENCE_FOLLOW_SCOPE_UNSUPPORTED');
  return { target: { source: { kind: 'ARTICLE' as const, id: bodies[0].id } }, preview };
}

function preparedTarget(item: ReferenceTarget, prepared: ContentSource | null | undefined): ReferenceTarget {
  if (!prepared) return item;
  if (prepared.kind !== item.source.kind || prepared.id !== item.source.id) throw new Error('REFERENCE_TARGET_CHANGED');
  return { ...item, source: prepared };
}

export function useContentReferenceDrop(editor: Editor, source?: ContentSource) {
  const copy = useI18n().messages.referenceOutline;
  const sessions = useArticleEditorSessions();
  const pending = useRef(false);
  const [error, setError] = useState('');
  const accepts = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes(referenceDragType)) return false;
    if (event.target instanceof Element && event.target.closest('[data-reference-editor]')) return false;
    // Structural drags inside an outline continue to use its item placement and move semantics.
    if (
      event.dataTransfer.types.includes('application/x-aiy-outline') &&
      event.target instanceof Element &&
      event.target.closest('.aiy-outline-item')
    )
      return false;
    return true;
  };
  const insert = async (event: DragEvent) => {
    if (!accepts(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (pending.current || !editor.isEditable || editor.view.composing) return;
    const payload = readReferenceDrag(event.dataTransfer);
    const location = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (!payload || !location) {
      setError(copy.dragUnavailable);
      return;
    }
    const insertion = captureReferenceInsertion(editor, location.pos);
    const disconnect = window.desktopApi?.onLocalSpaceTransition?.(() => insertion.dispose());
    pending.current = true;
    setError('');
    try {
      const prepared = await payload.prepare?.();
      if (payload.prepare && !prepared) throw new Error('REFERENCE_SAVE_FAILED');
      const api = contentLibraryApi();
      const nodes = [];
      for (const item of payload.targets) {
        insertion.selection();
        let { target, preview } = await resolveBodyTarget(preparedTarget(item, prepared));
        const following = target.source.kind === 'ARTICLE';
        if (following) {
          if (source?.kind === 'ARTICLE' && source.id === target.source.id && !target.blockId)
            throw new Error('REFERENCE_FOLLOW_NESTED');
          target = { ...target, source: { kind: 'ARTICLE', id: target.source.id } };
          const existing = preview.spaceId ? sessions?.find(preview.spaceId, target.source.id) : undefined;
          if (existing && !(await existing.flush('manual'))) throw new Error('REFERENCE_SAVE_FAILED');
          preview = await api.referenceInspect(target);
        }
        insertion.selection();
        const reference = following
          ? await api.referenceFollow(preview.target, preview.version)
          : await api.referenceCapture(preview.target, preview.version, preview.resolutionId);
        insertion.selection();
        nodes.push(
          editor.schema.nodes.contentReference.create({
            blockId: crypto.randomUUID(),
            referenceId: reference.id,
            referenceSpaceId: reference.spaceId ?? null,
            referencePresentation: following ? followingPresentation : null,
            referenceEditing: 'READ_ONLY',
          }),
        );
      }
      const transaction = closeHistory(editor.state.tr).setSelection(insertion.selection());
      transaction.replaceSelection(new Slice(Fragment.fromArray(nodes), 0, 0));
      transaction.setSelection(TextSelection.near(transaction.doc.resolve(transaction.selection.to)));
      revealInsertedReferences(
        transaction,
        nodes.map((node) => String(node.attrs.blockId)),
      );
      editor.view.dispatch(transaction.scrollIntoView());
      editor.view.focus();
    } catch (reason) {
      if (!editor.isDestroyed) setError(referenceFailure(reason, copy));
    } finally {
      insertion.dispose();
      disconnect?.();
      pending.current = false;
    }
  };
  return {
    error,
    onDragOverCapture(event: DragEvent) {
      if (!accepts(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = editor.isEditable && !pending.current ? 'link' : 'none';
    },
    onDropCapture: (event: DragEvent) => {
      void insert(event);
    },
  };
}
