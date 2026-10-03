import { useEffect, useRef } from 'react';
import { EditorContent } from '@tiptap/react';
import { useContentEditor } from '@/renderer/features/content-editor/useContentEditor';
import { followContentBlockAnchor } from '@/renderer/features/content-editor/ContentDocumentOutline';
import { captureBlockDocument } from '@/shared/contracts/block-document';
import { useI18n } from '@/renderer/i18n/useI18n';
import { workTitle } from './workTitle';
import type { EditorSession, Work, WorkbenchError } from './types';

interface Props {
  work: Work;
  active: boolean;
  register(id: string, session: EditorSession | null): void;
  onError(error: WorkbenchError | null): void;
}

/** A visited work keeps its actual editor, selection and undo history until the lab closes. */
export function WorkEditor({ work, active, register, onError }: Props) {
  const title = workTitle(work, useI18n().messages.designLab.themeCreation);
  const revision = useRef(0);
  const initial = useRef(work.document);
  const editor = useContentEditor({
    presentation: { typography: 'compact', ariaLabel: title, className: 'min-h-64' },
    content: initial.current.root,
    editable: true,
    onUpdate: () => {
      revision.current += 1;
    },
  });
  useEffect(() => {
    if (!editor) return;
    register(work.id, {
      editor,
      capture: () => ({ document: captureBlockDocument(editor.getJSON()), revision: revision.current }),
    });
    return () => register(work.id, null);
  }, [editor, register, work.id]);
  return (
    <section
      hidden={!active}
      aria-label={title}
      className={active ? 'min-h-0 flex-1 overflow-auto px-6 py-6 sm:px-10' : 'hidden'}
      onClickCapture={(event) => {
        if (!editor) return;
        const found = followContentBlockAnchor(editor, event);
        if (found !== undefined) onError(found ? null : 'locationMissing');
      }}
    >
      <div className="mx-auto max-w-3xl">
        <EditorContent editor={editor} />
      </div>
    </section>
  );
}
