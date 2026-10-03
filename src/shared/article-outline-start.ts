import type { ArticleContentInput } from '@/shared/contracts/article';
import { blockDocumentIsEmpty, captureBlockDocument } from '@/shared/contracts/block-document';
import type { BlockDocument } from '@/shared/contracts/block-document';
import { blockDocumentMarkdown } from '@/shared/block-document-codecs';

/** Only the initial empty paragraph qualifies. Whitespace, headings, lists and images are content. */
export function canStartArticleOutline(document: BlockDocument | undefined, editorMode?: 'OUTLINE') {
  return editorMode !== 'OUTLINE' && Boolean(document && blockDocumentIsEmpty(document));
}

export function startArticleOutlineContent(content: ArticleContentInput): ArticleContentInput {
  if (!content.document || !canStartArticleOutline(content.document, content.editorMode))
    throw new Error('ARTICLE_OUTLINE_START_NOT_EMPTY');
  const document = captureBlockDocument({
    ...content.document.root,
    content: [
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            // Keep the existing paragraph identity and attributes, including any anchors.
            content: content.document.root.content?.length ? content.document.root.content : [{ type: 'paragraph' }],
          },
        ],
      },
    ],
  });
  return {
    ...content,
    schemaVersion: 2,
    editorMode: 'OUTLINE',
    document,
    markdown: blockDocumentMarkdown(document, content.mediaBindings),
  };
}
