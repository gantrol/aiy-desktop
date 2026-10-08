import { OutlineContentLinkHost } from '@/renderer/features/content-editor/OutlineContentLinkHost';
import {
  ArticleAttachments,
  ArticleAttachmentsInput,
  useArticleAttachments,
} from '@/renderer/components/creator/article-editor/ArticleAttachments';
import { ArticleInputHistoryAction } from '@/renderer/components/creator/article-editor/ArticleInputHistoryAction';
import { useRef, useState } from 'react';
import { ArticleTitleMetadata } from '@/renderer/components/creator/article-editor/ArticleTitleMetadata';
import type {
  ArticleContentInput,
  AssetDto,
  ArticleDto,
  ArticleRevisionSaveInput,
  ArticleRevisionSaveResult,
  ArticleWechatCopyOptions,
  CanvasPresetDto,
  ExtensionDto,
  Locale,
} from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ArticleEditorDocument } from '@/renderer/components/creator/article-editor/ArticleEditorDocument';
import { ArticleWechatCopyAction } from '@/renderer/components/creator/article-editor/ArticleWechatCopyAction';
import { ArticleRevisionHistoryAction } from '@/renderer/components/creator/article-editor/ArticleRevisionHistoryDialog';
import { ArticleCheckButton } from '@/renderer/components/creator/article-editor/ArticleCheckButton';
import { ArticleDeliveryAction } from '@/renderer/components/creator/article-editor/ArticleDeliveryAction';
import {
  ArticleEditorSessionProvider,
  useArticleEditorSession,
  useArticleEditorSessionSelector,
} from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import {
  articleEditorSessionConflicted,
  articleEditorSessionDirty,
  articleEditorSessionFailed,
  articleEditorSessionSaving,
  selectArticleEditorDocumentVersion,
  selectArticleEditorHasBody,
  selectArticleEditorMedia,
  selectArticleEditorMediaBindings,
  selectArticleEditorTitle,
} from '@/renderer/components/creator/article-editor/articleEditorSession';
import { PinContentButton } from '@/renderer/features/desktop-petals/PinContentAction';
import {
  ArticleHeaderAiActions,
  ArticleHeaderActions,
  ArticleSaveStatus,
} from '@/renderer/components/creator/article-editor/ArticleEditorHeader';
import {
  CreationRelationsSheet,
  type CreationRelationItem,
} from '@/renderer/components/creator/CreationRelationsSheet';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import { Button } from '@/renderer/components/ui/button';
import { useArticleComments } from '@/renderer/components/creator/article-editor/useArticleComments';
import { useArticleCheck } from '@/renderer/components/creator/article-editor/useArticleCheck';
import { OutlineArticleEditor } from '@/renderer/components/creator/article-editor/OutlineArticleEditor';
import { CopyAgentLinkButton } from '@/renderer/features/content-editor/CopyAgentLinkButton';
import { ContentBacklinksButton } from '@/renderer/features/content-editor/ContentBacklinksButton';
import { type ArticleCoverRatio } from '@/shared/article-covers';
import { ArticleCoverWorkspaceProvider } from '@/renderer/components/creator/article-editor/ArticleCoverWorkspace';
import type {
  ArticleCoverGeneration,
  ArticleCoverGenerations,
} from '@/renderer/components/creator/article-editor/articleCoverGeneration';
import { noteFileCapture } from '@/renderer/features/desktop-petals/note-file-capture';

interface Props {
  article: ArticleDto;
  projectCoverAssets?: readonly AssetDto[];
  coverGenerations: ArticleCoverGenerations;
  onOpenCoverGeneration(generation: ArticleCoverGeneration): void;
  spaceId: string;
  locale: Locale;
  canvasPresets: CanvasPresetDto[];
  extensions: readonly ExtensionDto[];
  relations: readonly CreationRelationItem[];
  onSave(input: ArticleRevisionSaveInput): Promise<ArticleRevisionSaveResult>;
  onSaved(article: ArticleDto): void;
  onCopyForWechat(options: ArticleWechatCopyOptions): Promise<void>;
  onExport(): Promise<void>;
  onCreateArticle(content: ArticleContentInput, copySourceContent: boolean): Promise<void>;
  onGenerateHeader(article: ArticleDto, content: ArticleContentInput, ratio?: ArticleCoverRatio): Promise<void>;
  onGenerateIllustration(
    article: ArticleDto,
    content: ArticleContentInput,
    selectedText: string,
    preset: CanvasPresetDto,
  ): Promise<void>;
  onConfigureArticleCheck(): void;
  onContinueInput(draftId: string): Promise<boolean>;
  onOpenRelation(item: CreationRelationItem): void;
  notify(message: string): void;
}

