import type { ComponentProps, ReactNode, RefObject } from 'react';
import type {
  ArticleCommentDto,
  ArticleCommentStatus,
  ArticleEditorLocationDto,
  ArticleElementPlacementInput,
  VideoDocumentMediaBinding,
  VideoDocumentRevisionMediaDto,
} from '@/shared/contracts';
import { ArticleCommentsPanel } from '@/renderer/components/creator/article-editor/ArticleCommentsPanel';
import { ArticleEditorOutline } from '@/renderer/components/creator/article-editor/ArticleEditorOutline';
import { ArticleEditorPane } from '@/renderer/components/creator/article-editor/ArticleEditorPane';
import {
  ArticleEditorLayoutToolbar,
  ArticleEditorSidebar,
} from '@/renderer/components/creator/article-editor/ArticleEditorSidebar';
import { ArticleEditorSplit } from '@/renderer/components/creator/article-editor/ArticleEditorSplit';
import type { ArticleSaveMode } from '@/renderer/components/creator/article-editor/articleEditorSession';
import type { ArticleEditorOutlineCursorRequest } from '@/renderer/components/creator/article-editor/useArticleEditorOutlineNavigation';
import type { ArticleEditorSidebarController } from '@/renderer/components/creator/article-editor/useArticleEditorSidebar';
import {
  VideoDocumentWysiwygEditor,
  type VideoDocumentArticleElementControls,
  type VideoDocumentEditorImageImport,
  type VideoDocumentWysiwygEditorHandle,
} from '@/renderer/features/video-documents/VideoDocumentWysiwygEditor';
import type { VideoDocumentArticleElementsChangeReason } from '@/renderer/features/video-documents/videoDocumentEditorPublication';
import type { VideoDocumentArticleHeading } from '@/renderer/features/video-documents/useVideoDocumentArticleOutline';

function headingLocation(elements: readonly ArticleElementPlacementInput[], sourceIndex: number) {
  const heading = elements.filter((element) => element.nodeType === 'heading')[sourceIndex];
  return heading ? { elementId: heading.elementId, relativeOffset: 0, blockIndex: heading.blockIndex } : null;
}

function firstArticleLocation(elements: readonly ArticleElementPlacementInput[]) {
  const first = elements[0];
  return first ? { elementId: first.elementId, relativeOffset: 0, blockIndex: first.blockIndex } : null;
}

function illustrationActionLabel(available: boolean, generating: boolean, zh: boolean) {
  if (!available) return undefined;
  if (generating) return zh ? '正在打开配图工作区' : 'Opening illustration workspace';
  return zh ? '生成配图' : 'Generate illustration';
}

