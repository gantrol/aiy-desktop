import { ContentCommentsPanel } from '@/renderer/features/content-editor/ContentCommentsPanel';
import { ArticleEditorOutline } from '@/renderer/components/creator/article-editor/ArticleEditorOutline';
import { ArticleEditorPane } from '@/renderer/components/creator/article-editor/ArticleEditorPane';
import { ArticleEditorSidebar } from '@/renderer/components/creator/article-editor/ArticleEditorSidebar';
import { ArticleEditorSplit } from '@/renderer/components/creator/article-editor/ArticleEditorSplit';
import type { ArticleSaveMode } from '@/renderer/components/creator/article-editor/articleEditorSession';
import type { ArticleEditorOutlineCursorRequest } from '@/renderer/components/creator/article-editor/useArticleEditorOutlineNavigation';
import type { ArticleEditorSidebarController } from '@/renderer/components/creator/article-editor/useArticleEditorSidebar';
import { ArticleMediaPanel } from '@/renderer/components/creator/article-editor/ArticleMediaPanel';
import type { ArticleUnplacedImage } from '@/renderer/components/creator/article-editor/useArticleEditorMedia';
import type { ArticleImagePlacement } from '@/renderer/features/video-documents/articleImageOperations';
import {
  VideoDocumentWysiwygEditor,
  type VideoDocumentArticleElementControls,
  type VideoDocumentEditorImageImport,
  type VideoDocumentWysiwygEditorHandle,
} from '@/renderer/features/video-documents/VideoDocumentWysiwygEditor';
import type { VideoDocumentArticleHeading } from '@/renderer/features/video-documents/useVideoDocumentArticleOutline';
import type { VideoDocumentArticleElementsChangeReason } from '@/renderer/features/video-documents/videoDocumentEditorPublication';
import { useI18n } from '@/renderer/i18n/useI18n';
import type {
  ArticleCommentDto,
  ArticleCommentStatus,
  ArticleEditorLocationDto,
  ArticleElementPlacementInput,
  VideoDocumentMediaBinding,
  VideoDocumentRevisionMediaDto,
} from '@/shared/contracts';
import type { BlockDocument } from '@/shared/contracts/block-document';
import type { ComponentProps, ReactNode, RefObject } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { articleTitleClassName } from '@/renderer/lib/articleTypography';
import { MessageSquareIcon, XIcon } from 'lucide-react';
import { useArticleEditorSession } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { ContentWorkspace, ContentWorkspacePanels } from '@/renderer/features/content-editor/ContentWorkspacePanels';
import { useArticleReferenceHeadings } from '@/renderer/components/creator/article-editor/useArticleReferenceHeadings';

function firstArticleLocation(elements: readonly ArticleElementPlacementInput[]) {
  const first = elements[0];
  return first ? { elementId: first.elementId, relativeOffset: 0, blockIndex: first.blockIndex } : null;
}

