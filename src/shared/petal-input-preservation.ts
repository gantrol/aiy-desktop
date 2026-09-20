import type { BlockDocument } from '@/shared/contracts/block-document';

/** Only ordinary empty paragraphs are disposable; a structural or media-only draft is not blank. */
export function isBlankPetalInput(input: {
  text: string;
  title?: string;
  referenceAssetIds?: readonly string[];
  document?: BlockDocument;
}): boolean {
  if (input.text.trim() || input.title?.trim() || input.referenceAssetIds?.length) return false;
  return (
    !input.document ||
    (input.document.root.content ?? []).every((node) => node.type === 'paragraph' && !node.content?.length)
  );
}
