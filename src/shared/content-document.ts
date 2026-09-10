import type { CreatorPromptNodeInput } from '@/shared/contracts';
import { contentMarkdownText } from '@/shared/content-markdown';

/** Shared presentation rules; titles never become identifiers or saved excerpts. */
export function contentDisplayTitle(title: string | undefined, body: string, fallback = '') {
  const explicit = title?.trim();
  if (explicit) return explicit;
  const excerpt = contentMarkdownText(body.replace(/^:::aiy-block [A-Za-z0-9_-]+\r?\n:::[ \t]*$/gmu, ''), () => '')
    .replace(/^[\s#>*`~-]+/gmu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return Array.from(excerpt).slice(0, 48).join('') || fallback;
}

/** Legacy text is escaped once on entry into the Markdown editor. */
export function plainTextMarkdown(text: string) {
  return text.replace(/([\\`*_{}\[\]()#+.!>|~-])/gu, '\\$1').replace(/\n/gu, '  \n');
}

export function contentAssetPath(assetId: string) {
  return `assets/${assetId.toLowerCase()}`;
}

/** Linked terms and recipes remain structured when editing the note's prose. */
export function replaceContentPromptText(
  nodes: readonly CreatorPromptNodeInput[],
  text: string,
): CreatorPromptNodeInput[] {
  let placed = false;
  const result = nodes.flatMap((node): CreatorPromptNodeInput[] => {
    if (node.kind !== 'TEXT') return [{ ...node }];
    if (placed) return [];
    placed = true;
    return text ? [{ kind: 'TEXT', text }] : [];
  });
  if (!placed && text) result.push({ kind: 'TEXT', text });
  return result;
}
