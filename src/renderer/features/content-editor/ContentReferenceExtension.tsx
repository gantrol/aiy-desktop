import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { contentReferenceToken, type ContentReference } from '@/shared/contracts/content-library';
import {
  parseContentReferenceToken,
  referencePresentationAttribute,
  referenceEditingAttribute,
} from '@/shared/content-reference-token';
import { ContentReferenceNode } from '@/renderer/features/content-editor/ContentReferenceNode';
import { referenceToolbarPlugin } from '@/renderer/features/content-editor/referenceToolbarState';

export function contentReferenceExtension(adopt: (reference: ContentReference) => void) {
  return Node.create({
    name: 'contentReference',
    group: 'block',
    atom: true,
    draggable: true,
    addOptions: () => ({ adopt }),
    addAttributes: () => ({
      referenceId: { default: '' },
      referencePresentation: { default: null, rendered: false },
      referenceSpaceId: { default: null, rendered: false },
      referenceEditing: { default: null, rendered: false },
    }),
    parseHTML: () => [
      {
        tag: 'div[data-aiy-reference]',
        getAttrs: (element) => {
          const raw = element.getAttribute('data-aiy-reference-presentation');
          try {
            return {
              referenceId: element.getAttribute('data-aiy-reference'),
              referenceSpaceId: element.getAttribute('data-aiy-reference-space'),
              referenceEditing: referenceEditingAttribute(element.getAttribute('data-aiy-reference-editing')),
              referencePresentation: raw ? referencePresentationAttribute(JSON.parse(raw)) : null,
            };
          } catch {
            return false;
          }
        },
      },
    ],
    renderHTML: ({ node, HTMLAttributes }) => [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-aiy-reference': node.attrs.referenceId,
        ...(node.attrs.referenceSpaceId ? { 'data-aiy-reference-space': node.attrs.referenceSpaceId } : {}),
        ...(node.attrs.referenceEditing
          ? { 'data-aiy-reference-editing': referenceEditingAttribute(node.attrs.referenceEditing) }
          : {}),
        ...(node.attrs.referencePresentation
          ? {
              'data-aiy-reference-presentation': JSON.stringify(
                referencePresentationAttribute(node.attrs.referencePresentation),
              ),
            }
          : {}),
      }),
      contentReferenceToken(
        String(node.attrs.referenceId),
        referencePresentationAttribute(node.attrs.referencePresentation),
        node.attrs.referenceSpaceId,
        node.attrs.referenceEditing == null ? undefined : referenceEditingAttribute(node.attrs.referenceEditing),
      ),
    ],
    markdownTokenName: 'aiyBlockReference',
    markdownTokenizer: {
      name: 'aiyBlockReference',
      level: 'block',
      start: ':::aiy-block ',
      tokenize: (source) => {
        const match = parseContentReferenceToken(source);
        return match
          ? {
              type: 'aiyBlockReference',
              raw: match.raw,
              referenceId: match.referenceId,
              referencePresentation: match.presentation,
              referenceSpaceId: match.spaceId,
              referenceEditing: match.editing,
            }
          : undefined;
      },
    },
    parseMarkdown: (token, helpers) =>
      helpers.createNode('contentReference', {
        referenceId: token.referenceId,
        referencePresentation: token.referencePresentation ?? null,
        referenceSpaceId: token.referenceSpaceId ?? null,
        referenceEditing: token.referenceEditing ?? null,
      }),
    renderMarkdown: (node) =>
      contentReferenceToken(
        String(node.attrs?.referenceId),
        referencePresentationAttribute(node.attrs?.referencePresentation),
        node.attrs?.referenceSpaceId,
        node.attrs?.referenceEditing == null ? undefined : referenceEditingAttribute(node.attrs.referenceEditing),
      ),
    addProseMirrorPlugins: () => [referenceToolbarPlugin()],
    addNodeView: () => ReactNodeViewRenderer(ContentReferenceNode),
  });
}
