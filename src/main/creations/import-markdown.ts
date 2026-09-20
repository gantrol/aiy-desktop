import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { z } from 'zod';
import { articleContentSchema } from '@/shared/contracts/article';
import { markdownBlockDocument } from '@/shared/block-document-codecs';
import { createOutlineDocument } from '@/shared/outline-document';
import { contentMarkdownReferences } from '@/shared/content-markdown';

function importError(code: string, message: string) {
  return Object.assign(new Error(message), { code: `CONTENT_IMPORT_${code}` });
}

const markdownNodeSchema = z.object({ type: z.string(), children: z.array(z.unknown()).optional() }).passthrough();

export function assertStandaloneMarkdown(markdown: string) {
  if (!markdown.trim() || markdown.includes('\0')) throw importError('INVALID_MARKDOWN', 'Markdown is empty or binary');
  if (contentMarkdownReferences(markdown).length)
    throw importError('UNSUPPORTED_REFERENCES', 'Imported Markdown cannot contain existing AIY reference identities');
  const stack: unknown[] = [unified().use(remarkParse).parse(markdown)];
  while (stack.length) {
    const node = markdownNodeSchema.parse(stack.pop());
    if (node.type === 'image' || node.type === 'imageReference' || node.type === 'html') {
      throw importError('UNSUPPORTED_ATTACHMENTS', 'Standalone Markdown cannot contain images or raw HTML');
    }
    if (node.children) stack.push(...node.children);
  }
}

export function importMarkdownContent(title: string, markdown: string, kind: 'ARTICLE' | 'OUTLINE') {
  assertStandaloneMarkdown(markdown);
  const document = markdownBlockDocument(markdown);
  return articleContentSchema.parse({
    schemaVersion: 2,
    title,
    document: kind === 'OUTLINE' ? createOutlineDocument(document) : document,
    ...(kind === 'OUTLINE' ? { editorMode: 'OUTLINE' } : {}),
    mediaBindings: [],
    coverAssetId: null,
  });
}
