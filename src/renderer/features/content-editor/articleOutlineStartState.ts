import type { ArticleEditorSessionRuntime } from '@/renderer/components/creator/article-editor/ArticleEditorSessionRuntime';
import type { ArticleOutlineStartInput } from '@/shared/contracts/article-outline-start';

function createStartState() {
  let busy = false;
  const listeners = new Set<() => void>();
  return {
    pending: null as ArticleOutlineStartInput | null,
    getSnapshot: () => busy,
    setBusy(value: boolean) {
      busy = value;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
const states = new WeakMap<ArticleEditorSessionRuntime, ReturnType<typeof createStartState>>();

export function articleOutlineStartState(session: ArticleEditorSessionRuntime) {
  let state = states.get(session);
  if (!state) {
    state = createStartState();
    states.set(session, state);
  }
  return state;
}
