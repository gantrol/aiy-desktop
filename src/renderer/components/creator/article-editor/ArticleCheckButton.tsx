import { ListChecksIcon, LoaderCircleIcon } from 'lucide-react';
import { ArticleHeaderIconButton } from '@/renderer/components/creator/article-editor/ArticleEditorHeader';
import { useI18n } from '@/renderer/i18n/useI18n';

export function ArticleCheckButton({ busy, disabled, onClick }: { busy: boolean; disabled: boolean; onClick(): void }) {
  const label = useI18n().messages.creator.manuscriptEditor.aiCheck;
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
