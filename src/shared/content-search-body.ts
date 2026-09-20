import { contentMarkdownMediaPaths, contentMarkdownText } from '@/shared/content-markdown';

/** Match readable prose (not Markdown escapes), while retaining explicit link/file destinations. */
export function contentSearchBody(markdown: string): string {
  const text = contentMarkdownText(markdown);
  const destinations = [...contentMarkdownMediaPaths(markdown)].filter((value) => !text.includes(value));
  return [text, ...destinations].filter(Boolean).join('\n\n');
}
