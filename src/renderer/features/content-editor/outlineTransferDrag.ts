import type { Editor } from '@tiptap/core';
import type { ReferenceHost } from '@/renderer/features/content-editor/ContentReferenceHost';
import type { OutlineDropPlacement } from '@/shared/outline-move';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { outlinePlacementWithinFocus, outlineViewState } from '@/renderer/features/content-editor/outlineViewState';

const transferType = 'application/x-aiy-outline-transfer';
interface Session {
  token: string;
  editor: Editor;
  host: ReferenceHost;
  ids: string[];
  document: Editor['state']['doc'];
}
let active: Session | null = null;

export function beginOutlineTransfer(transfer: DataTransfer, editor: Editor, host: ReferenceHost, ids: string[]) {
  const token = crypto.randomUUID();
  active = {
    token,
    editor,
    host,
    ids,
    document: editor.state.doc,
  };
  transfer.setData(transferType, token);
  window.addEventListener(
    'dragend',
    () => {
      if (active?.token === token) active = null;
    },
    { once: true },
  );
}

export function outlineTransferSource(transfer: DataTransfer, target: Editor, host: ReferenceHost) {
  if (!active || !transfer.types.includes(transferType) || active.editor === target) return null;
  const token = transfer.getData(transferType);
  if (token && token !== active.token) return null;
  if (
    active.host.source?.kind !== 'ARTICLE' ||
    host.source?.kind !== 'ARTICLE' ||
    active.host.source.id === host.source.id ||
    !active.host.beforeCapture ||
    !host.beforeCapture ||
    !active.host.onTransferSaved ||
    !host.onTransferSaved
  )
    return null;
  return active;
}

export async function dropOutlineTransfer(
  session: Session,
  editor: Editor,
  host: ReferenceHost,
  targetId: string,
  placement: OutlineDropPlacement,
  copy: boolean,
) {
  const sourceEditor = session.editor;
  const before = editor.state.doc;
  const focus = outlineViewState(editor.state).focus;
  const current = () => {
    if (
      editor.isDestroyed ||
      (!sourceEditor.isDestroyed && (sourceEditor.view.composing || !sourceEditor.state.doc.eq(session.document))) ||
      editor.view.composing ||
      !editor.state.doc.eq(before) ||
      outlineViewState(editor.state).focus !== focus ||
      !outlinePlacementWithinFocus(editor.state.doc, outlineViewState(editor.state), [], targetId, placement)
    )
      throw new Error('REFERENCE_TARGET_CHANGED');
  };
  if ((!sourceEditor.isDestroyed && !sourceEditor.isEditable) || !editor.isEditable)
    throw new Error('REFERENCE_TARGET_CHANGED');
  current();
  if (!sourceEditor.isDestroyed) sourceEditor.setEditable(false, false);
  editor.setEditable(false, false);
  try {
    const source = await session.host.beforeCapture!();
    const target = await host.beforeCapture!();
    current();
    if (source?.kind !== 'ARTICLE' || target?.kind !== 'ARTICLE' || !source.revisionId || !target.revisionId)
      throw new Error('REFERENCE_SAVE_FAILED');
    const result = await contentLibraryApi().outlineTransfer({
      sourceArticleId: source.id,
      sourceRevisionId: source.revisionId,
      targetArticleId: target.id,
      targetRevisionId: target.revisionId,
      selectedIds: session.ids,
      targetId,
      placement,
      copy,
    });
    session.host.onTransferSaved!(result.source);
    host.onTransferSaved!(result.target);
  } finally {
    if (!sourceEditor.isDestroyed) sourceEditor.setEditable(true, false);
    if (!editor.isDestroyed) editor.setEditable(true, false);
  }
}
