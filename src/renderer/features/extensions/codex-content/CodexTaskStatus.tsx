import { ExternalLink, Images, RotateCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import type { CodexContentTask } from '@/shared/contracts/codex-content';

export type CodexTaskAction = 'open-task' | 'stop-and-open-task' | 'collect' | 'open-album';

export function CodexTaskStatus({
  task,
  busy,
  compact = false,
  onAction,
}: {
  task: CodexContentTask;
  busy: boolean;
  compact?: boolean;
  onAction(kind: CodexTaskAction): void;
}) {
  const messages = useI18n().messages.desktopPetals;
  const copy = messages.codex;
  const running = task.status === 'STARTING' || task.status === 'RUNNING';
  const label = running ? copy.stopAndOpenTask : copy.status[task.status];
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-1 text-xs',
        compact ? 'text-muted-foreground' : 'flex-wrap',
        (task.status === 'FAILED' || task.status === 'COLLECTION_FAILED') && 'text-destructive',
      )}
    >
      {task.threadId ? (
        <Button
          variant={compact ? 'ghost' : 'link'}
          size="xs"
          className={cn('min-w-0 text-inherit', compact && 'shrink gap-1 rounded-sm px-1 text-2xs')}
          disabled={busy}
          title={running ? copy.stopAndOpenTask : copy.openTask}
          aria-label={`${copy.status[task.status]} · ${running ? copy.stopAndOpenTask : copy.openTask}`}
          onClick={() => onAction(running ? 'stop-and-open-task' : 'open-task')}
        >
          <span className="truncate">{label}</span>
          <ExternalLink className="size-3 shrink-0 opacity-60" />
        </Button>
      ) : (
        <span role="status" className="truncate" title={copy.status[task.status]}>
          {copy.status[task.status]}
        </span>
      )}
      {task.status === 'COLLECTION_FAILED' && task.collectionRetryable && (
        <Button
          variant="ghost"
          size="xs"
          className={cn('text-inherit', compact && 'size-7 rounded-sm p-0')}
          disabled={busy}
          title={copy.retryCollection}
          aria-label={copy.retryCollection}
          onClick={() => onAction('collect')}
        >
          <RotateCw className="size-3" />
          {!compact && copy.retryCollection}
        </Button>
      )}
      {task.results.length > 0 && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7 rounded-sm text-inherit"
          disabled={busy}
          title={messages.actions.gallery}
          aria-label={messages.actions.gallery}
          onClick={() => onAction('open-album')}
        >
          <Images className="size-3" />
        </Button>
      )}
      {task.errorCode && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7 rounded-sm text-inherit"
              title={copy.failureDetails}
              aria-label={copy.failureDetails}
            >
              <TriangleAlert className="size-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            collisionPadding={12}
            className="max-w-[calc(100vw-24px)] space-y-2 p-3 text-xs"
          >
            <div role="alert">{copy.errors[task.errorCode]}</div>
            {task.errorDetail && (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words select-text">
                {task.errorDetail}
              </pre>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
