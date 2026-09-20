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
import type { ContentCommentDto, ContentCommentStatus } from '@/shared/contracts';
import { CodexThreadLinkText } from '@/renderer/components/content/CodexThreadLinkText';
import { ContentCommentModelIdentity } from '@/renderer/features/content-editor/ContentCommentModelIdentity';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/renderer/components/ui/popover';
import { Textarea } from '@/renderer/components/ui/textarea';
import type { ArticleCommentAnchorRect } from '@/renderer/features/video-documents/articleElementIdentity';
import { useI18n } from '@/renderer/i18n/useI18n';

export interface ContentCommentDraftPopover {
  preview: string;
  rect: ArticleCommentAnchorRect;
}

interface Props {
  busy: boolean;
  draft: ContentCommentDraftPopover | null;
  hovered: ContentCommentDto | null;
  hoveredRect: ArticleCommentAnchorRect | null;
  selected: ContentCommentDto | null;
  selectedRect: ArticleCommentAnchorRect | null;
  onDelete(commentId: string): void;
  onDraftCancel(): void;
  onDraftSubmit(body: string): void;
  onHoverDismiss(): void;
  onHoverEngage(commentId: string): void;
  onReply(commentId: string, body: string): Promise<boolean>;
  onSelectedClose(): void;
  onStatusChange(commentId: string, status: ContentCommentStatus): void;
  onUpdateBody(commentId: string, body: string): void;
}

function CommentTarget({ comment, preview }: { comment?: ContentCommentDto; preview: string }) {
  const copy = useI18n().messages.contentEditor.comment;
  const targetWarning =
    comment && comment.targetResolution !== 'AVAILABLE'
      ? comment.targetResolution === 'RELOCATED'
        ? copy.relocated
        : copy.missing
      : null;
  return (
    <div className="flex items-start gap-2">
      {targetWarning && (
        <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-warning" aria-label={targetWarning} role="img" />
      )}
      <div className="line-clamp-3 min-w-0 flex-1 border-l-2 border-warning pl-2 text-xs leading-5 text-muted-foreground">
        {preview || copy.emptyBlock}
      </div>
    </div>
  );
}

function CommentComposer({
  busy,
  preview,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  preview: string;
  onCancel(): void;
  onSubmit(body: string): void;
}) {
  const copy = useI18n().messages.contentEditor.comment;
  const [body, setBody] = useState('');

  function submit() {
    const next = body.trim();
    if (!next || busy) return;
    onSubmit(next);
  }

  return (
    <div>
      <div className="border-b px-3 py-3">
        <CommentTarget preview={preview} />
      </div>
      <div className="p-3">
        <Textarea
          autoFocus
          value={body}
          rows={3}
          maxLength={10_000}
          disabled={busy}
          className="min-h-24 resize-none"
          aria-label={copy.new}
          placeholder={copy.add}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return;
            event.preventDefault();
            submit();
          }}
        />
        <div className="mt-2 flex justify-end gap-1">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
            {copy.cancel}
          </Button>
          <Button type="button" size="sm" disabled={busy || !body.trim()} onClick={submit}>
            <SendIcon className="size-3.5" />
            {copy.submit}
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
  onClose,
  onDelete,
  onEdit,
  onStatusChange,
}: {
  busy: boolean;
  comment: ContentCommentDto;
  editing: boolean;
  onClose(): void;
  onDelete(): void;
  onEdit(): void;
  onStatusChange(status: ContentCommentStatus): void;
}) {
  const copy = useI18n().messages.contentEditor.comment;
  const resolveLabel = copy.resolve;
  const rejectLabel = copy.reject;
  const reopenLabel = copy.reopen;
  return (
    <div className="flex items-center gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={busy || editing}
        aria-label={copy.edit}
        title={copy.edit}
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
        aria-label={copy.delete}
        title={copy.delete}
        onClick={onDelete}
      >
        <Trash2Icon className="size-3.5" />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={copy.close} title={copy.close} onClick={onClose}>
        <XIcon className="size-3.5" />
      </Button>
    </div>
  );
}

function CommentThread({
  busy,
  comment,
  onClose,
  onDelete,
  onReply,
  onStatusChange,
  onUpdateBody,
}: {
  busy: boolean;
  comment: ContentCommentDto;
  onClose(): void;
  onDelete(): void;
  onReply(body: string): Promise<boolean>;
  onStatusChange(status: ContentCommentStatus): void;
  onUpdateBody(body: string): void;
}) {
  const copy = useI18n().messages.contentEditor.comment;
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body);
  const [reply, setReply] = useState('');

  useEffect(() => {
    setEditing(false);
    setBody(comment.body);
  }, [comment.body, comment.id]);

  async function submitReply() {
    const next = reply.trim();
    if (!next || busy) return;
    if (await onReply(next)) setReply((current) => (current.trim() === next ? '' : current));
  }

  return (
    <div>
      <div className="flex items-start gap-2 border-b px-3 py-2">
        <div className="min-w-0 flex-1 pt-1">
          <CommentTarget comment={comment} preview={comment.preview} />
        </div>
        <CommentThreadActions
          busy={busy}
          comment={comment}
          editing={editing}
          onClose={onClose}
          onDelete={onDelete}
          onEdit={() => setEditing(true)}
          onStatusChange={onStatusChange}
        />
      </div>
      <div className="p-3">
        {comment.modelAuthor && (
          <ContentCommentModelIdentity author={comment.modelAuthor} className="mb-2 flex max-w-full" />
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
              aria-label={copy.body}
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
                {copy.cancel}
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
                {copy.save}
              </Button>
            </div>
          </div>
        ) : (
          <div className="whitespace-pre-wrap text-sm leading-6">
            <CodexThreadLinkText value={comment.body || copy.empty} />
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
            aria-label={copy.reply}
            placeholder={copy.reply}
            onChange={(event) => setReply(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return;
              event.preventDefault();
              void submitReply();
            }}
          />
          <Button
            type="button"
            size="icon-sm"
            disabled={busy || !reply.trim()}
            aria-label={copy.sendReply}
            onClick={submitReply}
          >
            <SendIcon className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function CommentHoverPreview({ comment }: { comment: ContentCommentDto }) {
  const copy = useI18n().messages.contentEditor.comment;
  return (
    <div className="space-y-2">
      {comment.modelAuthor && <ContentCommentModelIdentity author={comment.modelAuthor} className="flex max-w-full" />}
      <CommentTarget comment={comment} preview={comment.preview} />
      <div className="line-clamp-4 whitespace-pre-wrap text-sm leading-5">{comment.body || copy.empty}</div>
      {comment.replies.length > 0 && (
        <div className="text-2xs tabular-nums text-muted-foreground">
          {copy.replies.replace('{count}', String(comment.replies.length))}
        </div>
      )}
    </div>
  );
}

export function ContentCommentPopover(props: Props) {
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
            onCancel={props.onDraftCancel}
            onSubmit={props.onDraftSubmit}
          />
        ) : mode === 'THREAD' ? (
          <CommentThread
            key={props.selected!.id}
            busy={props.busy}
            comment={props.selected!}
            onClose={props.onSelectedClose}
            onDelete={() => props.onDelete(props.selected!.id)}
            onReply={(body) => props.onReply(props.selected!.id, body)}
            onStatusChange={(status) => props.onStatusChange(props.selected!.id, status)}
            onUpdateBody={(body) => props.onUpdateBody(props.selected!.id, body)}
          />
        ) : (
          <CommentHoverPreview comment={props.hovered!} />
        )}
      </PopoverContent>
    </Popover>
  );
}
