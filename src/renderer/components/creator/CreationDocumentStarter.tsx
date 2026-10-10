import { useState, type ComponentProps, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { CreatorPromptComposer } from '@/renderer/components/creator/CreatorPromptComposer';
import { CreationDocumentToolbar } from '@/renderer/components/creator/CreationDocumentToolbar';
import { Textarea } from '@/renderer/components/ui/textarea';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  composer: Omit<ComponentProps<typeof CreatorPromptComposer>, 'presentation' | 'placeholder' | 'ariaLabel'>;
  title: string;
  onTitleChange(title: string): void;
  materials: ReactNode;
  references: ReactNode;
  assistance?(editor: Editor | null): ReactNode;
  directions?: ReactNode;
}

export function CreationDocumentStarter({
  composer,
  title,
  onTitleChange,
  materials,
  references,
  assistance,
  directions,
}: Props) {
  const labels = useI18n().messages.creator.starter;
  const [editor, setEditor] = useState<Editor | null>(null);
  return (
    <div
      className="@container/creation-document min-h-0 min-w-0 flex-1 overflow-y-auto bg-surface"
      data-creation-document-workspace
    >
      <div className="sticky top-0 z-20 border-b bg-surface px-2" data-creation-document-toolbar>
        <div className="mx-auto max-w-3xl">
          <CreationDocumentToolbar editor={editor} materials={materials} outlineMode={composer.outlineMode}>
            {assistance?.(editor)}
          </CreationDocumentToolbar>
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl px-3 pb-10 pt-4 @min-[32rem]/creation-document:px-6 @min-[32rem]/creation-document:pt-6">
        <div className="mb-4 pl-7 empty:hidden">{references}</div>
        <div>
          <Textarea
            value={title}
            aria-label={labels.title}
            maxLength={200}
            rows={1}
            className="mb-2 min-h-10 field-sizing-content resize-none overflow-hidden rounded-none border-0 bg-transparent py-1 pl-7 pr-0 text-xl font-semibold leading-snug shadow-none focus-visible:ring-inset focus-visible:ring-offset-0 @min-[32rem]/creation-document:text-2xl"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.preventDefault();
            }}
            onChange={(event) => onTitleChange(event.target.value.replace(/[\r\n]+/g, ' '))}
          />
          <CreatorPromptComposer
            {...composer}
            onEditorChange={setEditor}
            presentation="document"
            placeholder={labels.placeholder}
            ariaLabel={labels.draftBody}
          />
        </div>
        {directions && <div className="mt-8 pl-7 @container/creation-directions">{directions}</div>}
      </div>
    </div>
  );
}
