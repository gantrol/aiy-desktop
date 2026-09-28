import { Fragment, type Node as ProseMirrorNode, type Schema } from '@tiptap/pm/model';

/** Keep whitespace inside one text block without interpreting clipboard markup. */
export function plainTextInlineContent(schema: Schema, text: string): Fragment {
  const inline: ProseMirrorNode[] = [];
  text.split(/\r\n?|\n/u).forEach((line, index) => {
    if (index) inline.push(schema.nodes.hardBreak.create());
    if (line) inline.push(schema.text(line));
  });
  return Fragment.fromArray(inline);
}
