import { blockIdentityNodeTypes } from '@/shared/contracts/block-document';
import { Extension } from '@tiptap/core';
import { Fragment, Slice, type Node } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { Mapping } from '@tiptap/pm/transform';
import type { EditorView } from '@tiptap/pm/view';

const types = new Set<string>(blockIdentityNodeTypes);

function blockIdentities(document: Node) {
  const identities = new Set<string>();
  document.descendants((node) => {
    const id = node.attrs.blockId;
    if (types.has(node.type.name) && typeof id === 'string' && id) identities.add(id);
  });
  return identities;
}

function transformPastedNode(node: Node, existingIds: ReadonlySet<string>): Node {
  let attrs = node.attrs;
  let changed = false;
  if (types.has(node.type.name)) {
    const id = node.attrs.blockId;
    if (typeof id !== 'string' || !id || !existingIds.has(id)) {
      attrs = { ...node.attrs, blockId: crypto.randomUUID() };
      changed = true;
    }
  }
  const content = node.isLeaf ? node.content : transformPastedFragment(node.content, existingIds);
  if (content !== node.content) changed = true;
  if (!changed) return node;
  return attrs === node.attrs ? node.copy(content) : node.type.create(attrs, content, node.marks);
}

function transformPastedFragment(fragment: Fragment, existingIds: ReadonlySet<string>) {
  const children: Node[] = [];
  let changed = false;
  fragment.forEach((node) => {
    const transformed = transformPastedNode(node, existingIds);
    children.push(transformed);
    changed ||= transformed !== node;
  });
  return changed ? Fragment.fromArray(children) : fragment;
}

function transformPastedIdentities(slice: Slice, view: EditorView) {
  const content = transformPastedFragment(slice.content, blockIdentities(view.state.doc));
  return content === slice.content ? slice : new Slice(content, slice.openStart, slice.openEnd);
}

/** Identity follows the document transaction, including edits while an async insertion is pending. */
export const BlockIdentity = Extension.create({
  name: 'blockIdentity',
  addGlobalAttributes: () => [
    {
      types: [...blockIdentityNodeTypes],
      attributes: { blockId: { default: null, rendered: false } },
    },
    {
      // Outline task state must also survive a document opened in the article adapter.
      types: ['listItem'],
      attributes: {
        taskState: {
          default: null,
          parseHTML: (element: HTMLElement) => {
            const value = element.getAttribute('data-task-state');
            return value === 'TODO' || value === 'DONE' ? value : null;
          },
          renderHTML: (attributes: Record<string, unknown>) =>
            attributes.taskState === 'TODO' || attributes.taskState === 'DONE'
              ? { 'data-task-state': attributes.taskState }
              : {},
        },
      },
    },
  ],
  addProseMirrorPlugins() {
    const composing = new Set<EditorView>();
    const timers = new Map<EditorView, ReturnType<typeof setTimeout>>();
    return [
      new Plugin({
        props: {
          transformPasted: (slice, view) => transformPastedIdentities(slice, view),
          handleDOMEvents: {
            compositionstart(view) {
              composing.add(view);
              clearTimeout(timers.get(view));
              return false;
            },
            compositionend(view) {
              const settle = () => {
                if (view.isDestroyed) return;
                if (view.composing) {
                  timers.set(view, setTimeout(settle, 32));
                  return;
                }
                composing.delete(view);
                timers.delete(view);
                view.dispatch(view.state.tr.setMeta('blockIdentityRepair', true));
              };
              timers.set(view, setTimeout(settle, 32));
              return false;
            },
          },
        },
        view: (view) => ({
          destroy() {
            clearTimeout(timers.get(view));
            timers.delete(view);
            composing.delete(view);
          },
        }),
        appendTransaction(transactions, oldState, newState) {
          if (transactions.some((transaction) => transaction.getMeta('blockIdentityRepair'))) {
            for (const view of composing)
              if (!view.composing) {
                composing.delete(view);
                clearTimeout(timers.get(view));
                timers.delete(view);
              }
          }
          if (composing.size || transactions.some((transaction) => transaction.getMeta('composition') !== undefined))
            return null;
          if (!transactions.some((transaction) => transaction.docChanged || transaction.getMeta('blockIdentityRepair')))
            return null;
          const mapping = new Mapping();
          transactions.forEach((transaction) => mapping.appendMapping(transaction.mapping));
          const retained = new Map<string, number>();
          oldState.doc.descendants((node, position) => {
            const id = node.attrs.blockId;
            if (!types.has(node.type.name) || typeof id !== 'string' || !id) return;
            const mapped = mapping.mapResult(position, 1);
            if (!mapped.deleted && newState.doc.nodeAt(mapped.pos)?.attrs.blockId === id) retained.set(id, mapped.pos);
          });
          const seen = new Set<string>();
          const transaction = newState.tr;
          newState.doc.descendants((node, position) => {
            if (!types.has(node.type.name)) return;
            const id = node.attrs.blockId;
            if (typeof id === 'string' && id && !seen.has(id) && (!retained.has(id) || retained.get(id) === position)) {
              seen.add(id);
              return;
            }
            const next = crypto.randomUUID();
            seen.add(next);
            transaction.setNodeMarkup(position, undefined, { ...node.attrs, blockId: next });
          });
          return transaction.docChanged ? transaction : null;
        },
      }),
    ];
  },
});
