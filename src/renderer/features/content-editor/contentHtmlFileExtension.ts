import { Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { ContentHtmlFile } from '@/renderer/features/content-editor/ContentHtmlFile';
import { htmlFileAttributesSchema } from '@/shared/contracts/html-file';
import { htmlFileMarkdown } from '@/shared/html-file-document';

export const ContentHtmlFileExtension = Node.create({
  name: 'htmlFile',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({
    objectHash: { default: '', rendered: false },
    fileName: { default: '', rendered: false },
    spaceId: { default: '', rendered: false },
  }),
  parseHTML: () => [
    {
      tag: 'span[data-aiy-html-file]',
      getAttrs: (element) => {
        try {
          return htmlFileAttributesSchema.parse(JSON.parse(element.getAttribute('data-aiy-html-file')!));
        } catch {
          return false;
        }
      },
    },
  ],
  renderHTML: ({ node }) => ['span', { 'data-aiy-html-file': JSON.stringify(node.attrs) }, node.attrs.fileName],
  renderText: ({ node }) => node.attrs.fileName,
  renderMarkdown: htmlFileMarkdown,
  addNodeView: () => ReactNodeViewRenderer(ContentHtmlFile),
});
