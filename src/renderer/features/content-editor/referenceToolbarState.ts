import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';

const key = new PluginKey<readonly string[]>('referenceToolbar');
export const referenceToolbarState = key;
export function revealInsertedReferences(transaction: Transaction, ids: string[]) {
  return transaction.setMeta(key, ids);
}
export function referenceToolbarPlugin() {
  return new Plugin<readonly string[]>({
    key,
    state: {
      init: () => [],
      apply: (transaction, current) => {
        const inserted = transaction.getMeta(key) as string[] | undefined;
        if (inserted) return inserted;
        if (transaction.getMeta('uiEvent') === 'paste') {
          const ids = new Set<string>();
          transaction.mapping.maps.forEach((map, index) =>
            map.forEach((_from, _to, start, end) => {
              const remaining = transaction.mapping.slice(index + 1);
              transaction.doc.nodesBetween(remaining.map(start, -1), remaining.map(end, 1), (node) => {
                if (node.type.name === 'contentReference') ids.add(String(node.attrs.blockId));
              });
            }),
          );
          return [...ids];
        }
        // Identity repair and other appended normalization belong to the original insertion.
        if (transaction.getMeta('appendedTransaction')) return current;
        return transaction.docChanged || transaction.selectionSet ? [] : current;
      },
    },
    view: (view) => {
      const dismiss = (event: PointerEvent) => {
        if (!key.getState(view.state)?.length || !(event.target instanceof Element)) return;
        const reference = event.target.closest('[data-content-reference]');
        if (reference && view.dom.contains(reference)) return;
        view.dispatch(view.state.tr.setMeta(key, []));
      };
      view.dom.ownerDocument.addEventListener('pointerdown', dismiss, true);
      return { destroy: () => view.dom.ownerDocument.removeEventListener('pointerdown', dismiss, true) };
    },
  });
}
