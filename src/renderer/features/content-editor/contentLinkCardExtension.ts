import { Node, mergeAttributes, type Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { ContentLinkCard } from '@/renderer/features/content-editor/ContentLinkCard';
import { linkCardApplicationSchema, linkCardTarget } from '@/shared/contracts/link-card';
import { linkCardMarkdown, paragraphLinkCard } from '@/shared/link-card-document';

export function convertLinkCard(editor: Editor, position: number, action: 'card' | 'text' = 'card') {
  if (editor.isDestroyed || !editor.isEditable || editor.view.composing) return false;
  const toText = action === 'text';
  const node = editor.state.doc.nodeAt(position);
  if (!node) return false;
  const card = toText ? null : paragraphLinkCard(node.toJSON());
  if (toText ? node.type.name !== 'linkCard' : !card) return false;
  const next = toText
    ? editor.schema.nodes.paragraph.create(
        { blockId: node.attrs.blockId, linkCardDisabled: true },
        editor.schema.text(node.attrs.title || node.attrs.url, [
          editor.schema.marks.link.create({ href: node.attrs.url }),
        ]),
      )
    : editor.schema.nodeFromJSON(card!);
  const transaction = closeHistory(editor.state.tr).replaceWith(position, position + node.nodeSize, next);
  transaction.setSelection(
    toText
      ? TextSelection.near(transaction.doc.resolve(position + 1))
      : NodeSelection.create(transaction.doc, position),
  );
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
  return true;
}

export const ContentLinkCardExtension = Node.create({
  name: 'linkCard',
  priority: 110,
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: () => ({
    url: { default: '', rendered: false },
    title: { default: null, rendered: false },
    application: { default: null, rendered: false },
  }),
  addGlobalAttributes: () => [
    {
      types: ['paragraph'],
      attributes: {
        linkCardDisabled: {
          default: false,
          parseHTML: (element) => element.hasAttribute('data-aiy-link-text'),
          renderHTML: (attrs) => (attrs.linkCardDisabled ? { 'data-aiy-link-text': '' } : {}),
        },
      },
    },
  ],
  parseHTML: () => [
    {
      tag: 'div[data-aiy-link-card]',
      getAttrs: (element) => {
        const target = linkCardTarget(element.getAttribute('data-aiy-link-card'));
        if (!target) return false;
        let application = null;
        try {
          application = linkCardApplicationSchema.parse(
            JSON.parse(element.getAttribute('data-aiy-link-application') ?? 'null'),
          );
        } catch {
          /* A missing or unsupported relationship remains an ordinary link. */
        }
        return { url: target.url, title: element.getAttribute('data-title')?.slice(0, 500) ?? null, application };
      },
    },
  ],
  renderHTML: ({ node, HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, {
      'data-aiy-link-card': node.attrs.url,
      'data-title': node.attrs.title,
      ...(node.attrs.application ? { 'data-aiy-link-application': JSON.stringify(node.attrs.application) } : {}),
    }),
    ['a', { href: node.attrs.url }, node.attrs.title || node.attrs.url],
  ],
  renderText: ({ node }) => node.attrs.url,
  renderMarkdown: linkCardMarkdown,
  addNodeView: () => ReactNodeViewRenderer(ContentLinkCard),
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        if (!this.editor.isEditable || this.editor.view.composing) return false;
        const { selection } = this.editor.state;
        if (selection instanceof NodeSelection && selection.node.type.name === this.name) {
          return this.editor
            .chain()
            .insertContentAt(selection.to, { type: 'paragraph' })
            .setTextSelection(selection.to + 1)
            .run();
        }
        return false;
      },
    };
  },
});
