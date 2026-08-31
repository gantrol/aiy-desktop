import { ListChecksIcon, LoaderCircleIcon } from 'lucide-react';
import { ArticleHeaderIconButton } from '@/renderer/components/creator/article-editor/ArticleEditorHeader';

export function ArticleCheckButton({
  busy,
  disabled,
  zh,
  onClick,
}: {
  busy: boolean;
  disabled: boolean;
  zh: boolean;
  onClick(): void;
}) {
  const label = zh ? 'AI 检查并添加评论' : 'AI check and add comments';
  return (
    <ArticleHeaderIconButton
      type="button"
      variant="ghost"
      disabled={disabled}
      aria-busy={busy || undefined}
      label={label}
      onClick={onClick}
    >
      {busy ? <LoaderCircleIcon className="size-4 animate-spin" /> : <ListChecksIcon className="size-4" />}
    </ArticleHeaderIconButton>
  );
}