function useArticleVisualGeneration({
  canvasPresets,
  notify,
  onGenerateHeader,
  onGenerateIllustration,
  session,
}: {
  canvasPresets: CanvasPresetDto[];
  notify(message: string): void;
  onGenerateHeader(article: ArticleDto, content: ArticleContentInput, ratio?: ArticleCoverRatio): Promise<void>;
  onGenerateIllustration(
    article: ArticleDto,
    content: ArticleContentInput,
    selectedText: string,
    preset: CanvasPresetDto,
  ): Promise<void>;
  session: ReturnType<typeof useArticleEditorSession>;
}) {
  const labels = useI18n().messages.creator.derivedVisual;
  const [openingCoverRatio, setOpeningCoverRatio] = useState<ArticleCoverRatio | 'shared' | null>(null);
  const headerRequest = useRef(false);
  const [generatingIllustration, setGeneratingIllustration] = useState(false);
  const defaultIllustrationPreset = canvasPresets.find((preset) => preset.stableKey === 'landscape_4_3');

  async function generateHeader(ratio?: ArticleCoverRatio) {
    if (headerRequest.current) return;
    headerRequest.current = true;
    setOpeningCoverRatio(ratio ?? 'shared');
    const identity = session.getEditorSessionIdentity();
    try {
      if (!(await session.flush('manual')) || identity !== session.getEditorSessionIdentity()) return;
      const article = session.capturePersistedArticle();
      const content = article.content;
      await onGenerateHeader(article, content, ratio);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      headerRequest.current = false;
      setOpeningCoverRatio(null);
    }
  }

  async function generateIllustration(selectedText: string | null) {
    const selection = selectedText?.trim();
    if (!selection || generatingIllustration) return;
    if (!defaultIllustrationPreset) {
      notify(labels.illustrationCanvasUnavailable);
      return;
    }
    if (!(await session.flush('manual'))) return;
    const article = session.capturePersistedArticle();
    const content = session.captureSnapshot();
    setGeneratingIllustration(true);
    try {
      await onGenerateIllustration(article, content, selection, defaultIllustrationPreset);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setGeneratingIllustration(false);
    }
  }

  return {
    generateHeader,
    generateIllustration,
    generatingHeader: openingCoverRatio !== null,
    openingCoverRatio,
    generatingIllustration,
  };
}

function useArticleExport(
  session: ReturnType<typeof useArticleEditorSession>,
  onExport: Props['onExport'],
  notify: Props['notify'],
) {
  const [exporting, setExporting] = useState(false);
  async function exportMarkdown() {
    if (exporting || !(await session.flush('manual'))) return;
    setExporting(true);
    try {
      await onExport();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setExporting(false);
    }
  }
  return { exporting, exportMarkdown };
}

function ArticleAgentLinkAction({ article, spaceId, notify }: Pick<Props, 'article' | 'spaceId' | 'notify'>) {
  const session = useArticleEditorSession();
  return (
    <>
      <ContentBacklinksButton spaceId={spaceId} articleId={article.id} beforeOpen={() => session.flush('manual')} />
      <CopyAgentLinkButton
        target={{ spaceId, target: 'article', entityId: article.id }}
        beforeCopy={() => session.flush('manual')}
        notify={notify}
      />
    </>
  );
}

function useArticleCreation(
  session: ReturnType<typeof useArticleEditorSession>,
  onCreateArticle: Props['onCreateArticle'],
  notify: Props['notify'],
) {
  const [creatingForm, setCreatingForm] = useState(false);
  async function createArticle(copySourceContent: boolean) {
    if (creatingForm) return;
    if (!(await session.flush('manual'))) return;
    const content = session.captureSnapshot();
    setCreatingForm(true);
    try {
      await onCreateArticle(content, copySourceContent);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCreatingForm(false);
    }
  }
  return { creatingForm, createArticle };
}

