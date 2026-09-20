import { useMemo } from 'react';
import { Download, ListTree } from 'lucide-react';
import type { ArticleDto } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import { CreationWorkNavigation } from '@/renderer/components/creator/CreationWorkNavigation';
import { ContentBlockEditor } from '@/renderer/features/content-editor/ContentBlockEditor';
import { CopyAgentLinkButton } from '@/renderer/features/content-editor/CopyAgentLinkButton';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  useArticleEditorSession,
  useArticleEditorSessionSelector,
} from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { ArticleSaveStatus } from '@/renderer/components/creator/article-editor/ArticleEditorHeader';
import {
  ArticleRevisionHistoryAction,
  ArticleRevisionHistoryDialog,
} from '@/renderer/components/creator/article-editor/ArticleRevisionHistoryDialog';
import { articleEditorMedia } from '@/renderer/components/creator/article-editor/articleEditorSnapshot';
import { ArticleEditorDocument } from '@/renderer/components/creator/article-editor/ArticleEditorDocument';
import type { useArticleComments } from '@/renderer/components/creator/article-editor/useArticleComments';
import {
  articleEditorSessionConflicted,
  articleEditorSessionDirty,
  articleEditorSessionFailed,
  articleEditorSessionSaving,
  selectArticleEditorDocumentVersion,
  selectArticleEditorMedia,
  selectArticleEditorMediaBindings,
  selectArticleEditorTitle,
} from '@/renderer/components/creator/article-editor/articleEditorSession';

/** Other views read the saved revision and never replace the active session's persistence handle. */
function OutlineSavedDocument({ article }: { article: ArticleDto }) {
  const { messages } = useI18n();
  const bindings = useMemo(
    () =>
      article.content.mediaBindings.map((binding) => ({
        ...binding,
        kind: 'IMAGE' as const,
        timestampMs: null,
        endTimestampMs: null,
        posterAssetId: null,
      })),
    [article.content.mediaBindings],
  );
  const media = useMemo(() => articleEditorMedia(article), [article]);
  return (
    <ContentBlockEditor
      outlineMode
      embedded
      readOnly
      sessionIdentity={`${article.id}:${article.revisionId}:saved`}
      contentSource={{ kind: 'ARTICLE', id: article.id, revisionId: article.revisionId }}
      document={article.content.document}
      markdown={article.content.markdown}
      media={media}
      mediaBindings={bindings}
      ariaLabel={messages.referenceOutline.outline}
      labels={messages.videoDocuments.editor.richText}
      onChange={() => undefined}
      onImageImported={() => undefined}
      onImageImportError={() => undefined}
      onSave={() => undefined}
    />
  );
}

export function OutlineArticleEditor({
  article,
  spaceId,
  articleComments,
  editable,
  requestEditOwnership,
  onExport,
  notify,
  zh,
}: {
  article: ArticleDto;
  spaceId: string;
  articleComments: ReturnType<typeof useArticleComments>;
  editable: boolean;
  requestEditOwnership(): void;
  onExport(): Promise<void>;
  notify(message: string): void;
  zh: boolean;
}) {
  const { messages } = useI18n();
  const copy = messages.referenceOutline,
    labels = messages.creator.manuscriptEditor;
  const session = useArticleEditorSession();
  const title = useArticleEditorSessionSelector(selectArticleEditorTitle);
  const media = useArticleEditorSessionSelector(selectArticleEditorMedia);
  const bindings = useArticleEditorSessionSelector(selectArticleEditorMediaBindings);
  useArticleEditorSessionSelector(selectArticleEditorDocumentVersion);
  const conflict = useArticleEditorSessionSelector(articleEditorSessionConflicted);
  const dirty = useArticleEditorSessionSelector(articleEditorSessionDirty);
  const failed = useArticleEditorSessionSelector(articleEditorSessionFailed);
  const saving = useArticleEditorSessionSelector(articleEditorSessionSaving);
  return (
    <div data-article-editor data-outline-editor className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <TooltipProvider delayDuration={300}>
        <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
          <ListTree className="size-4 shrink-0" />
          <span className="text-xs text-muted-foreground">{copy.outline}</span>
          <Input
            className="min-w-20 flex-1 border-0 bg-transparent px-1 font-semibold shadow-none"
            value={editable ? title : article.content.title}
            maxLength={200}
            readOnly={!editable}
            aria-label={copy.outline}
            placeholder={copy.untitledOutline}
            onChange={(event) => session.titleChanged(event.target.value)}
            onBlur={() => {
              if (editable) void session.flush('auto');
            }}
          />
          <ArticleSaveStatus
            conflict={conflict}
            dirty={dirty}
            failed={failed}
            saving={saving}
            onRetry={() => void session.retry()}
          />
          <CreationWorkNavigation />
          {editable ? (
            <ArticleRevisionHistoryAction article={article} notify={notify} zh={zh} />
          ) : (
            <ArticleRevisionHistoryDialog articleId={article.id} currentRevisionId={article.revisionId} zh={zh} />
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={copy.export}
            title={copy.export}
            onClick={() => void onExport()}
          >
            <Download className="size-4" />
          </Button>
          <CopyAgentLinkButton
            target={{ spaceId, target: 'article', entityId: article.id }}
            beforeCopy={editable ? () => session.flush('manual') : undefined}
            notify={notify}
          />
          {!editable && (
            <Button size="sm" variant="outline" onClick={requestEditOwnership}>
              {labels.editThisView}
            </Button>
          )}
        </header>
        {conflict && (
          <div role="status" className="flex items-center justify-between gap-2 border-b px-4 py-2 text-sm">
            <span>{labels.newerRevision}</span>
            <Button size="sm" variant="outline" onClick={() => void session.acceptExternalArticle()}>
              {labels.keepDraftAndLoad}
            </Button>
          </div>
        )}
        {editable ? (
          <ArticleEditorDocument
            outlineMode
            articleId={article.id}
            editorSessionIdentity={session.getEditorSessionIdentity()}
            document={session.getDocumentProjection()}
            initialMarkdown={session.getMarkdownProjection()}
            initialElements={session.getArticleElementsProjection()}
            comments={articleComments.comments}
            commentMutationBusy={articleComments.busy}
            onCommentCreate={articleComments.create}
            onCommentDelete={(id) => articleComments.mutateExisting('DELETE', id)}
            onCommentReply={(id, body) => articleComments.mutateExisting('ADD_REPLY', id, { body })}
            onCommentStatusChange={(id, status) => articleComments.mutateExisting('SET_STATUS', id, { status })}
            onCommentUpdateBody={(id, body) => articleComments.mutateExisting('UPDATE_BODY', id, { body })}
            attachmentsPanel={null}
            attachmentCount={0}
            layoutToolbarRoot={null}
            splitOpen={false}
            onSplitClose={() => undefined}
            onSplitToggle={() => undefined}
            title={title}
            onTitleChange={session.titleChanged}
            zh={zh}
            media={media}
            mediaBindings={bindings}
            labels={messages.videoDocuments.editor.richText}
            onEditorHandleChange={session.registerEditor}
            onMarkdownChange={session.documentChanged}
            onImageImported={session.imageImported}
            onImageImportError={() => notify(messages.contentEditor.imageImportFailed)}
            onPersist={(mode) => void session.flush(mode)}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-6">
            <OutlineSavedDocument article={article} />
          </div>
        )}
      </TooltipProvider>
    </div>
  );
}
