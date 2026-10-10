import type { RootContent, Table } from 'mdast';
import { contentMarkdownTree, contentMarkdownReferences } from '@/shared/content-markdown';
import type { BlockDocument, BlockNode } from '@/shared/contracts/block-document';

function assertRectangularTable(node: BlockNode) {
  const rows = node.content ?? [];
  const columns = rows[0]?.content?.length;
  if (!columns || rows.some((row) => row.content?.length !== columns)) throw new Error('TABLE_STRUCTURE_UNSUPPORTED');
  for (const [index, row] of rows.entries()) {
    if (row.content?.some((cell) => cell.type !== (index === 0 ? 'tableHeader' : 'tableCell')))
      throw new Error('TABLE_STRUCTURE_UNSUPPORTED');
  }
}

/** Reject rich cells that the Markdown projection cannot faithfully represent. */
export function assertPublicationTableDocument(document?: BlockDocument) {
  function visit(node: BlockNode, depth: number, inTable: boolean) {
    const table = node.type === 'table';
    if (table && depth !== 1) throw new Error('TABLE_STRUCTURE_UNSUPPORTED');
    if (table) assertRectangularTable(node);
    if (node.type === 'tableCell' || node.type === 'tableHeader') {
      if (
        (node.attrs?.colspan ?? 1) !== 1 ||
        (node.attrs?.rowspan ?? 1) !== 1 ||
        node.content?.length !== 1 ||
        node.content[0]?.type !== 'paragraph'
      )
        throw new Error('TABLE_STRUCTURE_UNSUPPORTED');
    }
    if (inTable && (node.type === 'inlineMath' || node.marks?.some((mark) => mark.type === 'underline')))
      throw new Error('TABLE_STRUCTURE_UNSUPPORTED');
    for (const child of node.content ?? []) visit(child, depth + 1, inTable || table);
  }
  if (document) visit(document.root, 0, false);
}

/** Only parsed table blocks are converted; code examples and literal pipes stay untouched. */
export function publicationTables(markdown: string) {
  const tables: Table[] = [];
  function visit(node: RootContent, nested: boolean) {
    if (node.type === 'html' && /<\/?(?:table|tr|td|th)\b/iu.test(node.value))
      throw new Error('TABLE_STRUCTURE_UNSUPPORTED');
    if (node.type === 'table') {
      if (nested) throw new Error('TABLE_STRUCTURE_UNSUPPORTED');
      tables.push(node);
    } else if ('children' in node) {
      for (const child of node.children) visit(child as RootContent, true);
    }
  }
  for (const node of contentMarkdownTree(markdown).children) visit(node, false);
  return tables;
}

export function publicationContainsTables(markdown: string) {
  try {
    return publicationTables(markdown).length > 0;
  } catch {
    return true;
  }
}

/** A frozen Markdown reference does not carry its rich-cell structure. Do not silently flatten it. */
export function assertPublicationTableReferences(source: string, expanded: string) {
  if (!contentMarkdownReferences(source).length) return;
  const original = publicationTables(source).map((table) =>
    source.slice(table.position?.start.offset, table.position?.end.offset),
  );
  for (const table of publicationTables(expanded)) {
    const text = expanded.slice(table.position?.start.offset, table.position?.end.offset);
    const index = original.indexOf(text);
    if (index < 0) throw new Error('TABLE_STRUCTURE_UNSUPPORTED');
    original.splice(index, 1);
  }
}