function ArticleDocumentSidebar({
  comments,
  commentMutationBusy,
  controller,
  filesPanel,
  fileCount,
  mediaPanel,
  mediaCount,
  cursorRequest,
  hoveredCommentId,
  outlineItems,
  scrollRootRef,
  selectedCommentId,
  onCommentHover,
  onCommentSelect,
  onCommentStatusChange,
  onHeadingNavigate,
  onTopNavigate,
}: {
  comments: readonly ArticleCommentDto[];
  commentMutationBusy: boolean;
  controller: ArticleEditorSidebarController;
  filesPanel: ReactNode;
  fileCount: number;
  mediaPanel: ReactNode;
  mediaCount: number;
  cursorRequest: ArticleEditorOutlineCursorRequest;
  hoveredCommentId: string | null;
  outlineItems: readonly VideoDocumentArticleHeading[];
  scrollRootRef: RefObject<HTMLDivElement | null>;
  selectedCommentId: string | null;
  onCommentHover(commentId: string | null): void;
  onCommentSelect(commentId: string): void;
  onCommentStatusChange(commentId: string, status: ArticleCommentStatus): void;
  onHeadingNavigate(sourceIndex: number): void;
  onTopNavigate(): void;
}) {
  const displayedHeadings = useArticleReferenceHeadings(outlineItems, scrollRootRef);
  const cursorId = cursorRequest.index === null ? undefined : outlineItems[cursorRequest.index]?.id;
  const displayedCursor = cursorId ? displayedHeadings.findIndex((item) => item.id === cursorId) : -1;
  return (
    <ArticleEditorSidebar
      commentCount={comments.filter((comment) => comment.status === 'OPEN').length}
      controller={controller}
      files={filesPanel}
      fileCount={fileCount}
      media={mediaPanel}
      mediaCount={mediaCount}
      outlineAvailable={displayedHeadings.length > 0}
      comments={
        <ContentCommentsPanel
          busy={commentMutationBusy}
          comments={comments}
          hoveredId={hoveredCommentId}
          selectedId={selectedCommentId}
          onHover={onCommentHover}
          onSelect={onCommentSelect}
          onStatusChange={onCommentStatusChange}
        />
      }
      outline={
        <ArticleEditorOutline
          cursorRequest={{ ...cursorRequest, index: displayedCursor < 0 ? null : displayedCursor }}
          depthLimit={controller.preferences.depthLimit}
          followCursor={controller.preferences.followCursor}
          items={displayedHeadings}
          scrollRootRef={scrollRootRef}
          onDepthLimitChange={controller.setDepthLimit}
          onFollowCursorChange={controller.setFollowCursor}
          onHeadingNavigate={(index) => {
            const localIndex = outlineItems.findIndex((item) => item.id === displayedHeadings[index]?.id);
            if (localIndex >= 0) onHeadingNavigate(localIndex);
          }}
          onTopNavigate={onTopNavigate}
        />
      }
    />
  );
}

interface ArticleEditorDocumentPaneProps {
  children: ReactNode;
  comments: readonly ArticleCommentDto[];
  commentMutationBusy: boolean;
  controller: ArticleEditorSidebarController;
  filesPanel: ReactNode;
  fileCount: number;
  mediaPanel: ReactNode;
  mediaCount: number;
  cursorRequest: ArticleEditorOutlineCursorRequest;
  elements: readonly ArticleElementPlacementInput[];
  openCommentHoverId: string | null;
  outlineItems: readonly VideoDocumentArticleHeading[];
  scrollRootRef: RefObject<HTMLDivElement | null>;
  selectedCommentId: string | null;
  title: string;
  titleMetadata?: ReactNode;
  zh: boolean;
  onArticleNavigationLocation(location: ArticleEditorLocationDto): void;
  onClose?(): void;
  onCommentHover(commentId: string | null): void;
  onCommentSelect(commentId: string): void;
  onCommentStatusChange(commentId: string, status: ArticleCommentStatus): void;
  onHeadingNavigate(sourceIndex: number): void;
  onPersist(mode: ArticleSaveMode): void;
  onTitleChange(title: string): void;
}

function ArticleEditorDocumentPane({
  children,
  comments,
  commentMutationBusy,
  controller,
  filesPanel,
  fileCount,
  mediaPanel,
  mediaCount,
  cursorRequest,
  elements,
  openCommentHoverId,
  outlineItems,
  scrollRootRef,
  selectedCommentId,
  title,
  titleMetadata,
  zh,
  onArticleNavigationLocation,
  onClose,
  onCommentHover,
  onCommentSelect,
  onCommentStatusChange,
  onHeadingNavigate,
  onPersist,
  onTitleChange,
}: ArticleEditorDocumentPaneProps) {
  const copy = useI18n().messages.contentEditor;
  return (
    <ArticleEditorPane
      documentWidth={controller.preferences.documentWidth}
      scrollRootRef={scrollRootRef}
      title={title}
      titleMetadata={titleMetadata}
      titleAccessory={
        <div className="flex shrink-0 items-center gap-1">
          {onClose && (
            <Button variant="ghost" size="icon-sm" aria-label={copy.closePane} title={copy.closePane} onClick={onClose}>
              <XIcon className="size-4" />
            </Button>
          )}
        </div>
      }
      sidePanel={
        <ArticleDocumentSidebar
          filesPanel={filesPanel}
          fileCount={fileCount}
          mediaPanel={mediaPanel}
          mediaCount={mediaCount}
          comments={comments}
          commentMutationBusy={commentMutationBusy}
          controller={controller}
          cursorRequest={cursorRequest}
          hoveredCommentId={openCommentHoverId}
          outlineItems={outlineItems}
          scrollRootRef={scrollRootRef}
          selectedCommentId={selectedCommentId}
          onCommentHover={onCommentHover}
          onCommentSelect={onCommentSelect}
          onCommentStatusChange={onCommentStatusChange}
          onHeadingNavigate={onHeadingNavigate}
          onTopNavigate={() => {
            const location = firstArticleLocation(elements);
            if (location) onArticleNavigationLocation(location);
          }}
        />
      }
      zh={zh}
      onPersist={() => onPersist('auto')}
      onTitleChange={onTitleChange}
    >
      {children}
    </ArticleEditorPane>
  );
}

