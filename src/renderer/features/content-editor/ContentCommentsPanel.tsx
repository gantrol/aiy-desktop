import { AlertTriangleIcon, CheckIcon, CircleXIcon, MessageSquareIcon, RotateCcwIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ContentCommentDto, ContentCommentStatus } from '@/shared/contracts';
import { ContentCommentModelIdentity } from '@/renderer/features/content-editor/ContentCommentModelIdentity';
import { CodexThreadLinkText } from '@/renderer/components/content/CodexThreadLinkText';
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { cn } from '@/renderer/lib/utils';
import { useI18n } from '@/renderer/i18n/useI18n';

type CommentFilter = ContentCommentStatus | 'ALL';

interface Props {
  busy: boolean;
  comments: readonly ContentCommentDto[];
  hoveredId: string | null;
  selectedId: string | null;
  onHover(commentId: string | null): void;
  onSelect(commentId: string): void;
  onStatusChange(commentId: string, status: ContentCommentStatus): void;
}

function targetResolutionLabel(comment: ContentCommentDto, relocated: string, missing: string) {
  if (comment.targetResolution === 'AVAILABLE') return null;
  return comment.targetResolution === 'RELOCATED' ? relocated : missing;
}

function CommentFilterBar({
  comments,
  filter,
  onChange,
}: {
  comments: readonly ContentCommentDto[];
  filter: CommentFilter;
  onChange(filter: CommentFilter): void;
}) {
  const copy = useI18n().messages.contentEditor.comment;
  const counts = {
    OPEN: comments.filter((comment) => comment.status === 'OPEN').length,
    RESOLVED: comments.filter((comment) => comment.status === 'RESOLVED').length,
    REJECTED: comments.filter((comment) => comment.status === 'REJECTED').length,
    ALL: comments.length,
  };
  return (
    <div className="grid h-10 shrink-0 grid-cols-4 items-center gap-0.5 border-b px-2">
      {(['OPEN', 'RESOLVED', 'REJECTED', 'ALL'] as const).map((item) => (
        <Button
          key={item}
          type="button"
          variant={filter === item ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 min-w-0 px-1 text-2xs font-normal"
          aria-pressed={filter === item}
          onClick={() => onChange(item)}
        >
          <span className="truncate">
            {{ OPEN: copy.open, RESOLVED: copy.resolved, REJECTED: copy.rejected, ALL: copy.all }[item].replace(
              '{count}',
              String(counts[item]),
            )}
          </span>
        </Button>
      ))}
    </div>
  );
}

function CommentRow({
  busy,
  comment,
  hovered,
  selected,
  onHover,
  onSelect,
  onStatusChange,
}: {
  busy: boolean;
  comment: ContentCommentDto;
  hovered: boolean;
  selected: boolean;
  onHover(commentId: string | null): void;
  onSelect(commentId: string): void;
  onStatusChange(commentId: string, status: ContentCommentStatus): void;
}) {
  const copy = useI18n().messages.contentEditor.comment;
  const body = comment.body.trim() || comment.preview || copy.empty;
  const target = comment.body.trim() ? comment.preview : '';
  const replyCount = comment.replies.length;
  const resolveLabel = copy.resolve;
  const rejectLabel = copy.reject;
  const reopenLabel = copy.reopen;
  const targetWarning = targetResolutionLabel(comment, copy.relocated, copy.missing);

  return (
    <div
      className={cn(
        'group/comment-row relative flex min-w-0 border-b border-l-2 border-l-transparent transition-colors duration-fast',
        hovered && 'bg-warning-surface/20',
        selected && 'border-l-warning bg-warning-surface/35',
      )}
      onPointerEnter={() => onHover(comment.id)}
      onPointerLeave={() => onHover(null)}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto min-w-0 flex-1 justify-start gap-2 rounded-none px-3 py-3 text-left font-normal hover:bg-transparent active:bg-transparent"
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect(comment.id)}
      >
        {!comment.modelAuthor && (
          <MessageSquareIcon
            className={cn(
              'mt-0.5 size-4 shrink-0 self-start',
              comment.status === 'OPEN'
                ? 'text-warning'
                : comment.status === 'REJECTED'
                  ? 'text-destructive'
                  : 'text-muted-foreground',
            )}
          />
        )}
        <span className="min-w-0 flex-1">
          {comment.modelAuthor && (
            <ContentCommentModelIdentity author={comment.modelAuthor} className="mb-1 flex max-w-full" />
          )}
          <span className="line-clamp-2 block text-sm leading-5">
            {selected ? <CodexThreadLinkText value={body} /> : body}
          </span>
          {target && <span className="mt-1 line-clamp-1 block text-xs text-muted-foreground">{target}</span>}
          {replyCount > 0 && (
            <span className="mt-1 block text-2xs tabular-nums text-muted-foreground">
              {copy.replies.replace('{count}', String(replyCount))}
            </span>
          )}
        </span>
      </Button>
      {targetWarning && (
        <AlertTriangleIcon className="mr-1 mt-3 size-3.5 shrink-0 text-warning" aria-label={targetWarning} role="img" />
      )}
      {comment.status === 'OPEN' ? (
        <div className="mr-1 mt-2 flex shrink-0 opacity-0 transition-opacity group-hover/comment-row:opacity-100 group-focus-within/comment-row:opacity-100">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            aria-label={resolveLabel}
            title={resolveLabel}
            onClick={() => onStatusChange(comment.id, 'RESOLVED')}
          >
            <CheckIcon className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            disabled={busy}
            aria-label={rejectLabel}
            title={rejectLabel}
            onClick={() => onStatusChange(comment.id, 'REJECTED')}
          >
            <CircleXIcon className="size-3.5" />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="mr-1 mt-2 shrink-0 opacity-0 transition-opacity group-hover/comment-row:opacity-100 group-focus-within/comment-row:opacity-100"
          disabled={busy}
          aria-label={reopenLabel}
          title={reopenLabel}
          onClick={() => onStatusChange(comment.id, 'OPEN')}
        >
          <RotateCcwIcon className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

export function ContentCommentsPanel({
  busy,
  comments,
  hoveredId,
  selectedId,
  onHover,
  onSelect,
  onStatusChange,
}: Props) {
  const copy = useI18n().messages.contentEditor.comment;
  const [filter, setFilter] = useState<CommentFilter>('OPEN');
  const filtered = useMemo(
    () => (filter === 'ALL' ? comments : comments.filter((comment) => comment.status === filter)),
    [comments, filter],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-label={copy.list}>
      <CommentFilterBar comments={comments} filter={filter} onChange={setFilter} />
      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
        {filtered.length ? (
          filtered.map((comment) => (
            <CommentRow
              key={comment.id}
              busy={busy}
              comment={comment}
              hovered={comment.id === hoveredId}
              selected={comment.id === selectedId}
              onHover={onHover}
              onSelect={onSelect}
              onStatusChange={onStatusChange}
            />
          ))
        ) : (
          <div className="grid h-24 place-items-center text-muted-foreground" aria-label={copy.none}>
            <MessageSquareIcon className="size-4" />
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
