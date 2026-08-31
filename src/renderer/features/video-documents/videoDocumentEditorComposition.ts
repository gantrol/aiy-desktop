import { useEffect, useMemo } from 'react';
import type { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';

export type EditorCompositionPhase = 'idle' | 'composing' | 'ending';

// Each split surface has its own EditorView composition state. ProseMirror also
// keeps a short grace period after compositionend to flush the final DOM
// mutation. Wait for the originating view and a quiet transaction window before
// dispatching identity/decorations work, or Chromium IMEs can retain raw text.
const COMPOSITION_SETTLE_DELAY_MS = 32;

interface EditorTransactionMetadata {
  getMeta(key: string): unknown;
}

function compositionTransaction(transaction: EditorTransactionMetadata) {
  return transaction.getMeta('composition') !== undefined;
}

export function useVideoDocumentEditorComposition({
  editor,
  publish,
}: {
  editor: { current: Editor | null };
  publish: { current(editor: Editor, identityChanged: boolean): void };
}) {
  const controller = useMemo(() => {
    const phase = { current: 'idle' as EditorCompositionPhase };
    const activeView = { current: null as EditorView | null };
    const revision = { current: 0 };
    const deferredRevision = { current: 0 };
    const timer = { current: null as number | null };
    const finish = { current: ((_view: EditorView) => false) as (view: EditorView) => boolean };
    const start = (view: EditorView) => {
      revision.current += 1;
      deferredRevision.current += 1;
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      activeView.current = view;
      phase.current = 'composing';
      return false;
    };
    const end = (view: EditorView) => {
      const expectedRevision = ++revision.current;
      deferredRevision.current += 1;
      activeView.current = view;
      phase.current = 'ending';
      if (timer.current !== null) window.clearTimeout(timer.current);
      const scheduleSettle = () => {
        const expectedDeferredRevision = deferredRevision.current;
        timer.current = window.setTimeout(settle, COMPOSITION_SETTLE_DELAY_MS);

        function settle() {
          if (expectedRevision !== revision.current) return;
          const current = editor.current;
          if (!current || current.isDestroyed) {
            timer.current = null;
            activeView.current = null;
            phase.current = 'idle';
            return;
          }
          const composingView = activeView.current;
          if (
            expectedDeferredRevision !== deferredRevision.current ||
            (composingView && !composingView.isDestroyed && composingView.composing)
          ) {
            scheduleSettle();
            return;
          }
          timer.current = null;
          const settledView = composingView && !composingView.isDestroyed ? composingView : current.view;
          const identityChanged = finish.current(settledView);
          activeView.current = null;
          phase.current = 'idle';
          publish.current(current, identityChanged);
        }
      };
      scheduleSettle();
      return false;
    };
    return {
      phase,
      finish,
      start,
      end,
      cancel() {
        revision.current += 1;
        deferredRevision.current += 1;
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = null;
        activeView.current = null;
        phase.current = 'idle';
      },
      defers(current: Editor, transaction: EditorTransactionMetadata) {
        const composingView = activeView.current;
        const deferred =
          phase.current !== 'idle' ||
          current.view.composing ||
          Boolean(composingView && !composingView.isDestroyed && composingView.composing) ||
          compositionTransaction(transaction);
        if (deferred) deferredRevision.current += 1;
        return deferred;
      },
    };
  }, [editor, publish]);

  useEffect(() => () => controller.cancel(), [controller]);
  return controller;
}