interface Props {
  outlineMode?: boolean;
  outlinePreferenceKey?: string;
  attachmentsPanel: ReactNode;
  attachmentCount: number;
  articleElementControls: VideoDocumentArticleElementControls;
  comments: readonly ArticleCommentDto[];
  commentMutationBusy: boolean;
  cursorRequest: ArticleEditorOutlineCursorRequest;
  editorMediaBindings: VideoDocumentMediaBinding[];
  editorSessionIdentity: string;
  elements: readonly ArticleElementPlacementInput[];
  generatingIllustration: boolean;
  initialElements: readonly ArticleElementPlacementInput[];
  initialMarkdown: string;
  document?: BlockDocument;
  labels: ComponentProps<typeof VideoDocumentWysiwygEditor>['labels'];
  leftPaneRootRef: RefObject<HTMLDivElement | null>;
  leftSidebar: ArticleEditorSidebarController;
  media: readonly VideoDocumentRevisionMediaDto[];
  images: readonly ArticleImagePlacement[];
  unplaced: readonly ArticleUnplacedImage[];
  openCommentHoverId: string | null;
  outlineItems: readonly VideoDocumentArticleHeading[];
  rightPaneRootRef: RefObject<HTMLDivElement | null>;
  rightSidebar: ArticleEditorSidebarController;
  scrollRootRef: RefObject<HTMLDivElement | null>;
  secondaryChromeRoot: HTMLDivElement | null;
  secondaryEditorRoot: HTMLDivElement | null;
  secondaryScrollRootRef: RefObject<HTMLDivElement | null>;
  selectedCommentId: string | null;
  splitOpen: boolean;
  title: string;
  titleMetadata?: ReactNode;
  zh: boolean;
  onActiveHeadingChange(index: number | null): void;
  onArticleEditLocation(location: ArticleEditorLocationDto): void;
  onArticleElementsChange(
    elements: readonly ArticleElementPlacementInput[],
    reason: VideoDocumentArticleElementsChangeReason,
  ): void;
  onArticleLocationChange(location: ArticleEditorLocationDto): void;
  onArticleNavigationLocation(location: ArticleEditorLocationDto): void;
  onClose(side: 'LEFT' | 'RIGHT'): void;
  onCommentHover(commentId: string | null): void;
  onCommentSelect(commentId: string): void;
  onCommentStatusChange(commentId: string, status: ArticleCommentStatus): void;
  onHeadingNavigate(sourceIndex: number): void;
  onEditorHandleChange(
    handle: VideoDocumentWysiwygEditorHandle | null,
    previousHandle: VideoDocumentWysiwygEditorHandle | null,
  ): void;
  onImageImportError(): void;
  onImageImported(result: VideoDocumentEditorImageImport): void;
  onImageRemove(elementId: string): boolean;
  onImageMove(elementId: string, targetId: string): boolean;
  onImageLocate(elementId: string): void;
  onImageUndo(): boolean;
  onImageRedo(): boolean;
  onIllustrationRequest?(selectedText: string | null): void;
  onMarkdownChange(markdown: string): void;
  onPersist(mode: ArticleSaveMode): void;
  onSecondaryChromeRootChange(node: HTMLDivElement | null): void;
  onSecondaryEditorRootChange(node: HTMLDivElement | null): void;
  onTitleChange(title: string): void;
}

