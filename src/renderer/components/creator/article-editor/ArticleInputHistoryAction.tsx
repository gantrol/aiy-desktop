import { useRef, useState } from 'react';
import { FileInputIcon } from 'lucide-react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ArticleHeaderIconButton } from '@/renderer/components/creator/article-editor/ArticleEditorHeader';
import { ArticleInputHistoryDialog } from '@/renderer/components/creator/article-editor/ArticleInputHistoryDialog';

export interface ArticleInputHistoryActionProps {
  articleId: string;
  spaceId: string;
  onContinue(draftId: string): Promise<boolean>;
  notify(message: string): void;
}

export function ArticleInputHistoryAction(props: ArticleInputHistoryActionProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const copy = useI18n().messages.creator.inputHistory;
  return (
    <>
      <ArticleHeaderIconButton ref={trigger} label={copy.originalInput} variant="ghost" onClick={() => setOpen(true)}>
        <FileInputIcon className="size-4" />
      </ArticleHeaderIconButton>
      {open && (
        <ArticleInputHistoryDialog
          key={`${props.spaceId}:${props.articleId}`}
          {...props}
          onClose={() => setOpen(false)}
          restoreFocus={() => trigger.current?.focus()}
        />
      )}
    </>
  );
}
