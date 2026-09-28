import type { Schema } from '@tiptap/pm/model';
import { selectContentBlock } from '@/shared/content-outline';
import { captureBlockDocument, type BlockDocument, type BlockNode } from '@/shared/contracts/block-document';
import type { ContentReference } from '@/shared/contracts/content-library';
import { isOutlineChildList } from '@/shared/outline-structure';
import { sameSharedDocument } from '@/renderer/features/content-editor/sharedDocumentEdit';

type Selector = ContentReference['selector'];
const itemTypes = new Set(['listItem', 'taskItem']);
const listTypes = new Set(['bulletList', 'orderedList', 'taskList']);

export function referenceDocumentSelection(document: BlockDocument, selector: Selector, outline: boolean) {
  if (selector?.kind === 'DOCUMENT_BODY') return document;
  if (selector?.kind !== 'BLOCK') throw new Error('REFERENCE_FOLLOW_SCOPE_UNSUPPORTED');
  return selectContentBlock(document, selector.blockId, selector.section, selector.scope, outline);
}

/** Replace only the selected source range; SELF edits retain the item's structural children. */
export function replaceReferenceDocument(
  document: BlockDocument,
  selector: Selector,
  before: BlockDocument,
  after: BlockDocument,
  outline: boolean,
  schema: Schema,
): BlockDocument {
  const current = referenceDocumentSelection(document, selector, outline);
  if (!sameSharedDocument(schema, current, before)) throw new Error('REFERENCE_TARGET_CHANGED');
  if (selector?.kind === 'DOCUMENT_BODY') return after;
  if (selector?.kind !== 'BLOCK') throw new Error('REFERENCE_FOLLOW_SCOPE_UNSUPPORTED');
  const visit = (parent: BlockNode): BlockNode => {
    const children = parent.content;
    if (!children) return parent;
    const index = children.findIndex((child) => child.attrs?.blockId === selector.blockId);
    if (index < 0) return { ...parent, content: children.map(visit) };
    const original = children[index];
    let replacement = after.root.content ?? [];
    if (itemTypes.has(original.type ?? '') && listTypes.has(parent.type ?? '')) {
      if (replacement.length !== 1 || replacement[0].type !== parent.type)
        throw new Error('REFERENCE_FOLLOW_SCOPE_UNSUPPORTED');
      replacement = replacement[0].content ?? [];
      if (replacement.length !== 1) throw new Error('REFERENCE_EDIT_OUTSIDE_SCOPE');
      if (selector.scope === 'SELF') {
        const isChild = (child: BlockNode) => (outline ? isOutlineChildList(child) : listTypes.has(child.type ?? ''));
        replacement = [
          {
            ...replacement[0],
            content: [...(replacement[0].content ?? []), ...(original.content ?? []).filter(isChild)],
          },
        ];
      }
    }
    const section = selector.scope ? selector.scope === 'SECTION' : selector.section;
    if (!section && replacement.length !== 1) throw new Error('REFERENCE_EDIT_OUTSIDE_SCOPE');
    let end = index + 1;
    if (section) {
      while (
        end < children.length &&
        !(children[end].type === 'heading' && Number(children[end].attrs?.level) <= Number(original.attrs?.level))
      )
        end++;
    }
    // The selected root remains the anchor after splitting or replacing its text.
    if (!replacement.length) throw new Error('REFERENCE_FOLLOW_SCOPE_UNSUPPORTED');
    replacement = replacement.map((node, offset) =>
      offset
        ? node
        : {
            ...node,
            attrs: { ...node.attrs, blockId: selector.blockId },
          },
    );
    return { ...parent, content: [...children.slice(0, index), ...replacement, ...children.slice(end)] };
  };
  const result = captureBlockDocument(visit(document.root));
  if (!sameSharedDocument(schema, referenceDocumentSelection(result, selector, outline), after))
    throw new Error('REFERENCE_EDIT_OUTSIDE_SCOPE');
  return result;
}