export function ArticleEditorDocumentPanes({
  outlineMode,
  outlinePreferenceKey,
  attachmentsPanel,
  attachmentCount,
  articleElementControls,
  comments,
  commentMutationBusy,
  cursorRequest,
  editorMediaBindings,
  editorSessionIdentity,
  elements,
  generatingIllustration,
  initialElements,
  initialMarkdown,
  document,
  labels,
  leftPaneRootRef,
  leftSidebar,
  media,
  images,
  unplaced,
  openCommentHoverId,
  outlineItems,
  rightPaneRootRef,
  rightSidebar,
  scrollRootRef,
  secondaryChromeRoot,
  secondaryEditorRoot,
  secondaryScrollRootRef,
  selectedCommentId,
  splitOpen,
  title,
  titleMetadata,
  zh,
  onActiveHeadingChange,
  onArticleEditLocation,
  onArticleElementsChange,
  onArticleLocationChange,
  onArticleNavigationLocation,
  onClose,
  onCommentHover,
  onCommentSelect,
  onCommentStatusChange,
  onHeadingNavigate,
  onEditorHandleChange,
  onImageImportError,
  onImageImported,
  onImageRemove,
  onImageMove,
  onImageLocate,
  onImageUndo,
  onImageRedo,
  onIllustrationRequest,
  onMarkdownChange,
  onPersist,
  onSecondaryChromeRootChange,
  onSecondaryEditorRootChange,
  onTitleChange,
}: Props) {
  const session = useArticleEditorSession();
  const copy = useI18n().messages.contentEditor;
  const primaryEditor = (
    <VideoDocumentWysiwygEditor
      outlineMode={outlineMode}
      outlinePreferenceKey={outlinePreferenceKey}
      embedded={outlineMode}
      contentSource={{ kind: 'ARTICLE', id: session.capturePersistedArticle().id }}
      onTransferSaved={session.receiveTransferredArticle}
      beforeReferenceCapture={async () => {
        if (!(await session.flush('manual'))) return null;
        const saved = session.capturePersistedArticle();
        return { kind: 'ARTICLE', id: saved.id, revisionId: saved.revisionId };
      }}
      markdown={initialMarkdown}
      document={document}
      sessionIdentity={editorSessionIdentity}
      documentViews={session.documentViews}
      articleElements={initialElements}
      articleElementControls={articleElementControls}
      mediaBindings={editorMediaBindings}
      media={media}
      secondaryEditorRoot={secondaryEditorRoot}
      secondaryChromeRoot={secondaryChromeRoot}
      secondaryAriaLabel={copy.bodyRight}
      ariaLabel={splitOpen ? copy.bodyLeft : copy.body}
      labels={labels}
      onActiveHeadingChange={onActiveHeadingChange}
      onArticleElementsChange={onArticleElementsChange}
      onArticleLocationChange={onArticleLocationChange}
      onArticleEditLocation={onArticleEditLocation}
      onArticleNavigationLocation={onArticleNavigationLocation}
      onEditorHandleChange={onEditorHandleChange}
      onChange={onMarkdownChange}
      onImageImported={onImageImported}
      onImageImportError={onImageImportError}
      illustrationLabel={
        onIllustrationRequest ? (generatingIllustration ? copy.openingMedia : copy.generate) : undefined
      }
      onIllustrationRequest={onIllustrationRequest}
      onSave={() => onPersist('manual')}
    />
  );
  if (outlineMode) {
    return (
      <div ref={leftPaneRootRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ContentWorkspace>
          <div ref={scrollRootRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-3 sm:px-6">
            <div className="mb-7">
              <Input
                value={title}
                maxLength={200}
                aria-label={copy.title}
                placeholder={copy.untitledArticle}
                className={`${articleTitleClassName} h-auto border-0 px-0 shadow-none`}
                onChange={(event) => onTitleChange(event.target.value)}
                onBlur={() => onPersist('auto')}
              />
              {titleMetadata && <div className="mt-2">{titleMetadata}</div>}
            </div>
            {primaryEditor}
          </div>
          <ContentWorkspacePanels
            preferenceKey="outline-comments"
            active="COMMENTS"
            open={leftSidebar.panelOpen('COMMENTS')}
            onActiveChange={() => leftSidebar.showPanel('COMMENTS')}
            onOpenChange={(open) => leftSidebar.setPanelOpen('COMMENTS', open)}
            tabs={[
              {
                id: 'COMMENTS',
                icon: MessageSquareIcon,
                label: copy.comments,
                count: comments.filter((comment) => comment.status === 'OPEN').length,
                content: (
                  <ContentCommentsPanel
                    busy={commentMutationBusy}
                    comments={comments}
                    hoveredId={openCommentHoverId}
                    selectedId={selectedCommentId}
                    onHover={onCommentHover}
                    onSelect={onCommentSelect}
                    onStatusChange={onCommentStatusChange}
                  />
                ),
              },
            ]}
          />
        </ContentWorkspace>
      </div>
    );
  }
  const mediaPanel = (
    <ArticleMediaPanel
      images={images}
      unplaced={unplaced}
      media={media}
      onMove={onImageMove}
      onRemove={onImageRemove}
      onLocate={onImageLocate}
      onUndo={onImageUndo}
      onRedo={onImageRedo}
    />
  );
  const mediaCount = images.length + unplaced.length;
  return (
    <ArticleEditorSplit
      left={
        <ArticleEditorDocumentPane
          filesPanel={attachmentsPanel}
          fileCount={attachmentCount}
          mediaPanel={mediaPanel}
          mediaCount={mediaCount}
          comments={comments}
          commentMutationBusy={commentMutationBusy}
          controller={leftSidebar}
          cursorRequest={cursorRequest}
          elements={elements}
          openCommentHoverId={openCommentHoverId}
          outlineItems={outlineItems}
          scrollRootRef={scrollRootRef}
          selectedCommentId={selectedCommentId}
          title={title}
          titleMetadata={titleMetadata}
          zh={zh}
          onArticleNavigationLocation={onArticleNavigationLocation}
          onCommentHover={onCommentHover}
          onCommentSelect={onCommentSelect}
          onCommentStatusChange={onCommentStatusChange}
          onHeadingNavigate={onHeadingNavigate}
          onPersist={onPersist}
          onTitleChange={onTitleChange}
          {...(splitOpen ? { onClose: () => onClose('LEFT') } : {})}
        >
          {primaryEditor}
        </ArticleEditorDocumentPane>
      }
      leftRef={leftPaneRootRef}
      open={splitOpen}
      right={
        <ArticleEditorDocumentPane
          filesPanel={attachmentsPanel}
          fileCount={attachmentCount}
          mediaPanel={mediaPanel}
          mediaCount={mediaCount}
          comments={comments}
          commentMutationBusy={commentMutationBusy}
          controller={rightSidebar}
          cursorRequest={cursorRequest}
          elements={elements}
          openCommentHoverId={openCommentHoverId}
          outlineItems={outlineItems}
          scrollRootRef={secondaryScrollRootRef}
          selectedCommentId={selectedCommentId}
          title={title}
          zh={zh}
          onArticleNavigationLocation={onArticleNavigationLocation}
          onClose={() => onClose('RIGHT')}
          onCommentHover={onCommentHover}
          onCommentSelect={onCommentSelect}
          onCommentStatusChange={onCommentStatusChange}
          onHeadingNavigate={onHeadingNavigate}
          onPersist={onPersist}
          onTitleChange={onTitleChange}
        >
          <div
            data-slot="video-document-wysiwyg-editor"
            className="group/editor relative min-w-0 w-full border-y bg-surface focus-within:border-selected-border"
          >
            <div ref={onSecondaryChromeRootChange} className="contents" />
            <div
              ref={onSecondaryEditorRootChange}
              className="min-w-0 w-full overflow-hidden [&>.ProseMirror]:min-w-0 [&>.ProseMirror]:w-full [&_.find-and-replace-result]:box-decoration-clone [&_.find-and-replace-result]:rounded-sm [&_.find-and-replace-result]:bg-warning-surface [&_.find-and-replace-result-current]:scroll-mt-24 [&_.find-and-replace-result-current]:ring-1 [&_.find-and-replace-result-current]:ring-inset [&_.find-and-replace-result-current]:ring-warning"
            />
          </div>
        </ArticleEditorDocumentPane>
      }
      rightRef={rightPaneRootRef}
      zh={zh}
    />
  );
}
