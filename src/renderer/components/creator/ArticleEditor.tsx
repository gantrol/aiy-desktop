import {
  ArticleAttachments,
  ArticleAttachmentsInput,
  useArticleAttachments,
} from '@/renderer/components/creator/article-editor/ArticleAttachments';
import { LoaderCircleIcon, PencilIcon, SlidersHorizontalIcon, TextCursorInputIcon } from 'lucide-react';
import { useRef, useState } from 'react';
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
import { CurrentArticleReference } from '@/renderer/components/creator/article-editor/ArticleEditorComparison';
import { ArticleWechatCopyAction } from '@/renderer/components/creator/article-editor/ArticleWechatCopyAction';
import {
  ArticleRevisionHistoryAction,
  ArticleRevisionHistoryDialog,
} from '@/renderer/components/creator/article-editor/ArticleRevisionHistoryDialog';
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
  ArticleHeaderIconButton,
  ArticleSaveStatus,
  SuggestedArticleTitle,
} from '@/renderer/components/creator/article-editor/ArticleEditorHeader';
import {
  CreationRelationsSheet,
  type CreationRelationItem,
} from '@/renderer/components/creator/CreationRelationsSheet';
import { TooltipProvider } from '@/renderer/components/ui/tooltip';
import { useWorkspaceArticleEditorState } from '@/renderer/components/workspace/WorkspaceArticleEditorStateProvider';
import { Button } from '@/renderer/components/ui/button';
import { useArticleComments } from '@/renderer/components/creator/article-editor/useArticleComments';
import { useArticleCheck } from '@/renderer/components/creator/article-editor/useArticleCheck';
import { CreationWorkNavigation } from '@/renderer/components/creator/CreationWorkNavigation';
import { OutlineArticleEditor } from '@/renderer/components/creator/article-editor/OutlineArticleEditor';
import { CopyAgentLinkButton } from '@/renderer/features/content-editor/CopyAgentLinkButton';
import { type ArticleCoverRatio } from '@/shared/article-covers';
import { ArticleCoverWorkspaceProvider } from '@/renderer/components/creator/article-editor/ArticleCoverWorkspace';
import { noteFileCapture } from '@/renderer/features/desktop-petals/note-file-capture';

interface Props {
  article: ArticleDto;
  projectCoverAssets?: readonly AssetDto[];
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
  onEditCreationInput(articleId: string): Promise<unknown>;
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
  const [generatingHeader, setGeneratingHeader] = useState(false);
  const headerRequest = useRef(false);
  const [generatingIllustration, setGeneratingIllustration] = useState(false);
  const defaultIllustrationPreset = canvasPresets.find((preset) => preset.stableKey === 'landscape_4_3');

  async function generateHeader(ratio?: ArticleCoverRatio) {
    if (headerRequest.current) return;
    headerRequest.current = true;
    setGeneratingHeader(true);
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
      setGeneratingHeader(false);
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
    generatingHeader,
    generatingIllustration,
  };
}

function ReadOnlyArticleEditor({
  article,
  spaceId,
  notify,
  media,
  mediaBindings,
  requestEditOwnership,
  session,
  title,
  zh,
}: {
  article: ArticleDto;
  spaceId: string;
  notify(message: string): void;
  media: ReturnType<typeof selectArticleEditorMedia>;
  mediaBindings: ArticleContentInput['mediaBindings'];
  requestEditOwnership(): void;
  session: ReturnType<typeof useArticleEditorSession>;
  title: string;
  zh: boolean;
}) {
  const labels = useI18n().messages.creator.manuscriptEditor;
  return (
    <div data-article-editor className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <TooltipProvider delayDuration={300}>
        <header className="flex min-h-14 shrink-0 items-center gap-2 border-b px-4 py-2">
          <span className="min-w-0 flex-1 truncate font-semibold">{title || labels.untitled}</span>
          <CreationWorkNavigation />
          <CopyAgentLinkButton target={{ spaceId, target: 'article', entityId: article.id }} notify={notify} />
          <ArticleRevisionHistoryDialog articleId={article.id} currentRevisionId={article.revisionId} zh={zh} />
          <Button type="button" variant="outline" size="sm" onClick={requestEditOwnership}>
            <PencilIcon className="size-3.5" />
            {labels.editThisView}
          </Button>
        </header>
      </TooltipProvider>
      <CurrentArticleReference
        articleId={article.id}
        elements={session.getArticleElementsProjection()}
        media={media}
        mediaBindings={mediaBindings}
        title={title}
        trackPosition
      />
    </div>
  );
}

