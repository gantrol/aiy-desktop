import { useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { TextSelection } from '@tiptap/pm/state';
import { Fragment, Slice } from '@tiptap/pm/model';
import { useEditorState } from '@tiptap/react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ContentReferencePicker } from '@/renderer/features/content-editor/ContentReferencePicker';
import { captureReferenceInsertion } from '@/renderer/features/content-editor/referenceInsertion';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { useArticleEditorSessions } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import type { ContentReference } from '@/shared/contracts/content-library';
import { referenceEditableDocument } from '@/shared/content-reference-document';
import { referenceParentHeading } from '@/renderer/features/content-editor/referenceParentHeading';
import { revealInsertedReferences } from '@/renderer/features/content-editor/referenceToolbarState';

export function ContentReferenceInsertAction({
  editor,
  menuItem,
  adopt,
}: {
  editor: Editor;
  menuItem: boolean;
  adopt(reference: ContentReference): void;
}) {
  const copy = useI18n().messages.referenceOutline;
  const sessions = useArticleEditorSessions();
  const capture = useRef<ReturnType<typeof captureReferenceInsertion> | null>(null);
  const parentLevel = useEditorState({
    editor,
    selector: ({ editor: current }) => referenceParentHeading(current.state.doc, current.state.selection.from),
  });
  useEffect(() => () => capture.current?.dispose(), [editor]);
  return (
    <ContentReferencePicker
      following
      label={copy.insertContent}
      menuItem={menuItem}
      parentLevel={parentLevel}
      allowCopy
      allowLink
      allowSync={Boolean(sessions)}
      onOpenChange={(open) => {
        if (open) {
          capture.current?.dispose();
          capture.current = captureReferenceInsertion(editor);
        } else {
          if (capture.current && !editor.isDestroyed) {
            try {
              editor.view.dispatch(editor.state.tr.setSelection(capture.current.selection()));
              editor.view.focus();
            } catch {
              /* The original selection was edited or removed; never steal another editor's focus. */
            }
          }
          capture.current?.dispose();
          capture.current = null;
        }
      }}
      prepareSource={async (target) => {
        if (target.source.kind !== 'ARTICLE' || !sessions) return;
        const location = await contentLibraryApi().referenceOpen(target);
        const source = sessions.find(location.spaceId, location.article.id);
        if (source && !(await source.flush('manual'))) throw new Error('REFERENCE_SAVE_FAILED');
      }}
      onInsert={(reference, presentation, mode) => {
        if (!capture.current) throw new Error('REFERENCE_TARGET_CHANGED');
        const selection = capture.current.selection();
        const blockId = crypto.randomUUID();
        const transaction = closeHistory(editor.state.tr).setSelection(selection);
        if (mode === 'COPY') {
          const document = referenceEditableDocument(
            reference,
            presentation,
            referenceParentHeading(editor.state.doc, selection.from),
          );
          const nodes = (document.root.content ?? []).map((node) => editor.schema.nodeFromJSON(node));
          nodes.forEach((node) => node.check());
          adopt(reference);
          transaction.replaceSelection(new Slice(Fragment.fromArray(nodes), 0, 0));
        } else
          transaction.replaceSelectionWith(
            editor.schema.nodes.contentReference.create({
              blockId,
              referenceId: reference.id,
              referenceSpaceId: reference.spaceId ?? null,
              referencePresentation: presentation ?? null,
              referenceEditing: mode === 'SYNC' ? 'SOURCE' : 'READ_ONLY',
            }),
          );
        transaction.setSelection(TextSelection.near(transaction.doc.resolve(transaction.selection.to), 1));
        if (mode !== 'COPY') revealInsertedReferences(transaction, [blockId]);
        capture.current.dispose();
        capture.current = null;
        editor.view.dispatch(transaction.scrollIntoView());
        editor.view.focus();
      }}
    />
  );
}
