import { captureBlockDocument } from '@/shared/contracts/block-document';
import type { MessageCatalog } from '@/renderer/i18n/types';

export function editorSampleDocument(copy: MessageCatalog['designLab']['storybook']['sample'], blank = false) {
  const paragraph = (id: string, text: string) => ({
    type: 'paragraph',
    attrs: { blockId: id },
    content: [{ type: 'text', text }],
  });
  const heading = (id: string, text: string) => ({
    type: 'heading',
    attrs: { blockId: id, level: 2 },
    content: [{ type: 'text', text }],
  });
  return captureBlockDocument({
    type: 'doc',
    content: blank
      ? [{ type: 'paragraph', attrs: { blockId: 'sample-start' } }]
      : [
          heading('sample-question', copy.heading),
          paragraph('sample-body', copy.body),
          heading('sample-step', copy.secondHeading),
          paragraph('sample-result', copy.secondBody),
        ],
  });
}
