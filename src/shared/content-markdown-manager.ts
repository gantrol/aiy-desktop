import { MarkdownManager } from '@tiptap/markdown';
import type { JSONContent } from '@tiptap/core';

/** Tiptap escapes core Markdown punctuation but not the dollar delimiter added by math. */
export class ContentMarkdownManager extends MarkdownManager {
  override serialize(document: JSONContent): string {
    const source = JSON.stringify(document);
    if (!source.includes('$')) return super.serialize(document);
    // The upstream text escaper is private and runs inside mark serialization.
    // Use a collision-free, export-only placeholder to preserve its mark boundaries.
    let placeholder = '\uE000';
    while (source.includes(placeholder)) placeholder += '\uE000';
    const project = (node: JSONContent, code = false): JSONContent => {
      const literal = code || node.type === 'codeBlock' || Boolean(node.marks?.some((mark) => mark.type === 'code'));
      return {
        ...node,
        ...(node.text && !literal ? { text: node.text.replaceAll('$', placeholder) } : {}),
        ...(node.content ? { content: node.content.map((child) => project(child, literal)) } : {}),
      };
    };
    return super.serialize(project(document)).replaceAll(placeholder, '\\$');
  }
}
