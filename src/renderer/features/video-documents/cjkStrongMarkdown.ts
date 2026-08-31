import { Extension, type JSONContent } from '@tiptap/core';
import { matchAdjacentCjkStrongMarkdown } from '@/shared/cjk-strong-markdown';

function applyBoldMark(content: JSONContent[]) {
  return content.map((node) =>
    node.type === 'text' ? { ...node, marks: [...(node.marks ?? []), { type: 'bold' }] } : node,
  );
}

/**
 * CommonMark does not close `**` when punctuation inside the mark is followed
 * immediately by a letter outside it. Chinese prose normally omits that space,
 * so recognize the otherwise-unambiguous CJK form and keep misplaced closing
 * whitespace as ordinary text outside the bold mark.
 */
export const CjkStrongMarkdown = Extension.create({
  name: 'cjkStrongMarkdown',

  markdownTokenName: 'cjkStrong',

  parseMarkdown(token, helpers) {
    const content = helpers.parseInline(token.tokens ?? []);
    const trailingWhitespace = typeof token.trailingWhitespace === 'string' ? token.trailingWhitespace : '';
    if (!trailingWhitespace) return helpers.applyMark('bold', content);

    return [...applyBoldMark(content), helpers.createTextNode(trailingWhitespace)];
  },

  markdownTokenizer: {
    name: 'cjkStrong',
    level: 'inline',
    start: (source) => source.indexOf('**'),
    tokenize(source, _tokens, lexer) {
      const match = matchAdjacentCjkStrongMarkdown(source);
      if (!match) return undefined;

      const { raw, text, trailingWhitespace } = match;

      return {
        type: 'cjkStrong',
        raw,
        text,
        trailingWhitespace,
        tokens: lexer.inlineTokens(text),
      };
    },
  },
});
