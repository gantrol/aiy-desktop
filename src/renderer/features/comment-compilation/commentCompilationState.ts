import type { ArticleEditorSessionRuntime } from '@/renderer/components/creator/article-editor/ArticleEditorSessionRuntime';
import type { CommentCompilationInput } from '@/shared/contracts/comment-compilation';
import type { CommentCompilationResult } from '@/shared/contracts/comment-compilation-result';

export type CommentCompilationDraft = Omit<CommentCompilationInput, 'requestId'>;
type CommentCompilationOptions = Pick<CommentCompilationDraft, 'title' | 'format' | 'includeQuotes'>;
export interface CommentCompilationState {
  selecting: boolean;
  selectedIds: readonly string[];
  draft: CommentCompilationDraft | null;
  options: CommentCompilationOptions | null;
  pending: CommentCompilationInput | null;
  result: CommentCompilationResult | null;
  owner: string | null;
  busy: boolean;
  error:
    'changed' | 'tooLarge' | 'empty' | 'invalid' | 'failed' | 'prepareFailed' | 'openFailed' | 'unavailable' | null;
}
const initialState = (): CommentCompilationState => ({
  selecting: false,
  selectedIds: [],
  draft: null,
  options: null,
  pending: null,
  result: null,
  owner: null,
  busy: false,
  error: null,
});
function createState() {
  let state = initialState();
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update(change: Partial<CommentCompilationState>) {
      state = { ...state, ...change };
      // Invalidating the source snapshot must not discard the author's output choices.
      if (change.draft) {
        const { title, format, includeQuotes } = change.draft;
        state.options = { title, format, includeQuotes };
      }
      listeners.forEach((listener) => listener());
    },
    reset() {
      state = initialState();
      listeners.forEach((listener) => listener());
    },
  };
}
const states = new WeakMap<ArticleEditorSessionRuntime, ReturnType<typeof createState>>();
const unavailable = createState();

/** Split panes and reopened comment panels reuse one operation; disposing the editor releases it. */
export function commentCompilationState(session: ArticleEditorSessionRuntime | undefined) {
  if (!session) return unavailable;
  let state = states.get(session);
  if (!state) {
    state = createState();
    states.set(session, state);
  }
  return state;
}
