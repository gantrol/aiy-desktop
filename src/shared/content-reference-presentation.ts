import { contentMarkdownTree, contentMarkdownText } from '@/shared/content-markdown';
import type { ReferencePresentation } from '@/shared/content-reference-token';
import type { RootContent } from 'mdast';
import { referenceLinkUrl, type ReferenceLinkSource } from '@/shared/content-reference-link';

export interface ReferenceHeading {
  index: number;
  level: number;
  title: string;
  start: number;
}

export function referenceHeadings(markdown: string): ReferenceHeading[] {
  const headings: ReferenceHeading[] = [];
  const visit = (node: RootContent) => {
    if (node.type === 'heading') {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined)
        headings.push({
          index: headings.length,
          level: node.depth,
          title: contentMarkdownText(markdown.slice(start, end)),
          start,
        });
    }
    if ('children' in node) node.children.forEach((child) => visit(child as RootContent));
  };
  contentMarkdownTree(markdown).children.forEach(visit);
  return headings;
}

/** Projects only explicit occurrence settings; snapshots and the source document remain unchanged. */
export function presentReferenceMarkdown(
  reference: { markdown: string; title: string } & ReferenceLinkSource,
  presentation?: ReferencePresentation,
  parentLevel = 0,
) {
  if (!presentation) return reference.markdown;
  let markdown = reference.markdown;
  const title = reference.title.replace(/[\\`*_[\]<>#]/gu, '\\$&').replace(/[\r\n]/gu, ' ');
  if (presentation.display === 'LINK') {
    const url = referenceLinkUrl(reference);
    if (!url) throw new Error('REFERENCE_NAVIGATION_UNSUPPORTED');
    return `[${title || url}](<${url}>)`;
  }
  if (presentation.showTitle && title) markdown = `# ${title}\n\n${markdown}`;
  const headings = referenceHeadings(markdown);
  if (presentation.headings === 'NEST' && parentLevel > 0 && headings.length) {
    const offset = parentLevel + 1 - Math.min(...headings.map(({ level }) => level));
    if (headings.some(({ level }) => level + offset > 6)) throw new Error('REFERENCE_HEADING_DEPTH_UNSUPPORTED');
    const nodes = contentMarkdownTree(markdown).children;
    const edits: { start: number; end: number; text: string }[] = [];
    const visit = (node: RootContent) => {
      if (
        node.type === 'heading' &&
        node.position?.start.offset !== undefined &&
        node.position.end.offset !== undefined
      ) {
        const start = node.position.start.offset;
        const end = node.position.end.offset;
        const raw = markdown.slice(start, end);
        const body = raw.replace(/^#{1,6}[ \t]+/u, '').replace(/\r?\n[=-]+[ \t]*$/u, '');
        edits.push({ start, end, text: `${'#'.repeat(node.depth + offset)} ${body}` });
      }
      if ('children' in node) node.children.forEach((child) => visit(child as RootContent));
    };
    nodes.forEach(visit);
    for (const edit of edits.sort((a, b) => b.start - a.start))
      markdown = markdown.slice(0, edit.start) + edit.text + markdown.slice(edit.end);
  }
  return presentation.display === 'QUOTE' && markdown
    ? markdown
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
    : markdown;
}