function ArticleEditorWorkspace({
  article,
  projectCoverAssets = [],
  coverGenerations,
  onOpenCoverGeneration,
  spaceId,
  locale,
  canvasPresets,
  extensions,
  relations,
  onCopyForWechat,
  onExport,
  onCreateArticle,
  onGenerateHeader,
  onGenerateIllustration,
  onConfigureArticleCheck,
  onContinueInput,
  onSaved,
  onOpenRelation,
  notify,
}: Props) {
  const zh = locale === 'zh';
  const { messages } = useI18n();
  const session = useArticleEditorSession();
  const title = useArticleEditorSessionSelector(selectArticleEditorTitle);
  const mediaBindings = useArticleEditorSessionSelector(selectArticleEditorMediaBindings);
  const media = useArticleEditorSessionSelector(selectArticleEditorMedia);
  const fileCount = useArticleEditorSessionSelector((state) => state.persisted.article.content.files?.length ?? 0);
  useArticleEditorSessionSelector(selectArticleEditorDocumentVersion);
  const hasBody = useArticleEditorSessionSelector(selectArticleEditorHasBody);
  const conflict = useArticleEditorSessionSelector(articleEditorSessionConflicted);
  const dirty = useArticleEditorSessionSelector(articleEditorSessionDirty);
  const saveFailed = useArticleEditorSessionSelector(articleEditorSessionFailed);
  const saving = useArticleEditorSessionSelector(articleEditorSessionSaving);
  const { exporting, exportMarkdown } = useArticleExport(session, onExport, notify);
  const { creatingForm, createArticle } = useArticleCreation(session, onCreateArticle, notify);
  const attachments = useArticleAttachments({ spaceId, onSaved, notify });
  const [relationsOpen, setRelationsOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [layoutToolbarRoot, setLayoutToolbarRoot] = useState<HTMLDivElement | null>(null);
  const articleComments = useArticleComments({ article, session, notify });
  const articleCheck = useArticleCheck({
    locale,
    commentsBusy: articleComments.busy,
    session,
    notify,
    onConfigureProvider: onConfigureArticleCheck,
  });
  const { generateHeader, generateIllustration, generatingHeader, generatingIllustration, openingCoverRatio } =
    useArticleVisualGeneration({
      canvasPresets,
      notify,
      onGenerateHeader,
      onGenerateIllustration,
      session,
    });

  const titleMetadata = (
    <ArticleTitleMetadata
      key={`${spaceId}:${article.id}`}
      spaceId={spaceId}
      articleId={article.id}
      editable
      writeContext={article.writeContext}
      notify={notify}
    />
  );

  const editorMode = useArticleEditorSessionSelector((state) => state.draft.metadata.editorMode);
  const inputHistoryAction = (
    <ArticleInputHistoryAction articleId={article.id} spaceId={spaceId} onContinue={onContinueInput} notify={notify} />
  );
  if (editorMode === 'OUTLINE') {
    return (
      <OutlineArticleEditor
        article={article}
        spaceId={spaceId}
        articleComments={articleComments}
        titleMetadata={titleMetadata}
        inputHistoryAction={inputHistoryAction}
        onExport={exportMarkdown}
        notify={notify}
        zh={zh}
      />
    );
  }

  return (
    <div
      data-article-editor
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
      {...noteFileCapture(attachments.importFiles)}
    >
      <TooltipProvider delayDuration={300}>
        <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            <span className="truncate font-semibold">{title || messages.creator.manuscriptEditor.untitled}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{messages.creator.manuscriptEditor.kind}</span>
            <ArticleSaveStatus
              conflict={conflict}
              dirty={dirty}
              failed={saveFailed}
              saving={saving}
              onRetry={() => void session.retry()}
            />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {inputHistoryAction}
            <PinContentButton
              iconOnly
              source={{ kind: 'ARTICLE', id: article.id }}
              beforePin={() => session.flush('manual')}
              notify={notify}
            />
            <ArticleHeaderAiActions
              checkAction={
                <ArticleCheckButton
                  busy={articleCheck.checking}
                  disabled={!hasBody || articleCheck.checking || articleComments.busy}
                  onClick={() => void articleCheck.run()}
                />
              }
            />
            <ArticleRevisionHistoryAction spaceId={spaceId} article={article} notify={notify} zh={zh} />
            <ArticleDeliveryAction
              articleId={article.id}
              extensions={extensions}
              locale={locale}
              notify={notify}
              spaceId={spaceId}
            />
            <div ref={setLayoutToolbarRoot} className="contents" />
            <ArticleHeaderActions
              copyForAgentAction={<ArticleAgentLinkAction article={article} spaceId={spaceId} notify={notify} />}
              copyForWechatAction={<ArticleWechatCopyAction locale={locale} notify={notify} onCopy={onCopyForWechat} />}
              creatingForm={creatingForm}
              exporting={exporting}
              generatingHeader={generatingHeader}
              hasBody={hasBody}
              relationCount={relations.length}
              onCreateArticle={createArticle}
              onExport={exportMarkdown}
              onGenerateHeader={generateHeader}
              onOpenRelations={() => setRelationsOpen(true)}
            />
          </div>
        </header>
      </TooltipProvider>
      {conflict && (
        <div role="status" className="flex items-center justify-between gap-3 border-b bg-muted px-4 py-2 text-sm">
          <span>{messages.creator.manuscriptEditor.newerRevision}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void session.acceptExternalArticle()}>
            {messages.creator.manuscriptEditor.keepDraftAndLoad}
          </Button>
        </div>
      )}

      <ArticleAttachmentsInput attachments={attachments} />

      <ArticleCoverWorkspaceProvider
        projectAssets={projectCoverAssets}
        openingRatio={openingCoverRatio}
        generations={coverGenerations}
        canGenerate={hasBody}
        onGenerate={generateHeader}
        onOpenGeneration={onOpenCoverGeneration}
      >
        <ArticleEditorDocument
          key={session.getEditorSessionIdentity()}
          attachmentsPanel={<ArticleAttachments spaceId={spaceId} attachments={attachments} />}
          attachmentCount={fileCount}
          articleId={article.id}
          editorSessionIdentity={session.getEditorSessionIdentity()}
          comments={articleComments.comments}
          commentMutationBusy={articleComments.busy || articleCheck.checking}
          initialElements={session.getArticleElementsProjection()}
          generatingIllustration={generatingIllustration}
          initialMarkdown={session.getMarkdownProjection()}
          document={session.getDocumentProjection()}
          labels={messages.videoDocuments.editor.richText}
          media={media}
          mediaBindings={mediaBindings}
          layoutToolbarRoot={layoutToolbarRoot}
          splitOpen={splitOpen}
          title={title}
          titleMetadata={titleMetadata}
          zh={zh}
          onEditorHandleChange={session.registerEditor}
          onCommentCreate={articleComments.create}
          onCommentDelete={(commentId) => articleComments.mutateExisting('DELETE', commentId)}
          onCommentReply={(commentId, body) => articleComments.mutateExisting('ADD_REPLY', commentId, { body })}
          onCommentStatusChange={(commentId, status) =>
            articleComments.mutateExisting('SET_STATUS', commentId, { status })
          }
          onCommentUpdateBody={(commentId, body) => articleComments.mutateExisting('UPDATE_BODY', commentId, { body })}
          onIllustrationRequest={(selectedText) => void generateIllustration(selectedText)}
          onImageImportError={() => notify(messages.contentEditor.imageImportFailed)}
          onImageImported={session.imageImported}
          onMarkdownChange={session.documentChanged}
          onPersist={(mode) => void session.flush(mode)}
          onSplitClose={() => setSplitOpen(false)}
          onSplitToggle={() => setSplitOpen((current) => !current)}
          onTitleChange={session.titleChanged}
        />
      </ArticleCoverWorkspaceProvider>
      <CreationRelationsSheet
        items={relations}
        open={relationsOpen}
        filteredAssetId={null}
        onOpenChange={setRelationsOpen}
        onSelect={onOpenRelation}
      />
    </div>
  );
}

export function ArticleEditor(props: Props) {
  const { article, notify, onSave, onSaved, spaceId } = props;
  return (
    <ArticleEditorSessionProvider
      key={`${spaceId}:${article.id}`}
      article={article}
      notify={notify}
      onSave={onSave}
      onSaved={onSaved}
      spaceId={spaceId}
    >
      <OutlineContentLinkHost.Provider value={{ spaceId, articleId: article.id, albumId: article.albumId, notify }}>
        <ArticleEditorWorkspace {...props} />
      </OutlineContentLinkHost.Provider>
    </ArticleEditorSessionProvider>
  );
}
