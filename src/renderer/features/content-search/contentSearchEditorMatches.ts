import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { contentSearchHighlights, contentSearchTerms } from '@/shared/content-search-highlights';

export interface ContentSearchEditorMatch {
  from: number;
  to: number;
}

/** Resolve saved-search terms against the live document, never stale Markdown offsets. */
export function contentSearchEditorMatches(document: Node, query: string): ContentSearchEditorMatch[] {
  const terms = contentSearchTerms(query);
  const matches: ContentSearchEditorMatch[] = [];
  if (!terms.length) return matches;
  document.descendants((node, position) => {
    if (node.type.name === 'contentReference') return false;
    if (!node.isTextblock) return;
    let text = '';
    node.forEach((child) => {
      // Atoms occupy document positions but must not join words across embedded content.
      text += child.isText ? child.text : '\0'.repeat(child.nodeSize);
    });
    for (const match of contentSearchHighlights(text, terms))
      matches.push({ from: position + 1 + match.start, to: position + 1 + match.end });
    return false;
  });
  return matches;
}

export const contentSearchPositionKey = new PluginKey<DecorationSet>('aiy-content-search-position');

export function contentSearchPositionPlugin() {
  return new Plugin<DecorationSet>({
    key: contentSearchPositionKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (transaction, current) => {
        const request = transaction.getMeta(contentSearchPositionKey) as
          { matches: readonly ContentSearchEditorMatch[]; index: number } | undefined;
        if (!request) return current.map(transaction.mapping, transaction.doc);
        return DecorationSet.create(
          transaction.doc,
          request.matches.map((match, index) =>
            Decoration.inline(match.from, match.to, {
              class:
                index === request.index
                  ? 'find-and-replace-result find-and-replace-result-current'
                  : 'find-and-replace-result',
              'data-content-search-index': String(index),
            }),
          ),
        );
      },
    },
    props: { decorations: (state) => contentSearchPositionKey.getState(state) },
  });
}
