import { AlertTriangleIcon, CheckIcon, CircleXIcon, MessageSquareIcon, RotateCcwIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ArticleCommentDto, ArticleCommentStatus } from '@/shared/contracts';
import { ArticleCommentModelIdentity } from '@/renderer/components/creator/article-editor/ArticleCommentModelIdentity';
import { CodexThreadLinkText } from '@/renderer/components/content/CodexThreadLinkText';
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { cn } from '@/renderer/lib/utils';

type CommentFilter = ArticleCommentStatus | 'ALL';

interface Props {
  busy: boolean;
  comments: readonly ArticleCommentDto[];
  hoveredId: string | null;
  selectedId: string | null;
  zh: boolean;
  onHover(commentId: string | null): void;
  onSelect(commentId: string): void;
  onStatusChange(commentId: string, status: ArticleCommentStatus): void;
}

function filterLabel(filter: CommentFilter, count: number, zh: boolean) {
  if (filter === 'OPEN') return `${zh ? '待处理' : 'Open'} ${count}`;
  if (filter === 'RESOLVED') return `${zh ? '已解决' : 'Resolved'} ${count}`;
  if (filter === 'REJECTED') return `${zh ? '已拒绝' : 'Rejected'} ${count}`;
  return `${zh ? '全部' : 'All'} ${count}`;
}

function targetResolutionLabel(comment: ArticleCommentDto, zh: boolean) {
  if (comment.targetResolution === 'AVAILABLE') return null;
  if (comment.targetResolution === 'RELOCATED') {
    return zh ? '原文已删除，已附到相邻位置' : 'Original content deleted; attached nearby';
  }
  return zh ? '原文已删除，附近没有可附着的位置' : 'Original content deleted; no nearby target remains';
}

function CommentFilterBar({
  comments,
  filter,
  zh,
  onChange,
}: {
  comments: readonly ArticleCommentDto[];
  filter: CommentFilter;
  zh: boolean;
  onChange(filter: CommentFilter): void;
}) {
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
          <span className="truncate">{filterLabel(item, counts[item], zh)}</span>
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
  zh,
  onHover,
  onSelect,
  onStatusChange,
}: {
  busy: boolean;
  comment: ArticleCommentDto;
  hovered: boolean;
  selected: boolean;
  zh: boolean;
  onHover(commentId: string | null): void;
  onSelect(commentId: string): void;
  onStatusChange(commentId: string, status: ArticleCommentStatus): void;
}) {
  const body = comment.body.trim() || comment.preview || (zh ? '空评论' : 'Empty comment');
  const target = comment.body.trim() ? comment.preview : '';
  const replyCount = comment.replies.length;
  const resolveLabel = zh ? '解决评论' : 'Resolve comment';
  const rejectLabel = zh ? '拒绝意见' : 'Reject suggestion';
  const reopenLabel = zh ? '重新打开评论' : 'Reopen comment';
  const targetWarning = targetResolutionLabel(comment, zh);

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
            <ArticleCommentModelIdentity author={comment.modelAuthor} className="mb-1 flex max-w-full" />
          )}
          <span className="line-clamp-2 block text-sm leading-5">
            {selected ? <CodexThreadLinkText value={body} /> : body}
          </span>
          {target && <span className="mt-1 line-clamp-1 block text-xs text-muted-foreground">{target}</span>}
          {replyCount > 0 && (
            <span className="mt-1 block text-2xs tabular-nums text-muted-foreground">
              {zh ? `${replyCount} 条回复` : `${replyCount} replies`}
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

export function ArticleCommentsPanel({
  busy,
  comments,
  hoveredId,
  selectedId,
  zh,
  onHover,
  onSelect,
  onStatusChange,
}: Props) {
  const [filter, setFilter] = useState<CommentFilter>('OPEN');
  const filtered = useMemo(
    () => (filter === 'ALL' ? comments : comments.filter((comment) => comment.status === filter)),
    [comments, filter],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-label={zh ? '评论列表' : 'Comment list'}>
      <CommentFilterBar comments={comments} filter={filter} zh={zh} onChange={setFilter} />
      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
        {filtered.length ? (
          filtered.map((comment) => (
            <CommentRow
              key={comment.id}
              busy={busy}
              comment={comment}
              hovered={comment.id === hoveredId}
              selected={comment.id === selectedId}
              zh={zh}
              onHover={onHover}
              onSelect={onSelect}
              onStatusChange={onStatusChange}
            />
          ))
        ) : (
          <div
            className="grid h-24 place-items-center text-muted-foreground"
            aria-label={zh ? '没有评论' : 'No comments'}
          >
            <MessageSquareIcon className="size-4" />
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
