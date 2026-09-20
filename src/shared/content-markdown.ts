import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { RootContent, PhrasingContent } from 'mdast';
import { contentAssetPath } from '@/shared/content-asset-path';
import { contentFigureReferenceAssetId } from '@/shared/content-figure-reference';

const parser = unified().use(remarkParse).use(remarkGfm);
export function contentMarkdownTree(markdown: string) {
  return parser.parse(markdown);
}

/** Uses the Markdown syntax tree, so code examples and escaped image syntax stay literal. */
export function contentMarkdownText(
  markdown: string,
  imageLabel: (url: string, alt: string) => string = (_url, alt) => alt,
) {
  const tree = contentMarkdownTree(markdown);
  const definitions = new Map(
    tree.children.flatMap((node) =>
      node.type === 'definition' ? [[node.identifier.toLowerCase(), node.url] as const] : [],
    ),
  );
  const render = (node: RootContent | PhrasingContent): string => {
    if (node.type === 'image') return imageLabel(node.url, node.alt ?? '');
    if (node.type === 'imageReference')
      return imageLabel(definitions.get(node.identifier.toLowerCase()) ?? '', node.alt ?? '');
    if (node.type === 'break') return '\n';
    if (node.type === 'definition') return '';
    if ('value' in node) return node.type === 'html' ? '' : node.value;
    if ('children' in node)
      return node.children
        .map((child) => render(child as RootContent))
        .join(['list', 'listItem', 'blockquote', 'table', 'tableRow'].includes(node.type) ? '\n' : '');
    return '';
  };
  return tree.children.map(render).filter(Boolean).join('\n\n').trim();
}

/** Reference fences are document blocks, never code or escaped examples. */
export function contentMarkdownReferences(markdown: string) {
  const references: { id: string; start: number; end: number; indent: string }[] = [];
  const walk = (node: RootContent | PhrasingContent) => {
    if (node.type === 'paragraph') {
      const start = node.position?.start.offset,
        end = node.position?.end.offset;
      if (start === undefined || end === undefined) return;
      const match = /^:::aiy-block ([A-Za-z0-9_-]{1,200})\r?\n([ >\t]*):::[ \t]*$/u.exec(markdown.slice(start, end));
      if (match) references.push({ id: match[1]!, start, end, indent: match[2]! });
      return;
    }
    if ('children' in node) node.children.forEach((child) => walk(child as RootContent));
  };
  contentMarkdownTree(markdown).children.forEach(walk);
  return references;
}

export function contentMarkdownMediaPaths(markdown: string) {
  const paths = new Set<string>();
  const walk = (node: RootContent | PhrasingContent) => {
    if (node.type === 'image' || node.type === 'link' || node.type === 'definition') {
      paths.add(node.url);
      // A captured paragraph may mention a figure whose image block lies outside
      // the selection. Retain that explicitly cited asset with the excerpt.
      if (node.type === 'link' || node.type === 'definition') {
        const figureId = contentFigureReferenceAssetId(node.url);
        if (figureId) paths.add(contentAssetPath(figureId));
      }
    }
    if ('children' in node) node.children.forEach((child) => walk(child as RootContent));
  };
  contentMarkdownTree(markdown).children.forEach(walk);
  return paths;
}

export function contentMarkdownBlocks(markdown: string) {
  return contentMarkdownTree(markdown).children.flatMap((node) => {
    const start = node.position?.start.offset,
      end = node.position?.end.offset;
    return start === undefined || end === undefined || node.type === 'definition'
      ? []
      : [{ start, end, preview: contentMarkdownText(markdown.slice(start, end)).slice(0, 280) }];
  });
}

/** Carry referenced link/image definitions with an excerpt, even when declared elsewhere. */
export function contentMarkdownRange(markdown: string, start: number, end: number) {
  const needed = new Set<string>(),
    definitions = new Map<string, string>();
  const walk = (node: RootContent | PhrasingContent) => {
    const from = node.position?.start.offset,
      to = node.position?.end.offset;
    if (from !== undefined && to !== undefined) {
      if (node.type === 'definition' && (from < start || to > end))
        definitions.set(node.identifier.toLowerCase(), markdown.slice(from, to));
      if ((node.type === 'imageReference' || node.type === 'linkReference') && from >= start && to <= end)
        needed.add(node.identifier.toLowerCase());
    }
    if ('children' in node) node.children.forEach((child) => walk(child as RootContent));
  };
  contentMarkdownTree(markdown).children.forEach(walk);
  return [markdown.slice(start, end), ...[...needed].flatMap((id) => definitions.get(id) ?? [])].join('\n\n');
}

export function replaceMarkdownMedia(markdown: string, paths: ReadonlyMap<string, string>) {
  const replacements: { start: number; end: number; text: string }[] = [];
  const walk = (node: RootContent | PhrasingContent) => {
    if ((node.type === 'image' || node.type === 'link' || node.type === 'definition') && paths.has(node.url)) {
      const start = node.position?.start.offset,
        end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) {
        const original = markdown.slice(start, end);
        const destination = markdownDestination(original, node.type === 'definition');
        if (destination)
          replacements.push({
            start: start + destination.start,
            end: start + destination.end,
            text: paths
              .get(node.url)!
              .replace(
                /[\s()<>"\\]/gu,
                (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'),
              ),
          });
      }
    }
    if ('children' in node) node.children.forEach((child) => walk(child as RootContent));
  };
  contentMarkdownTree(markdown).children.forEach(walk);
  return replacements
    .sort((a, b) => b.start - a.start)
    .reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), markdown);
}

/** Find the destination token, excluding a matching URL in the label or title. */
function markdownDestination(source: string, definition: boolean) {
  let offset = source.indexOf('['),
    depth = 0;
  if (offset < 0) return null;
  for (; offset < source.length; offset++) {
    if (source[offset] === '\\') {
      offset++;
      continue;
    }
    if (source[offset] === '[') depth++;
    if (source[offset] === ']' && --depth === 0) break;
  }
  if (source[offset + 1] !== (definition ? ':' : '(')) return null;
  offset += 2;
  while (/\s/u.test(source[offset] ?? '') && offset < source.length) offset++;
  const angle = source[offset] === '<';
  if (angle) offset++;
  const start = offset;
  depth = 0;
  for (; offset < source.length; offset++) {
    const character = source[offset];
    if (character === '\\') {
      offset++;
      continue;
    }
    if (angle) {
      if (character === '>') break;
      continue;
    }
    if (character === '(') depth++;
    else if (character === ')') {
      if (depth === 0) break;
      depth--;
    } else if (/\s/u.test(character!)) break;
  }
  return { start, end: offset };
}