function ArticleCreationInputAction({
  articleId,
  open,
  notify,
}: {
  articleId: string;
  open(id: string): Promise<unknown>;
  notify(message: string): void;
}) {
  const session = useArticleEditorSession();
  const copy = useI18n().messages.creator.manuscriptEditor;
  return (
    <ArticleHeaderIconButton
      label={copy.editCreationInput}
      variant="ghost"
      onClick={() =>
        void (async () => {
          if (await session.flush('manual')) await open(articleId);
        })().catch((reason) => notify(String(reason)))
      }
    >
      <SlidersHorizontalIcon className="size-4" />
    </ArticleHeaderIconButton>
  );
}

function ArticleTitleSuggestionAction({
  disabled,
  suggesting,
  onSuggest,
}: {
  disabled: boolean;
  suggesting: boolean;
  onSuggest(): void;
}) {
  const label = useI18n().messages.creator.manuscriptEditor.aiTitle;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={onSuggest}
    >
      {suggesting ? <LoaderCircleIcon className="size-4 animate-spin" /> : <TextCursorInputIcon className="size-4" />}
    </Button>
  );
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
    <CopyAgentLinkButton
      target={{ spaceId, target: 'article', entityId: article.id }}
      beforeCopy={() => session.flush('manual')}
      notify={notify}
    />
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
  onEditCreationInput,
  onSaved,
  onOpenRelation,
  notify,
}: Props) {
  const zh = locale === 'zh';
  const { messages } = useI18n();
  const session = useArticleEditorSession();
  const { editable, requestEditOwnership } = useWorkspaceArticleEditorState(article.id);
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
  const [suggesting, setSuggesting] = useState(false);
  const [suggestedTitle, setSuggestedTitle] = useState<string | null>(null);
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
  const { generateHeader, generateIllustration, generatingHeader, generatingIllustration } = useArticleVisualGeneration(
    {
      canvasPresets,
      notify,
      onGenerateHeader,
      onGenerateIllustration,
      session,
    },
  );

  if (article.content.editorMode === 'OUTLINE') {
    return (
      <OutlineArticleEditor
        article={article}
        spaceId={spaceId}
        articleComments={articleComments}
        editable={editable}
        requestEditOwnership={requestEditOwnership}
        onExport={exportMarkdown}
        notify={notify}
        zh={zh}
      />
    );
  }

  if (!editable) {
    return (
      <ReadOnlyArticleEditor
        article={article}
        spaceId={spaceId}
        notify={notify}
        media={media}
        mediaBindings={mediaBindings}
        requestEditOwnership={requestEditOwnership}
        session={session}
        title={title}
        zh={zh}
      />
    );
  }

  async function suggestTitle() {
    const content = session.captureSnapshot();
    const prompt = content.markdown.trim();
    if (!prompt || suggesting) return;
    setSuggesting(true);
    try {
      const result = await window.desktopApi.codexSuggestTitles({
        prompt: prompt.slice(0, 30_000),
        title: content.title,
        mode: content.title.trim() ? 'regenerate' : 'fill',
      });
      setSuggestedTitle(result.title.trim() || null);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSuggesting(false);
    }
  }

  return (
    <div
      data-article-editor
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
      {...noteFileCapture(attachments.importFiles)}
    >
      <TooltipProvider delayDuration={300}>
        <header className="flex min-h-14 shrink-0 items-center gap-2 border-b px-4 py-2">
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
          <div className="flex shrink-0 items-center gap-1">
            {article.content.creationInput && (
              <ArticleCreationInputAction articleId={article.id} open={onEditCreationInput} notify={notify} />
            )}
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
            <ArticleRevisionHistoryAction article={article} notify={notify} zh={zh} />
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

      {suggestedTitle && (
        <SuggestedArticleTitle
          title={suggestedTitle}
          onApply={() => {
            session.titleChanged(suggestedTitle);
            setSuggestedTitle(null);
          }}
          onDismiss={() => setSuggestedTitle(null)}
        />
      )}

      <ArticleAttachmentsInput attachments={attachments} />

      <ArticleCoverWorkspaceProvider
        projectAssets={projectCoverAssets}
        generating={generatingHeader}
        canGenerate={hasBody}
        onGenerate={generateHeader}
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
          titleAccessory={
            <ArticleTitleSuggestionAction
              disabled={!hasBody || suggesting}
              suggesting={suggesting}
              onSuggest={() => void suggestTitle()}
            />
          }
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
          onTitleChange={(nextTitle) => {
            setSuggestedTitle(null);
            session.titleChanged(nextTitle);
          }}
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
  const { article, locale, notify, onSave, onSaved, spaceId } = props;
  return (
    <ArticleEditorSessionProvider
      key={`${spaceId}:${article.id}`}
      article={article}
      notify={notify}
      onSave={onSave}
      onSaved={onSaved}
      spaceId={spaceId}
      zh={locale === 'zh'}
    >
      <ArticleEditorWorkspace {...props} />
    </ArticleEditorSessionProvider>
  );
}
