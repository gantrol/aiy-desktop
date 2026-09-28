import { Extension } from '@tiptap/core';
import { Plugin, type Transaction } from '@tiptap/pm/state';

/** Refuse a stale or out-of-range write before the editor accepts it into its undo history. */
export function referenceEditGuard(validate: (transaction: Transaction) => boolean) {
  return Extension.create({
    name: 'referenceEditGuard',
    addProseMirrorPlugins: () => [
      new Plugin({ filterTransaction: (transaction) => !transaction.docChanged || validate(transaction) }),
    ],
  });
}
