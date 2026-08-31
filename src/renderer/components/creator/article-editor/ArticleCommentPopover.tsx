import {
  AlertTriangleIcon,
  CheckIcon,
  CircleXIcon,
  PencilIcon,
  RotateCcwIcon,
  SaveIcon,
  SendIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ArticleCommentDto, ArticleCommentStatus } from '@/shared/contracts';
import { CodexThreadLinkText } from '@/renderer/components/content/CodexThreadLinkText';
import { ArticleCommentModelIdentity } from '@/renderer/components/creator/article-editor/ArticleCommentModelIdentity';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/renderer/components/ui/popover';
import { Textarea } from '@/renderer/components/ui/textarea';
import type { ArticleCommentAnchorRect } from '@/renderer/features/video-documents/articleElementIdentity';

export interface ArticleCommentDraftPopover {
  preview: string;
  rect: ArticleCommentAnchorRect;
}

interface Props {
  busy: boolean;
  draft: ArticleCommentDraftPopover | null;
  hovered: ArticleCommentDto | null;
  hoveredRect: ArticleCommentAnchorRect | null;
  selected: ArticleCommentDto | null;
  selectedRect: ArticleCommentAnchorRect | null;
  zh: boolean;
  onDelete(commentId: string): void;
  onDraftCancel(): void;
  onDraftSubmit(body: string): void;
  onHoverDismiss(): void;
  onHoverEngage(commentId: string): void;
  onReply(commentId: string, body: string): void;
  onSelectedClose(): void;
  onStatusChange(commentId: string, status: ArticleCommentStatus): void;
  onUpdateBody(commentId: string, body: string): void;
}

function targetResolutionLabel(comment: ArticleCommentDto, zh: boolean) {
  if (comment.targetResolution === 'RELOCATED') {
    return zh ? '原文已删除，已附到相邻位置' : 'Original content deleted; attached nearby';
  }
  return zh ? '原文已删除，附近没有可附着的位置' : 'Original content deleted; no nearby target remains';
}

function CommentTarget({ comment, preview, zh }: { comment?: ArticleCommentDto; preview: string; zh: boolean }) {
  const targetWarning = comment && comment.targetResolution !== 'AVAILABLE' ? targetResolutionLabel(comment, zh) : null;
  return (
    <div className="flex items-start gap-2">
      {targetWarning && (
        <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-warning" aria-label={targetWarning} role="img" />
      )}
      <div className="line-clamp-3 min-w-0 flex-1 border-l-2 border-warning pl-2 text-xs leading-5 text-muted-foreground">
        {preview || (zh ? '空内容块' : 'Empty block')}
      </div>
    </div>
  );
}

