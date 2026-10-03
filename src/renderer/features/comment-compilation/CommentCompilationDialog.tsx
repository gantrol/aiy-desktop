import { LoaderCircleIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { useWorkspacePaneContainer } from '@/renderer/components/workspace/WorkspacePaneScope';
import { CommentCompilationRow } from '@/renderer/features/comment-compilation/CommentCompilationRow';
import type { CommentCompilationController } from '@/renderer/features/comment-compilation/useCommentCompilation';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useId } from 'react';

export function CommentCompilationDialog({ controller }: { controller: CommentCompilationController }) {
  const { messages } = useI18n();
  const copy = messages.commentCompilation;
  const common = messages.common;
  const container = useWorkspacePaneContainer();
  const titleId = useId();
  const quoteId = useId();
  const { state, locked } = controller;
  const draft = state.draft;
  if (!controller.supported || !draft) return null;
  function move(index: number, direction: -1 | 1) {
    if (!draft) return;
    const comments = [...draft.comments];
    const target = index + direction;
    if (target < 0 || target >= comments.length) return;
    [comments[index], comments[target]] = [comments[target], comments[index]];
    controller.changeDraft({ comments });
  }
  return (
    <Dialog
      container={container}
      open={controller.dialogOpen}
      onOpenChange={(open) => {
        if (!open) controller.close();
      }}
    >
      <DialogContent
        className="flex max-w-2xl flex-col rounded-sm p-4 shadow-none"
        aria-describedby={undefined}
        showCloseButton={!state.busy}
      >
        <DialogHeader>
          <DialogTitle>{copy.compose}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1 space-y-1.5">
            <Label htmlFor={titleId}>{copy.title}</Label>
            <Input
              id={titleId}
              value={draft.title}
              maxLength={200}
              disabled={locked}
              onChange={(event) => controller.changeDraft({ title: event.target.value })}
            />
          </div>
          <Select
            value={draft.format}
            disabled={locked}
            onValueChange={(format) => {
              if (format === 'MANUSCRIPT' || format === 'OUTLINE') controller.changeDraft({ format });
            }}
          >
            <SelectTrigger className="w-32" aria-label={copy.format}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MANUSCRIPT">{copy.manuscript}</SelectItem>
              <SelectItem value="OUTLINE">{copy.outline}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id={quoteId}
            checked={draft.includeQuotes}
            disabled={locked}
            onCheckedChange={(checked) => controller.changeDraft({ includeQuotes: checked === true })}
          />
          <Label htmlFor={quoteId}>{copy.includeQuotes}</Label>
        </div>
        <ScrollArea className="min-h-0 max-h-[50vh] flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
          <ol className="divide-y" aria-label={copy.order}>
            {draft.comments.map((comment, index) => (
              <CommentCompilationRow
                key={comment.id}
                comment={comment}
                index={index}
                count={draft.comments.length}
                locked={locked}
                includeQuotes={draft.includeQuotes}
                onMove={(direction) => move(index, direction)}
                onRemove={() =>
                  controller.changeDraft({ comments: draft.comments.filter((item) => item.id !== comment.id) })
                }
              />
            ))}
          </ol>
        </ScrollArea>
        {state.error && (
          <div role="alert" className="text-sm text-destructive">
            {copy[state.error]}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={state.busy} onClick={controller.close}>
            {state.pending ? common.close : common.cancel}
          </Button>
          {state.error === 'changed' ? (
            <Button disabled={state.busy} onClick={() => void controller.prepare(true)}>
              {copy.refresh}
            </Button>
          ) : (
            <Button
              disabled={controller.blocked || !draft.comments.length || !draft.title.trim()}
              onClick={() => void controller.submit()}
            >
              {state.busy && <LoaderCircleIcon className="size-4 animate-spin" />}
              {state.pending ? copy.retry : copy.create}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
