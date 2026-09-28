import { InputRule, mergeAttributes } from '@tiptap/core';
import { InlineMath, BlockMath } from '@tiptap/extension-mathematics';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { ContentMath } from '@/renderer/features/content-editor/ContentMath';
import { ContentMathAction } from '@/renderer/features/content-editor/ContentMathAction';
import { contentMarkdownTree } from '@/shared/content-markdown';
import { mathMarkdown, mathSourceLimit } from '@/shared/content-math';

function MathNodeView({ node, editor, getPos, selected }: NodeViewProps) {
  const display = node.type.name === 'blockMath';
  const formula = <ContentMath source={String(node.attrs.latex)} display={display} />;
  return (
    <NodeViewWrapper
      as={display ? 'div' : 'span'}
      contentEditable={false}
      data-type={display ? 'block-math' : 'inline-math'}
      data-latex={node.attrs.latex}
      className={selected ? 'rounded-sm outline outline-1 outline-ring' : undefined}
    >
      {editor.isEditable ? (
        <ContentMathAction editor={editor} getPos={getPos} display={display}>
          {formula}
        </ContentMathAction>
      ) : (
        formula
      )}
    </NodeViewWrapper>
  );
}

/** Use the same math grammar as previews and the persisted-document importer. */
function tokenizer(block: boolean) {
  return {
    name: block ? 'blockMath' : 'inlineMath',
    level: block ? ('block' as const) : ('inline' as const),
    start: (src: string) => {
      if (!block) return src.indexOf('$');
      const match = /(?:^|\n)\${2,}[\t ]*\n/u.exec(src);
      return match ? match.index + (match[0].startsWith('\n') ? 1 : 0) : -1;
    },
    tokenize(src: string) {
      if (!src.startsWith('$')) return undefined;
      // Bound work to one formula rather than reparse the remaining document for every node.
      const opening = /^\$+/u.exec(src)![0];
      if (opening.length > mathSourceLimit) return undefined;
      const rest = src.slice(opening.length, mathSourceLimit + opening.length + 64);
      const closing = block
        ? new RegExp(`\\n${opening.replaceAll('$', '\\$')}[\\t ]*(?:\\n|$)`, 'u').exec(rest)
        : Array.from(rest.matchAll(/\$+/gu)).find((match) => match[0].length === opening.length);
      if (!closing) return undefined;
      const length = opening.length + closing.index! + closing[0].length;
      const candidate = src.slice(0, length);
      const root = contentMarkdownTree(candidate).children[0];
      const math = block ? root : root?.type === 'paragraph' ? root.children[0] : null;
      if (math?.type !== (block ? 'math' : 'inlineMath') || !('value' in math) || !math.value.trim()) return undefined;
      if (math.value.length > mathSourceLimit) return undefined;
      return { type: block ? 'blockMath' : 'inlineMath', raw: candidate, latex: math.value };
    },
  };
}

function inputRule(block: boolean, type: import('@tiptap/pm/model').NodeType) {
  return new InputRule({
    find: block ? /^\$\$([^$\n]+)\$\$$/u : /(?<![\\$])\$([^$\n]+)\$$/u,
    handler: ({ state, range, match }) => {
      const latex = match[1].trim();
      if (!latex || latex.length > mathSourceLimit) return null;
      const $from = state.doc.resolve(range.from);
      const wholeBlock =
        block &&
        $from.parent.isTextblock &&
        range.from === $from.start() &&
        $from.node(-1).canReplaceWith($from.index(-1), $from.indexAfter(-1), type);
      state.tr.replaceWith(
        wholeBlock ? $from.before() : range.from,
        wholeBlock ? $from.after() : range.to,
        type.create({ latex }),
      );
    },
  });
}

export const ContentInlineMath = InlineMath.extend({
  renderHTML: ({ node, HTMLAttributes }) => [
    'span',
    mergeAttributes(HTMLAttributes, { 'data-type': 'inline-math' }),
    String(node.attrs.latex),
  ],
  renderMarkdown: mathMarkdown,
  renderText: ({ node }) => mathMarkdown(node.toJSON()),
  markdownTokenizer: tokenizer(false),
  addInputRules() {
    return [inputRule(false, this.type)];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView, { as: 'span' });
  },
});
export const ContentBlockMath = BlockMath.extend({
  renderHTML: ({ node, HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, { 'data-type': 'block-math' }),
    String(node.attrs.latex),
  ],
  renderMarkdown: mathMarkdown,
  renderText: ({ node }) => mathMarkdown(node.toJSON()),
  markdownTokenizer: tokenizer(true),
  addInputRules() {
    return [inputRule(true, this.type)];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView);
  },
});
