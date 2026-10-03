import type { Editor } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { readReferenceDrag } from '@/renderer/lib/itemReferenceDrag';
import type { useArticleEditorSessions } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { followingPresentation } from '@/shared/content-reference-token';
import type { ContentSource, ReferenceTarget } from '@/shared/contracts/content-source';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { resolveDroppedContentLinks } from '@/renderer/features/content-editor/contentLinkDrop';
import { captureReferenceInsertion } from '@/renderer/features/content-editor/referenceInsertion';
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

/** Keep asynchronous drops at the pointer's original position in the receiving view. */
export async function dropContentReferences({
  editor,
  view,
  position,
  payload,
  source,
  sessions,
  linkSpaceId,
}: {
  editor: Editor;
  view: EditorView;
  position: number;
  payload: NonNullable<ReturnType<typeof readReferenceDrag>>;
  source?: ContentSource;
  sessions: ReturnType<typeof useArticleEditorSessions>;
  linkSpaceId?: string;
}) {
  const insertion = captureReferenceInsertion(editor, position, view);
  const disconnect = window.desktopApi?.onLocalSpaceTransition?.(() => insertion.dispose());
  try {
    const nodes = [];
    if (linkSpaceId) {
      const links = await resolveDroppedContentLinks(payload, linkSpaceId, () => insertion.selection());
      for (const link of links)
        nodes.push(
          editor.schema.nodes.paragraph.create(
            { blockId: crypto.randomUUID() },
            editor.schema.text(link.title || link.url, [editor.schema.marks.link.create({ href: link.url })]),
          ),
        );
    } else {
      const prepared = await payload.prepare?.();
      if (payload.prepare && !prepared) throw new Error('REFERENCE_SAVE_FAILED');
      const api = contentLibraryApi();
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
        if (preview.spaceId !== reference.spaceId) throw new Error('REFERENCE_TARGET_CHANGED');
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
    }
    const transaction = closeHistory(editor.state.tr).setSelection(insertion.selection());
    transaction.replaceSelection(new Slice(Fragment.fromArray(nodes), 0, 0));
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(transaction.selection.to)));
    transaction.removeStoredMark(editor.schema.marks.link);
    revealInsertedReferences(
      transaction,
      nodes.filter((node) => node.type.name === 'contentReference').map((node) => String(node.attrs.blockId)),
    );
    view.dispatch(transaction.setMeta('preventAutolink', true).scrollIntoView());
    view.dispatch(closeHistory(editor.state.tr).setMeta('addToHistory', false));
  } finally {
    insertion.dispose();
    disconnect?.();
  }
}
