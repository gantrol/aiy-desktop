import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { EditorContent } from '@tiptap/react';
import { ContentDocumentOutline } from '@/renderer/features/content-editor/ContentDocumentOutline';
import { useContentEditor } from '@/renderer/features/content-editor/useContentEditor';
import { useI18n } from '@/renderer/i18n/useI18n';
import { editorSampleDocument } from '../component-lab/editorSampleDocument';

function OutlineSample({ blank }: { blank: boolean }) {
  const copy = useI18n().messages;
  const [document] = useState(() => editorSampleDocument(copy.designLab.storybook.sample, blank));
  const editor = useContentEditor({
    content: document.root,
    editable: true,
    presentation: { typography: 'compact', ariaLabel: copy.designLab.components.editor },
  });
  return editor ? (
    <div className="grid h-full min-h-0 grid-cols-[16rem_minmax(0,1fr)]">
      <div className="min-h-0 overflow-auto border-r p-3">
        <ContentDocumentOutline editor={editor} />
      </div>
      <div className="min-h-0 overflow-auto p-6">
        <EditorContent editor={editor} />
      </div>
    </div>
  ) : null;
}

const meta = {
  id: 'creation-outline',
  title: 'Creation/Outline',
  component: ContentDocumentOutline,
  args: { blank: false },
  parameters: { controls: { include: ['blank'] } },
  render: ({ blank }) => <OutlineSample key={String(blank)} blank={blank} />,
} satisfies Meta<React.ComponentProps<typeof ContentDocumentOutline> & { blank: boolean }>;
export default meta;
type Story = StoryObj<{ blank: boolean }>;
export const Existing: Story = { name: 'Existing draft' };
export const Blank: Story = { name: 'Blank', args: { blank: true } };
