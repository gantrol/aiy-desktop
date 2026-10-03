import { FileTextIcon, ListChecksIcon, LoaderCircleIcon, XIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { CommentCompilationController } from '@/renderer/features/comment-compilation/useCommentCompilation';

export function CommentCompilationActions({ controller }: { controller: CommentCompilationController }) {
  const copy = useI18n().messages.commentCompilation;
  const { state, supported, locked } = controller;
  if (!supported) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1.5">
      {!state.selecting && !state.result ? (
        <Button variant="ghost" size="sm" disabled={locked} onClick={controller.begin}>
          <ListChecksIcon className="size-4" />
          {copy.select}
        </Button>
      ) : (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={locked}
            aria-label={copy.clear}
            title={copy.clear}
            onClick={controller.clear}
          >
            <XIcon className="size-4" />
          </Button>
          {!state.result && (
            <span className="min-w-0 flex-1 text-xs tabular-nums" aria-live="polite">
              {copy.selected.replace('{count}', String(state.selectedIds.length))}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={controller.blocked || (!state.result && !state.selectedIds.length)}
            onClick={() => void (state.result ? controller.openResult(state.result) : controller.prepare())}
          >
            {state.busy ? <LoaderCircleIcon className="size-4 animate-spin" /> : <FileTextIcon className="size-4" />}
            {state.result ? copy.openResult : copy.compose}
          </Button>
        </>
      )}
      {state.error && !controller.dialogOpen && (
        <span role="alert" className="w-full text-xs text-destructive">
          {copy[state.error]}
        </span>
      )}
    </div>
  );
}
