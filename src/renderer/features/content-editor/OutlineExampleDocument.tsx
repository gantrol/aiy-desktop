import { useState } from 'react';
import { EditorContent } from '@tiptap/react';
import { Button } from '@/renderer/components/ui/button';
import {
  ContentDocumentOutline,
  followContentBlockAnchor,
} from '@/renderer/features/content-editor/ContentDocumentOutline';
import { useContentEditor } from '@/renderer/features/content-editor/useContentEditor';
import { useI18n } from '@/renderer/i18n/useI18n';
import { outlineExampleMarkdown } from '@/shared/outline-example-export';
import { captureBlockDocument, type BlockDocument } from '@/shared/contracts/block-document';

interface Props {
  createDocument(): BlockDocument;
  fileStem: string;
  title: string;
}

/** A separate editor and undo history for each visited example; never writes to the library. */
export function OutlineExampleDocument({ createDocument, fileStem, title }: Props) {
  const copy = useI18n().messages.referenceOutline;
  const [initialDocument] = useState(createDocument);
  const [navigationError, setNavigationError] = useState('');
  const [resetting, setResetting] = useState(false);
  const editor = useContentEditor({
    presentation: { typography: 'compact', ariaLabel: title, className: 'min-h-64' },
    content: initialDocument.root,
    editable: true,
  });
  if (!editor) return null;
  const download = (content: string, extension: 'md' | 'json') => {
    const url = URL.createObjectURL(
      new Blob([content], {
        type: extension === 'md' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8',
      }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${fileStem}.${extension}`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2" aria-label={title}>
      {navigationError && (
        <p role="alert" className="text-xs text-destructive">
          {navigationError}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={() => setResetting(true)}>
          {copy.reset}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => download(outlineExampleMarkdown(captureBlockDocument(editor.getJSON())), 'md')}
        >
          {copy.export}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => download(JSON.stringify(captureBlockDocument(editor.getJSON()), null, 2), 'json')}
        >
          {copy.exportJson}
        </Button>
      </div>
      {resetting && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-xs">
          {copy.resetConfirm}
          <Button
            size="sm"
            onClick={() => {
              editor.commands.setContent(createDocument().root);
              setResetting(false);
              setNavigationError('');
            }}
          >
            {copy.reset}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setResetting(false)}>
            {copy.back}
          </Button>
        </div>
      )}
      <div
        data-outline-workspace
        className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-[minmax(14rem,0.8fr)_minmax(0,1.6fr)]"
      >
        <ContentDocumentOutline editor={editor} />
        <div
          data-outline-document
          className="min-h-0 overflow-y-auto border-l pl-3"
          onClickCapture={(event) => {
            const found = followContentBlockAnchor(editor, event);
            if (found !== undefined) setNavigationError(found ? '' : copy.locationMissing);
          }}
        >
          <EditorContent editor={editor} className="min-w-0" />
        </div>
      </div>
    </section>
  );
}