function CommentComposer({
  busy,
  preview,
  zh,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  preview: string;
  zh: boolean;
  onCancel(): void;
  onSubmit(body: string): void;
}) {
  const [body, setBody] = useState('');

  function submit() {
    const next = body.trim();
    if (!next || busy) return;
    onSubmit(next);
  }

  return (
    <div>
      <div className="border-b px-3 py-3">
        <CommentTarget preview={preview} zh={zh} />
      </div>
      <div className="p-3">
        <Textarea
          autoFocus
          value={body}
          rows={3}
          maxLength={10_000}
          disabled={busy}
          className="min-h-24 resize-none"
          aria-label={zh ? '新评论' : 'New comment'}
          placeholder={zh ? '添加评论' : 'Add comment'}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return;
            event.preventDefault();
            submit();
          }}
        />
        <div className="mt-2 flex justify-end gap-1">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
            {zh ? '取消' : 'Cancel'}
          </Button>
          <Button type="button" size="sm" disabled={busy || !body.trim()} onClick={submit}>
            <SendIcon className="size-3.5" />
            {zh ? '评论' : 'Comment'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CommentThreadActions({
  busy,
  comment,
  editing,
  zh,
  onClose,
  onDelete,
  onEdit,
  onStatusChange,
}: {
  busy: boolean;
  comment: ArticleCommentDto;
  editing: boolean;
  zh: boolean;
  onClose(): void;
  onDelete(): void;
  onEdit(): void;
  onStatusChange(status: ArticleCommentStatus): void;
}) {
  const resolveLabel = zh ? '解决评论' : 'Resolve comment';
  const rejectLabel = zh ? '拒绝意见' : 'Reject suggestion';
  const reopenLabel = zh ? '重新打开评论' : 'Reopen comment';
  return (
    <div className="flex items-center gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={busy || editing}
        aria-label={zh ? '编辑评论' : 'Edit comment'}
        title={zh ? '编辑评论' : 'Edit comment'}
        onClick={onEdit}
      >
        <PencilIcon className="size-3.5" />
      </Button>
      {comment.status === 'OPEN' ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            aria-label={resolveLabel}
            title={resolveLabel}
            onClick={() => onStatusChange('RESOLVED')}
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
            onClick={() => onStatusChange('REJECTED')}
          >
            <CircleXIcon className="size-3.5" />
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label={reopenLabel}
          title={reopenLabel}
          onClick={() => onStatusChange('OPEN')}
        >
          <RotateCcwIcon className="size-3.5" />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={busy}
        aria-label={zh ? '删除评论' : 'Delete comment'}
        title={zh ? '删除评论' : 'Delete comment'}
        onClick={onDelete}
      >
        <Trash2Icon className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={zh ? '关闭评论' : 'Close comment'}
        title={zh ? '关闭评论' : 'Close comment'}
        onClick={onClose}
      >
        <XIcon className="size-3.5" />
      </Button>
    </div>
  );
}

function CommentThread({
  busy,
  comment,
  zh,
  onClose,
  onDelete,
  onReply,
  onStatusChange,
  onUpdateBody,
}: {
  busy: boolean;
  comment: ArticleCommentDto;
  zh: boolean;
  onClose(): void;
  onDelete(): void;
  onReply(body: string): void;
  onStatusChange(status: ArticleCommentStatus): void;
  onUpdateBody(body: string): void;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body);
  const [reply, setReply] = useState('');

  useEffect(() => {
    setEditing(false);
    setBody(comment.body);
    setReply('');
  }, [comment.body, comment.id]);

  function submitReply() {
    const next = reply.trim();
    if (!next || busy) return;
    onReply(next);
    setReply('');
  }

  return (
    <div>
      <div className="flex items-start gap-2 border-b px-3 py-2">
        <div className="min-w-0 flex-1 pt-1">
          <CommentTarget comment={comment} preview={comment.preview} zh={zh} />
        </div>
        <CommentThreadActions
          busy={busy}
          comment={comment}
          editing={editing}
          zh={zh}
          onClose={onClose}
          onDelete={onDelete}
          onEdit={() => setEditing(true)}
          onStatusChange={onStatusChange}
        />
      </div>
      <div className="p-3">
        {comment.modelAuthor && (
          <ArticleCommentModelIdentity author={comment.modelAuthor} className="mb-2 flex max-w-full" />
        )}
        {editing ? (
          <div>
            <Textarea
              autoFocus
              value={body}
              rows={3}
              maxLength={10_000}
              disabled={busy}
              className="min-h-20 resize-none"
              aria-label={zh ? '评论正文' : 'Comment body'}
              onChange={(event) => setBody(event.target.value)}
            />
            <div className="mt-2 flex justify-end gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setBody(comment.body);
                  setEditing(false);
                }}
              >
                {zh ? '取消' : 'Cancel'}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busy || body === comment.body}
                onClick={() => {
                  onUpdateBody(body);
                  setEditing(false);
                }}
              >
                <SaveIcon className="size-3.5" />
                {zh ? '保存' : 'Save'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="whitespace-pre-wrap text-sm leading-6">
            <CodexThreadLinkText value={comment.body || (zh ? '空评论' : 'Empty comment')} />
          </div>
        )}
        {comment.replies.length > 0 && (
          <div className="mt-3 max-h-36 space-y-2 overflow-y-auto border-l pl-3">
            {comment.replies.map((item) => (
              <div key={item.id} className="whitespace-pre-wrap text-sm leading-5">
                <CodexThreadLinkText value={item.body} />
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 flex items-end gap-1">
          <Textarea
            value={reply}
            rows={2}
            maxLength={10_000}
            disabled={busy}
            className="min-h-16 resize-none"
            aria-label={zh ? '回复' : 'Reply'}
            placeholder={zh ? '回复' : 'Reply'}
            onChange={(event) => setReply(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return;
              event.preventDefault();
              submitReply();
            }}
          />
          <Button
            type="button"
            size="icon-sm"
            disabled={busy || !reply.trim()}
            aria-label={zh ? '发送回复' : 'Send reply'}
            onClick={submitReply}
          >
            <SendIcon className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function CommentHoverPreview({ comment, zh }: { comment: ArticleCommentDto; zh: boolean }) {
  return (
    <div className="space-y-2">
      {comment.modelAuthor && <ArticleCommentModelIdentity author={comment.modelAuthor} className="flex max-w-full" />}
      <CommentTarget comment={comment} preview={comment.preview} zh={zh} />
      <div className="line-clamp-4 whitespace-pre-wrap text-sm leading-5">
        {comment.body || (zh ? '空评论' : 'Empty comment')}
      </div>
      {comment.replies.length > 0 && (
        <div className="text-2xs tabular-nums text-muted-foreground">
          {zh ? `${comment.replies.length} 条回复` : `${comment.replies.length} replies`}
        </div>
      )}
    </div>
  );
}

export function ArticleCommentPopover(props: Props) {
  const mode = props.draft ? 'DRAFT' : props.selected ? 'THREAD' : props.hovered ? 'HOVER' : null;
  const rect = props.draft?.rect ?? props.selectedRect ?? props.hoveredRect;
  const virtualAnchor = useMemo(
    () => ({
      getBoundingClientRect: () =>
        rect ? new DOMRect(rect.left, rect.top, Math.max(rect.width, 1), Math.max(rect.height, 1)) : new DOMRect(),
    }),
    [rect],
  );
  const virtualRef = useRef(virtualAnchor);
  virtualRef.current = virtualAnchor;

  if (!mode || !rect) return null;

  return (
    <Popover
      open
      modal={false}
      onOpenChange={(open) => {
        if (open) return;
        if (mode === 'DRAFT') props.onDraftCancel();
        else if (mode === 'THREAD') props.onSelectedClose();
        else props.onHoverDismiss();
      }}
    >
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent
        side="right"
        align="start"
        sideOffset={10}
        collisionPadding={12}
        className={mode === 'HOVER' ? 'w-72 p-3' : 'w-80 p-0'}
        onPointerEnter={() => {
          if (mode === 'HOVER') props.onHoverEngage(props.hovered!.id);
        }}
        onOpenAutoFocus={(event) => {
          if (mode !== 'DRAFT') event.preventDefault();
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {mode === 'DRAFT' ? (
          <CommentComposer
            busy={props.busy}
            preview={props.draft!.preview}
            zh={props.zh}
            onCancel={props.onDraftCancel}
            onSubmit={props.onDraftSubmit}
          />
        ) : mode === 'THREAD' ? (
          <CommentThread
            busy={props.busy}
            comment={props.selected!}
            zh={props.zh}
            onClose={props.onSelectedClose}
            onDelete={() => props.onDelete(props.selected!.id)}
            onReply={(body) => props.onReply(props.selected!.id, body)}
            onStatusChange={(status) => props.onStatusChange(props.selected!.id, status)}
            onUpdateBody={(body) => props.onUpdateBody(props.selected!.id, body)}
          />
        ) : (
          <CommentHoverPreview comment={props.hovered!} zh={props.zh} />
        )}
      </PopoverContent>
    </Popover>
  );
}
