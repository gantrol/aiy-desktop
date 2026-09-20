import type { JSONContent } from '@tiptap/core';
import { z } from 'zod';
import { linkCardAttributesSchema } from '@/shared/contracts/link-card';

export type BlockNode = JSONContent;
export const blockIdentityNodeTypes = [
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'taskList',
  'listItem',
  'taskItem',
  'blockquote',
  'codeBlock',
  'image',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
  'horizontalRule',
  'contentReference',
  'linkCard',
] as const;
const supportedNodes = new Set<string>([
  'doc',
  'text',
  'hardBreak',
  'bulletList',
  'orderedList',
  'taskList',
  'creatorTerm',
  'creatorRecipe',
  'details',
  'detailsSummary',
  'detailsContent',
  'reveal',
  'revealInitial',
  'revealAnswer',
  ...blockIdentityNodeTypes,
]);
const supportedMarks = new Set(['bold', 'italic', 'strike', 'code', 'link', 'underline']);
const inlineTypes = new Set(['text', 'hardBreak', 'creatorTerm', 'creatorRecipe']);
const blockTypes = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'taskList',
  'blockquote',
  'codeBlock',
  'image',
  'table',
  'horizontalRule',
  'contentReference',
  'linkCard',
  'details',
  'reveal',
]);

function validDetailsChildren(children: readonly { type?: string }[]) {
  return children.length === 2 && children[0].type === 'detailsSummary' && children[1].type === 'detailsContent';
}

function validRevealChildren(children: readonly { type?: string }[]) {
  return children.length === 2 && children[0].type === 'revealInitial' && children[1].type === 'revealAnswer';
}

function validInteractiveChildren(type: string, children: readonly { type?: string }[]) {
  switch (type) {
    case 'details':
      return validDetailsChildren(children);
    case 'detailsSummary':
      return children.every((child) => child.type === 'text');
    case 'detailsContent':
    case 'revealInitial':
    case 'revealAnswer':
      return children.length > 0 && children.every((child) => blockTypes.has(child.type!));
    case 'reveal':
      return validRevealChildren(children);
    default:
      return false;
  }
}

/** Reject invalid nesting before an editor could silently discard or rearrange it. */
function validChildren(type: string, content: unknown) {
  if (content !== undefined && !Array.isArray(content)) return false;
  const children = (content ?? []) as { type?: string }[];
  if (children.some((child) => !child || typeof child.type !== 'string')) return false;
  if (['details', 'detailsSummary', 'detailsContent', 'reveal', 'revealInitial', 'revealAnswer'].includes(type))
    return validInteractiveChildren(type, children);
  const every = (allowed: ReadonlySet<string>) => children.every((child) => allowed.has(child.type!));
  switch (type) {
    case 'doc':
    case 'blockquote':
    case 'tableCell':
    case 'tableHeader':
      return children.length > 0 && every(blockTypes);
    case 'paragraph':
    case 'heading':
      return every(inlineTypes);
    case 'codeBlock':
      return children.every((child) => child.type === 'text');
    case 'bulletList':
    case 'orderedList':
      return children.length > 0 && children.every((child) => child.type === 'listItem');
    case 'taskList':
      return children.length > 0 && children.every((child) => child.type === 'taskItem');
    case 'listItem':
    case 'taskItem':
      return children[0]?.type === 'paragraph' && every(blockTypes);
    case 'table':
      return children.length > 0 && children.every((child) => child.type === 'tableRow');
    case 'tableRow':
      return (
        children.length > 0 && children.every((child) => child.type === 'tableCell' || child.type === 'tableHeader')
      );
    default:
      return children.length === 0;
  }
}

function validJson(value: unknown, depth = 0): boolean {
  if (depth > 12) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.length <= 1_000_000;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 1000 && value.every((item) => validJson(item, depth + 1));
  return (
    typeof value === 'object' &&
    Object.entries(value).length <= 100 &&
    Object.entries(value).every(
      ([key, item]) => !['__proto__', 'constructor', 'prototype'].includes(key) && validJson(item, depth + 1),
    )
  );
}

function validMarks(marks: unknown) {
  if (
    marks !== undefined &&
    (!Array.isArray(marks) ||
      marks.length > 20 ||
      marks.some((mark: unknown) => {
        if (!mark || typeof mark !== 'object' || Array.isArray(mark)) return true;
        const data = mark as Record<string, unknown>;
        return typeof data.type !== 'string' || !supportedMarks.has(data.type) || !validJson(data);
      }))
  )
    return false;
  return true;
}

