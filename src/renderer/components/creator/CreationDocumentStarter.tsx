import { useState, type ComponentProps, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { CreatorPromptComposer } from '@/renderer/components/creator/CreatorPromptComposer';
import { CreationDocumentToolbar } from '@/renderer/components/creator/CreationDocumentToolbar';
import { Input } from '@/renderer/components/ui/input';
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
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-surface" data-creation-document-workspace>
      <div className="sticky top-0 z-20 border-b bg-surface px-2" data-creation-document-toolbar>
        <div className="mx-auto max-w-3xl">
          <CreationDocumentToolbar editor={editor} materials={materials} outlineMode={composer.outlineMode}>
            {assistance?.(editor)}
          </CreationDocumentToolbar>
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl px-3 pb-10 pt-8 sm:px-6">
        {references}
        <div>
          <Input
            value={title}
            aria-label={labels.title}
            maxLength={200}
            className="mb-4 h-12 rounded-none border-0 bg-transparent px-10 text-2xl font-semibold shadow-none focus-visible:ring-inset focus-visible:ring-offset-0"
            onChange={(event) => onTitleChange(event.target.value)}
          />
          <CreatorPromptComposer
            {...composer}
            onEditorChange={setEditor}
            presentation="document"
            placeholder={labels.placeholder}
            ariaLabel={labels.draftBody}
          />
        </div>
        {directions && <div className="mt-8 px-10 @container/creation-directions">{directions}</div>}
      </div>
    </div>
  );
}