function ArticleDocumentSidebar({
  comments,
  commentMutationBusy,
  controller,
  cursorRequest,
  hoveredCommentId,
  outlineItems,
  scrollRootRef,
  selectedCommentId,
  zh,
  onCommentHover,
  onCommentSelect,
  onCommentStatusChange,
  onHeadingNavigate,
  onTopNavigate,
}: {
  comments: readonly ArticleCommentDto[];
  commentMutationBusy: boolean;
  controller: ArticleEditorSidebarController;
  cursorRequest: ArticleEditorOutlineCursorRequest;
  hoveredCommentId: string | null;
  outlineItems: readonly VideoDocumentArticleHeading[];
  scrollRootRef: RefObject<HTMLDivElement | null>;
  selectedCommentId: string | null;
  zh: boolean;
  onCommentHover(commentId: string | null): void;
  onCommentSelect(commentId: string): void;
  onCommentStatusChange(commentId: string, status: ArticleCommentStatus): void;
  onHeadingNavigate(sourceIndex: number): void;
  onTopNavigate(): void;
}) {
  return (
    <ArticleEditorSidebar
      commentCount={comments.filter((comment) => comment.status === 'OPEN').length}
      controller={controller}
      outlineAvailable={outlineItems.length > 0}
      zh={zh}
      comments={
        <ArticleCommentsPanel
          busy={commentMutationBusy}
          comments={comments}
          hoveredId={hoveredCommentId}
          selectedId={selectedCommentId}
          zh={zh}
          onHover={onCommentHover}
          onSelect={onCommentSelect}
          onStatusChange={onCommentStatusChange}
        />
      }
      outline={
        <ArticleEditorOutline
          cursorRequest={cursorRequest}
          depthLimit={controller.preferences.depthLimit}
          followCursor={controller.preferences.followCursor}
          items={outlineItems}
          scrollRootRef={scrollRootRef}
          zh={zh}
          onDepthLimitChange={controller.setDepthLimit}
          onFollowCursorChange={controller.setFollowCursor}
          onHeadingNavigate={onHeadingNavigate}
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
  cursorRequest: ArticleEditorOutlineCursorRequest;
  elements: readonly ArticleElementPlacementInput[];
  openCommentHoverId: string | null;
  outlineItems: readonly VideoDocumentArticleHeading[];
  scrollRootRef: RefObject<HTMLDivElement | null>;
  selectedCommentId: string | null;
  title: string;
  titleAccessory?: ReactNode;
  zh: boolean;
  onArticleNavigationLocation(location: ArticleEditorLocationDto): void;
  onClose?(): void;
  onCommentHover(commentId: string | null): void;
  onCommentSelect(commentId: string): void;
  onCommentStatusChange(commentId: string, status: ArticleCommentStatus): void;
  onPersist(mode: ArticleSaveMode): void;
  onTitleChange(title: string): void;
}

function ArticleEditorDocumentPane({
  children,
  comments,
  commentMutationBusy,
  controller,
  cursorRequest,
  elements,
  openCommentHoverId,
  outlineItems,
  scrollRootRef,
  selectedCommentId,
  title,
  titleAccessory,
  zh,
  onArticleNavigationLocation,
  onClose,
  onCommentHover,
  onCommentSelect,
  onCommentStatusChange,
  onPersist,
  onTitleChange,
}: ArticleEditorDocumentPaneProps) {
  return (
    <ArticleEditorPane
      documentWidth={controller.preferences.documentWidth}
      scrollRootRef={scrollRootRef}
      title={title}
      titleAccessory={titleAccessory}
      toolbar={
        <ArticleEditorLayoutToolbar
          commentCount={comments.filter((comment) => comment.status === 'OPEN').length}
          controller={controller}
          outlineAvailable={outlineItems.length > 0}
          zh={zh}
          onClose={onClose}
        />
      }
      sidePanel={
        <ArticleDocumentSidebar
          comments={comments}
          commentMutationBusy={commentMutationBusy}
          controller={controller}
          cursorRequest={cursorRequest}
          hoveredCommentId={openCommentHoverId}
          outlineItems={outlineItems}
          scrollRootRef={scrollRootRef}
          selectedCommentId={selectedCommentId}
          zh={zh}
          onCommentHover={onCommentHover}
          onCommentSelect={onCommentSelect}
          onCommentStatusChange={onCommentStatusChange}
          onHeadingNavigate={(sourceIndex) => {
            const location = headingLocation(elements, sourceIndex);
            if (location) onArticleNavigationLocation(location);
          }}
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
  labels: ComponentProps<typeof VideoDocumentWysiwygEditor>['labels'];
  leftPaneRootRef: RefObject<HTMLDivElement | null>;
  leftSidebar: ArticleEditorSidebarController;
  media: readonly VideoDocumentRevisionMediaDto[];
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
  titleAccessory?: ReactNode;
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
  onEditorHandleChange(
    handle: VideoDocumentWysiwygEditorHandle | null,
    previousHandle: VideoDocumentWysiwygEditorHandle | null,
  ): void;
  onImageImportError(): void;
  onImageImported(result: VideoDocumentEditorImageImport): void;
  onIllustrationRequest?(selectedText: string | null): void;
  onMarkdownChange(markdown: string): void;
  onPersist(mode: ArticleSaveMode): void;
  onSecondaryChromeRootChange(node: HTMLDivElement | null): void;
  onSecondaryEditorRootChange(node: HTMLDivElement | null): void;
  onTitleChange(title: string): void;
}

export function ArticleEditorDocumentPanes({
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
  labels,
  leftPaneRootRef,
  leftSidebar,
  media,
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
  titleAccessory,
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
  onEditorHandleChange,
  onImageImportError,
  onImageImported,
  onIllustrationRequest,
  onMarkdownChange,
  onPersist,
  onSecondaryChromeRootChange,
  onSecondaryEditorRootChange,
  onTitleChange,
}: Props) {
  return (
    <ArticleEditorSplit
      left={
        <ArticleEditorDocumentPane
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
          titleAccessory={titleAccessory}
          zh={zh}
          onArticleNavigationLocation={onArticleNavigationLocation}
          onCommentHover={onCommentHover}
          onCommentSelect={onCommentSelect}
          onCommentStatusChange={onCommentStatusChange}
          onPersist={onPersist}
          onTitleChange={onTitleChange}
          {...(splitOpen ? { onClose: () => onClose('LEFT') } : {})}
        >
          <VideoDocumentWysiwygEditor
            markdown={initialMarkdown}
            sessionIdentity={editorSessionIdentity}
            articleElements={initialElements}
            articleElementControls={articleElementControls}
            mediaBindings={editorMediaBindings}
            media={media}
            secondaryEditorRoot={secondaryEditorRoot}
            secondaryChromeRoot={secondaryChromeRoot}
            secondaryAriaLabel={zh ? '文章正文（右侧分屏）' : 'Article body (right pane)'}
            currentTimeMs={0}
            durationMs={0}
            timelineSegments={[]}
            ariaLabel={
              splitOpen ? (zh ? '文章正文（左侧分屏）' : 'Article body (left pane)') : zh ? '文章正文' : 'Article body'
            }
            labels={labels}
            onActiveHeadingChange={onActiveHeadingChange}
            onArticleElementsChange={onArticleElementsChange}
            onArticleLocationChange={onArticleLocationChange}
            onArticleEditLocation={onArticleEditLocation}
            onArticleNavigationLocation={onArticleNavigationLocation}
            onEditorHandleChange={onEditorHandleChange}
            onChange={onMarkdownChange}
            onFrameCaptured={() => undefined}
            onImageImported={onImageImported}
            onImageImportError={onImageImportError}
            illustrationLabel={illustrationActionLabel(Boolean(onIllustrationRequest), generatingIllustration, zh)}
            onIllustrationRequest={onIllustrationRequest}
            onSave={() => onPersist('manual')}
          />
        </ArticleEditorDocumentPane>
      }
      leftRef={leftPaneRootRef}
      open={splitOpen}
      right={
        <ArticleEditorDocumentPane
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
          titleAccessory={titleAccessory}
          zh={zh}
          onArticleNavigationLocation={onArticleNavigationLocation}
          onClose={() => onClose('RIGHT')}
          onCommentHover={onCommentHover}
          onCommentSelect={onCommentSelect}
          onCommentStatusChange={onCommentStatusChange}
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