function validRoot(value: unknown): value is BlockNode {
  const pending = [{ node: value, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (++count > 100_000 || depth > 64 || !node || typeof node !== 'object' || Array.isArray(node)) return false;
    const item = node as Record<string, unknown>;
    if (typeof item.type !== 'string' || !supportedNodes.has(item.type)) return false;
    if (!validChildren(item.type, item.content)) return false;
    if (depth === 0 ? item.type !== 'doc' : item.type === 'doc') return false;
    if (Object.keys(item).some((key) => !['type', 'attrs', 'content', 'text', 'marks'].includes(key))) return false;
    if (
      item.text !== undefined &&
      (item.type !== 'text' || typeof item.text !== 'string' || item.text.length > 1_000_000)
    )
      return false;
    if (item.type === 'text' && (!item.text || item.content !== undefined)) return false;
    if (!validAttributes(item.type, item.attrs)) return false;
    if (!validMarks(item.marks)) return false;
    if (item.content !== undefined) {
      if (!Array.isArray(item.content)) return false;
      for (const child of item.content) pending.push({ node: child, depth: depth + 1 });
    }
  }
  return true;
}

function validAttributes(type: string, attrs: unknown) {
  if (type === 'linkCard' && !linkCardAttributesSchema.safeParse(attrs).success) return false;
  if (
    type === 'reveal' &&
    (!attrs ||
      typeof attrs !== 'object' ||
      !['REVEAL', 'IMAGE_SWAP'].includes(String((attrs as Record<string, unknown>).kind)))
  )
    return false;
  return (
    attrs === undefined || Boolean(attrs && typeof attrs === 'object' && !Array.isArray(attrs) && validJson(attrs))
  );
}

export const blockDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    format: z.literal('PROSEMIRROR_JSON'),
    root: z.custom<BlockNode>(validRoot, 'BLOCK_DOCUMENT_UNSUPPORTED_CONTENT'),
  })
  .strict();
export type BlockDocument = z.infer<typeof blockDocumentSchema>;

/** Only the initial empty paragraph is blank. Lists, headings and intentional blank lines are document content. */
export function blockDocumentIsEmpty(document: Pick<BlockDocument, 'root'>): boolean {
  const blocks = document.root.content ?? [];
  return !blocks.length || (blocks.length === 1 && blocks[0].type === 'paragraph' && !blocks[0].content?.length);
}

/** Stable attributes only; display URLs and editor-local keys never change a revision. */
export function captureBlockDocument(
  root: BlockNode,
  media: readonly { path: string; assetId: string }[] = [],
  copy = false,
): BlockDocument {
  if (!validRoot(root)) throw new Error('BLOCK_DOCUMENT_UNSUPPORTED_CONTENT');
  const identities = new Set<string>();
  const visit = (node: BlockNode): BlockNode => {
    const attrs = { ...node.attrs };
    if ((blockIdentityNodeTypes as readonly string[]).includes(node.type ?? '')) {
      const previous = attrs.blockId || attrs.articleElementId;
      attrs.blockId =
        !copy && typeof previous === 'string' && previous && !identities.has(previous)
          ? previous
          : globalThis.crypto.randomUUID();
      identities.add(attrs.blockId);
    }
    delete attrs.articleElementId;
    delete attrs.editorKey;
    if (!attrs.linkCardDisabled) delete attrs.linkCardDisabled;
    if (node.type === 'creatorTerm' || node.type === 'creatorRecipe') delete attrs.label;
    if (node.type === 'image') {
      const source = String(attrs.sourcePath || attrs.src || '');
      const bound = media.find((binding) => binding.path === source);
      const internal = /^aiy-media:\/\/asset\/([^/?#]+)/u.exec(source)?.[1];
      const assetId = attrs.assetId || bound?.assetId || internal;
      if (assetId) {
        attrs.assetId = String(assetId);
        if (source.startsWith('assets/')) attrs.mediaPath = source;
        delete attrs.src;
        delete attrs.sourcePath;
      }
    }
    return {
      type: node.type,
      ...(Object.keys(attrs).length
        ? {
            attrs: Object.fromEntries(
              Object.entries(attrs)
                .filter(([, value]) => value !== undefined)
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
            ),
          }
        : {}),
      ...(node.text !== undefined ? { text: node.text } : {}),
      ...(node.marks?.length ? { marks: node.marks.map((mark) => ({ ...mark })) } : {}),
      ...(node.content ? { content: node.content.map(visit) } : {}),
    };
  };
  return blockDocumentSchema.parse({ schemaVersion: 1, format: 'PROSEMIRROR_JSON', root: visit(root) });
}

export function blockDocumentAssetIds(document: BlockDocument): string[] {
  const ids = new Set<string>();
  const visit = (node: BlockNode) => {
    if (node.type === 'image' && typeof node.attrs?.assetId === 'string') ids.add(node.attrs.assetId);
    node.content?.forEach(visit);
  };
  visit(document.root);
  return [...ids];
}

export function blockDocumentImportIds(document: BlockDocument): string[] {
  const ids = new Set<string>();
  const visit = (node: BlockNode) => {
    if (node.type === 'image' && typeof node.attrs?.importId === 'string') ids.add(node.attrs.importId);
    node.content?.forEach(visit);
  };
  visit(document.root);
  return [...ids];
}
export function assertBlockDocumentReady(document?: BlockDocument) {
  if (document && blockDocumentImportIds(document).length) throw new Error('BLOCK_IMAGE_IMPORT_PENDING');
}
