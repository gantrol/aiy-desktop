import { Extension } from '@tiptap/core';
import { plainTextBlockDocument } from '@/shared/block-document-codecs';
import type { BlockDocument, BlockNode } from '@/shared/contracts/block-document';
import type { MessageCatalog } from '@/renderer/i18n/types';

export const MAX_IMAGE_PROMPTS = 10;
type PlanCopy = MessageCatalog['creator']['imagePromptPlan'];

// A regular editable quote/list, persisted with the rest of the prompt document.
export const ImagePromptPlanExtension = Extension.create({
  name: 'imagePromptPlan',
  addGlobalAttributes() {
    return [
      {
        types: ['blockquote'],
        attributes: {
          imagePromptPlan: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute('data-image-prompt-plan') === 'true' || null,
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.imagePromptPlan ? { 'data-image-prompt-plan': 'true' } : {},
          },
        },
      },
    ];
  },
});

export function imagePromptPlanNode(document: BlockDocument | undefined) {
  return document?.root.content?.find((node) => node.type === 'blockquote' && node.attrs?.imagePromptPlan === true);
}

function nodeText(node: BlockNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  return (node.content ?? []).map(nodeText).join(node.type === 'paragraph' ? '' : '\n');
}

export function readImagePromptPlan(document: BlockDocument | undefined): string[] {
  const plan = imagePromptPlanNode(document);
  return (
    plan?.content
      ?.find((node) => node.type === 'orderedList')
      ?.content?.map((item) => (item.content ?? []).slice(1).map(nodeText).join('\n')) ?? []
  );
}

export function createImagePromptPlan(prompts: readonly string[], copy: PlanCopy): BlockNode {
  if (!prompts.length || prompts.length > MAX_IMAGE_PROMPTS || prompts.some((prompt) => !prompt.trim())) {
    throw new Error('IMAGE_PROMPT_PLAN_INVALID');
  }
  const paragraph = (text: string): BlockNode => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  return {
    type: 'blockquote',
    attrs: { imagePromptPlan: true },
    content: [
      paragraph(copy.instruction.replace('{count}', String(prompts.length))),
      {
        type: 'orderedList',
        content: prompts.map((prompt, index) => ({
          type: 'listItem',
          content: [
            paragraph(copy.image.replace('{index}', String(index + 1))),
            ...(plainTextBlockDocument(prompt.trim()).root.content ?? []),
          ],
        })),
      },
    ],
  };
}
