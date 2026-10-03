import { ArrowDownIcon, ArrowUpIcon, XIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { ContentCommentModelIdentity } from '@/renderer/features/content-editor/ContentCommentModelIdentity';
import type { CommentCompilationSelection } from '@/shared/contracts/comment-compilation';
import { useI18n } from '@/renderer/i18n/useI18n';

export function CommentCompilationRow({
  comment,
  index,
  count,
  locked,
  includeQuotes,
  onMove,
  onRemove,
}: {
  comment: CommentCompilationSelection;
  index: number;
  count: number;
  locked: boolean;
  includeQuotes: boolean;
  onMove(direction: -1 | 1): void;
  onRemove(): void;
}) {
  const copy = useI18n().messages.commentCompilation;
  return (
    <li className="py-3 first:pt-0">
      <div className="mb-2 flex items-center gap-1">
        <span className="min-w-0 flex-1 text-xs tabular-nums">{index + 1}</span>
        {comment.modelAuthor && <ContentCommentModelIdentity author={comment.modelAuthor} />}
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={locked || index === 0}
          aria-label={copy.moveUp}
          title={copy.moveUp}
          onClick={() => onMove(-1)}
        >
          <ArrowUpIcon className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={locked || index === count - 1}
          aria-label={copy.moveDown}
          title={copy.moveDown}
          onClick={() => onMove(1)}
        >
          <ArrowDownIcon className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={locked}
          aria-label={copy.remove}
          title={copy.remove}
          onClick={onRemove}
        >
          <XIcon className="size-4" />
        </Button>
      </div>
      {includeQuotes && comment.anchor.exactQuote && (
        <blockquote className="mb-2 whitespace-pre-wrap break-words border-l-2 pl-3 text-sm text-muted-foreground">
          {comment.anchor.exactQuote}
        </blockquote>
      )}
      <div className="whitespace-pre-wrap break-words text-sm">{comment.body}</div>
    </li>
  );
}
