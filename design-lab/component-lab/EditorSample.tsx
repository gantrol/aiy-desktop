import { useRef, useState } from 'react';
import { EditorContent } from '@tiptap/react';
import { ContentDocumentWorkspace } from '@/renderer/features/content-editor/ContentDocumentWorkspace';
import { useContentEditor } from '@/renderer/features/content-editor/useContentEditor';
import { useI18n } from '@/renderer/i18n/useI18n';
import { editorSampleDocument } from './editorSampleDocument';

function EditorSession({ blank, readOnly }: { blank: boolean; readOnly: boolean }) {
  const labels = useI18n().messages.designLab;
  const copy = labels.components;
  const [document] = useState(() => editorSampleDocument(labels.storybook.sample, blank));
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const editor = useContentEditor({
    content: document.root,
    editable: !readOnly,
    presentation: { typography: 'compact', ariaLabel: copy.editor, className: 'min-h-64' },
  });
  return (
    <div className="flex h-full min-h-0 bg-surface">
      <ContentDocumentWorkspace
        documentWidth="WIDE"
        scrollRootRef={scrollRootRef}
        title={<h1 className="text-lg font-medium">{copy.frames[blank ? 'E01' : 'E02']}</h1>}
      >
        <EditorContent editor={editor} />
      </ContentDocumentWorkspace>
    </div>
  );
}

export function EditorSample({ blank = false, readOnly = false }: { blank?: boolean; readOnly?: boolean }) {
  return <EditorSession key={String(blank)} blank={blank} readOnly={readOnly} />;
}
