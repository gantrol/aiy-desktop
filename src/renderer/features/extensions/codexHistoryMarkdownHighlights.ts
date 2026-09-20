import type { ElementContent, Root } from 'hast';
import { codexHistoryHighlights } from '@/shared/codex-history-search-query';

/** Highlight parsed text nodes, including code, without changing Markdown syntax or link targets. */
export function codexHistoryMarkdownHighlights({ query }: { query: string }) {
  return (tree: Root) => {
    function visit(parent: Root | Extract<ElementContent, { type: 'element' }>) {
      parent.children = parent.children.flatMap((node): ElementContent[] => {
        if (node.type === 'doctype') return [];
        if (node.type === 'element') {
          if (node.tagName !== 'mark') visit(node);
          return [node];
        }
        if (node.type !== 'text' && node.type !== 'raw') return [node];
        const matches = codexHistoryHighlights(node.value, query);
        if (!matches.length) return [node];
        const children: ElementContent[] = [];
        let offset = 0;
        for (const match of matches) {
          if (offset < match.start) children.push({ type: 'text', value: node.value.slice(offset, match.start) });
          children.push({
            type: 'element',
            tagName: 'mark',
            properties: {},
            children: [{ type: 'text', value: node.value.slice(match.start, match.end) }],
          });
          offset = match.end;
        }
        if (offset < node.value.length) children.push({ type: 'text', value: node.value.slice(offset) });
        return children;
      });
    }
    visit(tree);
  };
}
