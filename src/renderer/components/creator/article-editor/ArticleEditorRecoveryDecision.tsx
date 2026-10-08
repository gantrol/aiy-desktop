import { LoaderCircleIcon } from 'lucide-react';
import type { ArticleEditorSessionRuntime } from '@/renderer/components/creator/article-editor/ArticleEditorSessionRuntime';
import { ArticleReferenceDocument } from '@/renderer/components/creator/article-editor/ArticleEditorComparison';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';

export function ArticleEditorRecoveryDecision({
  runtime,
  onAdopt,
}: {
  runtime: ArticleEditorSessionRuntime;
  onAdopt(): void;
}) {
  const { locale, messages } = useI18n();
  const copy = messages.creator.articleRecovery;
  if (runtime.recovery === 'loading') {
    return (
      <div
        data-article-editor-recovery-loading
        role="status"
        aria-label={copy.checking}
        className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-background"
      >
        <LoaderCircleIcon
          className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none"
          aria-hidden="true"
        />
      </div>
    );
  }
  const conflicted = runtime.recovery === 'conflict';
  const draft = runtime.recoveryDraft;
  const recoveredAt = runtime.recoveryUpdatedAt;
  return (
    <div data-article-editor-recovery className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0 space-y-1">
          <p role="status" className="text-sm font-medium">
            {conflicted ? copy.olderDraft : copy.unsavedDraft}
          </p>
          {recoveredAt !== null && (
            <time dateTime={new Date(recoveredAt).toISOString()} className="block text-xs text-muted-foreground">
              {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(recoveredAt)}
            </time>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void runtime.discardRecovery()}>
            {copy.discard}
          </Button>
          {conflicted ? (
            <Button type="button" onClick={() => runtime.keepRecovery()}>
              {copy.keep}
            </Button>
          ) : (
            <Button type="button" data-action="restore-article-draft" onClick={onAdopt}>
              {copy.restore}
            </Button>
          )}
        </div>
      </div>
      {draft && (
        <ArticleReferenceDocument
          title={draft.content.title}
          markdown={draft.content.markdown}
          media={draft.media}
          mediaBindings={draft.content.mediaBindings}
        />
      )}
    </div>
  );
}
