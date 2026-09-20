import { Extension } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const headingAnchorsKey = new PluginKey<DecorationSet>('contentHeadingAnchors');

function headingAnchors(document: Node) {
  const decorations: Decoration[] = [];
  document.descendants((node, position) => {
    if (node.type.name !== 'heading' || node.attrs.level < 2 || node.attrs.level > 6) return;
    decorations.push(
      Decoration.node(position, position + node.nodeSize, {
        'data-article-heading-id': `article-heading-${decorations.length + 1}`,
      }),
    );
  });
  return DecorationSet.create(document, decorations);
}

// Let ProseMirror own these display attributes. Writing them into its DOM after
// an autosave marks heading nodes as externally changed and redraws the body.
export const ContentHeadingAnchors = Extension.create({
  name: 'contentHeadingAnchors',
  addProseMirrorPlugins: () => [
    new Plugin({
      key: headingAnchorsKey,
      state: {
        init: (_configuration, state) => headingAnchors(state.doc),
        apply: (transaction, decorations) => (transaction.docChanged ? headingAnchors(transaction.doc) : decorations),
      },
      props: { decorations: (state) => headingAnchorsKey.getState(state) ?? DecorationSet.empty },
    }),
  ],
});
