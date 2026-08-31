import { TableView, updateColumns } from '@tiptap/extension-table';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

function sameColumnWidths(current: unknown, next: unknown) {
  if (current === next) return true;
  if (!Array.isArray(current) || !Array.isArray(next) || current.length !== next.length) return false;
  return current.every((width, index) => width === next[index]);
}

function sameColumnGeometry(current: ProseMirrorNode, next: ProseMirrorNode) {
  if (current.attrs.style !== next.attrs.style) return false;
  const currentRow = current.firstChild;
  const nextRow = next.firstChild;
  if (!currentRow || !nextRow) return currentRow === nextRow;
  if (currentRow.childCount !== nextRow.childCount) return false;

  for (let index = 0; index < currentRow.childCount; index += 1) {
    const currentCell = currentRow.child(index);
    const nextCell = nextRow.child(index);
    if (currentCell.attrs.colspan !== nextCell.attrs.colspan) return false;
    if (!sameColumnWidths(currentCell.attrs.colwidth, nextCell.attrs.colwidth)) return false;
  }

  return true;
}

/** Keep text transactions from rewriting the table DOM around an active IME composition. */
export class VideoDocumentTableView extends TableView {
  override update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;
    const updateColumnGeometry = !sameColumnGeometry(this.node, node);
    this.node = node;
    if (updateColumnGeometry) updateColumns(node, this.colgroup, this.table, this.cellMinWidth);
    return true;
  }
}
