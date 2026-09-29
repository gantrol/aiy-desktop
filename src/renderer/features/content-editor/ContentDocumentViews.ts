import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Step } from '@tiptap/pm/transform';
import { collab, getVersion, receiveTransaction, sendableSteps } from 'prosemirror-collab';
import { sharedDocumentTransaction } from '@/renderer/features/content-editor/sharedDocumentEdit';

interface DocumentView {
  editor: Editor;
  canSynchronize(): boolean;
  disconnect(): void;
}

/** Local views share document steps, while keeping their own selection and undo history. */
export class ContentDocumentViews {
  readonly #views = new Set<DocumentView>();
  #document: Node | null = null;
  #version = 0;
  #firstVersion = 0;
  #steps: Step[] = [];
  #clients: (string | number)[] = [];
  #scheduled = false;
  #flushing = false;
  #disposed = false;

  connect(editor: Editor, canSynchronize: () => boolean, subscribe: (listener: () => void) => () => void) {
    if (this.#disposed || editor.isDestroyed) return () => undefined;
    this.flush();
    if (this.#document) {
      const document = editor.schema.nodeFromJSON(this.#document.toJSON());
      if (!editor.state.doc.eq(document)) editor.view.dispatch(sharedDocumentTransaction(editor.state.tr, document));
    } else this.#document = editor.state.doc;
    const plugin = collab({ version: this.#version, clientID: crypto.randomUUID() });
    editor.registerPlugin(plugin);
    const changed = () => this.#schedule();
    const unsubscribe = subscribe(changed);
    editor.on('transaction', changed);
    const view: DocumentView = {
      editor,
      canSynchronize,
      disconnect: () => {
        editor.off('transaction', changed);
        unsubscribe();
        if (!editor.isDestroyed && plugin.spec.key) editor.unregisterPlugin(plugin.spec.key);
      },
    };
    this.#views.add(view);
    return () => {
      if (!this.#views.has(view)) return;
      this.flush();
      this.#views.delete(view);
      view.disconnect();
      this.#prune();
      if (!this.#views.size) this.reset();
    };
  }

  #schedule() {
    if (this.#scheduled || this.#disposed) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      this.flush();
    });
  }

  #receive(view: DocumentView) {
    const { editor } = view;
    const offset = getVersion(editor.state) - this.#firstVersion;
    if (offset === this.#steps.length) return;
    const steps = this.#steps.slice(offset).map((step) => Step.fromJSON(editor.schema, step.toJSON()));
    editor.view.dispatch(
      receiveTransaction(editor.state, steps, this.#clients.slice(offset), { mapSelectionBackward: true }),
    );
  }

  flush() {
    if (this.#disposed || this.#flushing) return;
    this.#flushing = true;
    try {
      let changed: boolean;
      do {
        changed = false;
        for (const view of this.#views) {
          if (view.editor.isDestroyed || !view.canSynchronize()) continue;
          this.#receive(view);
          const pending = sendableSteps(view.editor.state);
          if (!pending) continue;
          let document = this.#document!;
          const steps = pending.steps.map((step) => Step.fromJSON(document.type.schema, step.toJSON()));
          for (const step of steps) {
            const result = step.apply(document);
            if (!result.doc) throw new Error(result.failed ?? 'CONTENT_DOCUMENT_SYNC_FAILED');
            document = result.doc;
          }
          this.#document = document;
          this.#version += steps.length;
          this.#steps.push(...steps);
          this.#clients.push(...steps.map(() => pending.clientID));
          this.#receive(view);
          changed = true;
        }
      } while (changed);
      this.#prune();
    } finally {
      this.#flushing = false;
    }
  }

  #prune() {
    const versions = [...this.#views]
      .filter((view) => !view.editor.isDestroyed)
      .map(({ editor }) => getVersion(editor.state));
    const first = Math.min(this.#version, ...versions);
    const count = first - this.#firstVersion;
    this.#steps.splice(0, count);
    this.#clients.splice(0, count);
    this.#firstVersion = first;
  }

  reset() {
    for (const view of this.#views) view.disconnect();
    this.#views.clear();
    this.#document = null;
    this.#version = 0;
    this.#firstVersion = 0;
    this.#steps.length = 0;
    this.#clients.length = 0;
  }

  dispose() {
    this.#disposed = true;
    this.reset();
  }
}
