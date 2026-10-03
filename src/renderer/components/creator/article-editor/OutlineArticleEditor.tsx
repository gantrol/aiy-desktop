import type { ReactNode } from 'react';
import { Download, ListTree } from 'lucide-react';
import type { ArticleDto } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import { CreationWorkNavigation } from '@/renderer/components/creator/CreationWorkNavigation';
import { outlineViewPreferenceKey } from '@/renderer/features/content-editor/outlineViewPreferences';
import { CopyAgentLinkButton } from '@/renderer/features/content-editor/CopyAgentLinkButton';
import { ContentBacklinksButton } from '@/renderer/features/content-editor/ContentBacklinksButton';
import { OutlineContentLinkHost } from '@/renderer/features/content-editor/OutlineContentLinkHost';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  useArticleEditorSession,
  useArticleEditorSessionSelector,
} from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { ArticleSaveStatus } from '@/renderer/components/creator/article-editor/ArticleEditorHeader';
import { ArticleRevisionHistoryAction } from '@/renderer/components/creator/article-editor/ArticleRevisionHistoryDialog';
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

export function OutlineArticleEditor(props: Parameters<typeof OutlineArticleWorkspace>[0]) {
  return (
    <OutlineContentLinkHost.Provider
      value={{
        spaceId: props.spaceId,
        articleId: props.article.id,
        albumId: props.article.albumId,
        notify: props.notify,
      }}
    >
      <OutlineArticleWorkspace {...props} />
    </OutlineContentLinkHost.Provider>
  );
}

function OutlineArticleWorkspace({
  article,
  spaceId,
  articleComments,
  titleMetadata,
  onExport,
  notify,
  zh,
}: {
  article: ArticleDto;
  spaceId: string;
  articleComments: ReturnType<typeof useArticleComments>;
  titleMetadata?: ReactNode;
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
          <span className="min-w-0 flex-1 truncate font-semibold">{title || copy.untitledOutline}</span>
          <ArticleSaveStatus
            conflict={conflict}
            dirty={dirty}
            failed={failed}
            saving={saving}
            onRetry={() => void session.retry()}
          />
          <CreationWorkNavigation />
          <ContentBacklinksButton spaceId={spaceId} articleId={article.id} beforeOpen={() => session.flush('manual')} />
          <ArticleRevisionHistoryAction spaceId={spaceId} article={article} notify={notify} zh={zh} />
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
            beforeCopy={() => session.flush('manual')}
            notify={notify}
          />
        </header>
        {conflict && (
          <div role="status" className="flex items-center justify-between gap-2 border-b px-4 py-2 text-sm">
            <span>{labels.newerRevision}</span>
            <Button size="sm" variant="outline" onClick={() => void session.acceptExternalArticle()}>
              {labels.keepDraftAndLoad}
            </Button>
          </div>
        )}
        <ArticleEditorDocument
          outlineMode
          outlinePreferenceKey={outlineViewPreferenceKey(spaceId, article.id)}
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
          titleMetadata={titleMetadata}
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
      </TooltipProvider>
    </div>
  );
}
