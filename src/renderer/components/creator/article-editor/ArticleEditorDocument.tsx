import { useArticleEditorMedia } from '@/renderer/components/creator/article-editor/useArticleEditorMedia';
import { commandShortcutText } from '@/renderer/commands/app-shortcuts';
import {
  ContentCommentPopover,
  type ContentCommentDraftPopover,
} from '@/renderer/features/content-editor/ContentCommentPopover';
import { ArticleEditorDocumentPanes } from '@/renderer/components/creator/article-editor/ArticleEditorDocumentPanes';
import { ArticleHeaderViewMenu } from '@/renderer/components/creator/article-editor/ArticleEditorHeader';
import type { ArticleSaveMode } from '@/renderer/components/creator/article-editor/articleEditorSession';
import { useArticleEditorSession } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import {
  useArticleEditLocationShortcuts,
  useArticleEditorNavigation,
} from '@/renderer/components/creator/article-editor/useArticleEditorNavigation';
import type { ArticleEditorOutlineCursorRequest } from '@/renderer/components/creator/article-editor/useArticleEditorOutlineNavigation';
import {
  useArticleEditorSidebar,
  type ArticleEditorSidebarController,
} from '@/renderer/components/creator/article-editor/useArticleEditorSidebar';
import {
  videoDocumentArticleHeadings,
  type VideoDocumentArticleHeading,
} from '@/renderer/features/video-documents/useVideoDocumentArticleOutline';
import type { VideoDocumentArticleElementsChangeReason } from '@/renderer/features/video-documents/videoDocumentEditorPublication';
import {
  VideoDocumentWysiwygEditor,
  type VideoDocumentArticleElementControls,
  type VideoDocumentEditorImageImport,
  type VideoDocumentWysiwygEditorHandle,
} from '@/renderer/features/video-documents/VideoDocumentWysiwygEditor';
import type {
  ArticleCommentAnchorInput,
  ArticleCommentDto,
  ArticleCommentStatus,
  ArticleContentInput,
  ArticleElementPlacementInput,
  VideoDocumentMediaBinding,
  VideoDocumentRevisionMediaDto,
} from '@/shared/contracts';
import { sameArticleElementPlacements } from '@/shared/contracts/article';
import type { BlockDocument } from '@/shared/contracts/block-document';
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { createPortal } from 'react-dom';

interface Props {
  outlineMode?: boolean;
  attachmentsPanel: ReactNode;
  attachmentCount: number;
  articleId: string;
  editorSessionIdentity: string;
  comments: readonly ArticleCommentDto[];
  commentMutationBusy: boolean;
  initialElements: readonly ArticleElementPlacementInput[];
  generatingIllustration?: boolean;
  initialMarkdown: string;
  document?: BlockDocument;
  labels: ComponentProps<typeof VideoDocumentWysiwygEditor>['labels'];
  media: readonly VideoDocumentRevisionMediaDto[];
  mediaBindings: ArticleContentInput['mediaBindings'];
  layoutToolbarRoot: HTMLElement | null;
  splitOpen: boolean;
  title: string;
  titleAccessory?: ReactNode;
  zh: boolean;
  onEditorHandleChange(
    handle: VideoDocumentWysiwygEditorHandle | null,
    previousHandle: VideoDocumentWysiwygEditorHandle | null,
  ): void;
  onCommentCreate(anchor: ArticleCommentAnchorInput, preview: string, body: string): Promise<string | null>;
  onCommentDelete(commentId: string): void;
  onCommentReply(commentId: string, body: string): Promise<boolean>;
  onCommentStatusChange(commentId: string, status: ArticleCommentStatus): void;
  onCommentUpdateBody(commentId: string, body: string): void;
  onIllustrationRequest?(selectedText: string | null): void;
  onImageImportError(): void;
  onImageImported(result: VideoDocumentEditorImageImport): void;
  onMarkdownChange(markdown: string): number;
  onPersist(mode: ArticleSaveMode): void;
  onSplitClose(): void;
  onSplitToggle(): void;
  onTitleChange(title: string): void;
}

interface ArticleCommentDraft {
  anchor: ArticleCommentAnchorInput;
  preview: string;
  rect: ContentCommentDraftPopover['rect'];
}

function useDeferredCommentReveal(
  editor: { current: VideoDocumentWysiwygEditorHandle | null },
  scrollRoot: { current: HTMLDivElement | null },
  onRect: (rect: ContentCommentDraftPopover['rect'] | null) => void,
) {
  const frame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    },
    [],
  );
  return (commentId: string, reveal: boolean) => {
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    frame.current = null;
    if (!reveal) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = null;
      const location = editor.current?.resolveArticleCommentLocation(commentId);
      if (location && scrollRoot.current) editor.current?.revealArticleLocation(location, scrollRoot.current);
      onRect(editor.current?.getArticleCommentAnchorRect(commentId) ?? null);
    });
  };
}

function editorBindings(mediaBindings: ArticleContentInput['mediaBindings']): VideoDocumentMediaBinding[] {
  return mediaBindings.map((binding) => ({
    ...binding,
    kind: 'IMAGE',
    timestampMs: null,
    endTimestampMs: null,
    posterAssetId: null,
  }));
}

function sameOutlineItems(
  current: readonly VideoDocumentArticleHeading[],
  next: readonly VideoDocumentArticleHeading[],
) {
  return (
    current.length === next.length &&
    current.every((item, index) => item.level === next[index]?.level && item.title === next[index]?.title)
  );
}

function hoveredOpenCommentId(comments: readonly ArticleCommentDto[], hoveredCommentId: string | null) {
  return comments.some((comment) => comment.id === hoveredCommentId && comment.status === 'OPEN')
    ? hoveredCommentId
    : null;
}

function toggleCommentSidebar(
  splitOpen: boolean,
  rightPane: HTMLDivElement | null,
  left: ArticleEditorSidebarController,
  right: ArticleEditorSidebarController,
) {
  const activeElement = document.activeElement;
  (splitOpen && activeElement && rightPane?.contains(activeElement) ? right : left).togglePanel('COMMENTS');
}

function articleElementControlLabels(copy: {
  quickAdd: string;
  list: string;
  history: string;
  previousEdit: string;
  nextEdit: string;
}) {
  const platform = window.desktopApi.appPlatform;
  const quickComment = commandShortcutText('comment.quick-add', platform);
  const previousEdit = commandShortcutText('edit.previous-location', platform);
  const nextEdit = commandShortcutText('edit.next-location', platform);
  return {
    commentLabel: `${copy.quickAdd} · ${quickComment}`,
    commentsLabel: copy.list,
    historyLabel: copy.history,
    previousEditLabel: `${copy.previousEdit} · ${previousEdit}`,
    nextEditLabel: `${copy.nextEdit} · ${nextEdit}`,
  };
}

function liveArticleComments(
  comments: readonly ArticleCommentDto[],
  elements: readonly ArticleElementPlacementInput[],
  resolveTarget?: VideoDocumentWysiwygEditorHandle['getArticleCommentTargetResolution'],
) {
  const elementIds = new Set(elements.map((element) => element.elementId));
  return comments.map((comment) => {
    const editorResolution = resolveTarget?.(comment.id);
    if (editorResolution) return { ...comment, targetResolution: editorResolution };
    if (elementIds.has(comment.anchor.startElementId) && elementIds.has(comment.anchor.endElementId)) {
      return { ...comment, targetResolution: 'AVAILABLE' as const };
    }
    const quote = comment.anchor.exactQuote.replace(/\s+/gu, ' ').trim();
    const quotedElement = quote
      ? elements.find((element) => {
          const preview = element.preview.replace(/\s+/gu, ' ').trim();
          return preview.includes(quote.slice(0, 120)) || (preview.length >= 24 && quote.includes(preview));
        })
      : null;
    if (quotedElement) {
      const offset = Math.max(0, quotedElement.preview.indexOf(quote.slice(0, 120)));
      return {
        ...comment,
        targetResolution: 'AVAILABLE' as const,
        anchor: {
          ...comment.anchor,
          startElementId: quotedElement.elementId,
          endElementId: quotedElement.elementId,
          startBlockIndex: quotedElement.blockIndex,
          endBlockIndex: quotedElement.blockIndex,
          startOffset: offset,
          endOffset: offset + Math.min(quote.length, quotedElement.preview.length - offset),
        },
      };
    }
    return { ...comment, targetResolution: elements.length ? ('RELOCATED' as const) : ('MISSING' as const) };
  });
}

function ArticleDocumentCommentPopover({
  busy,
  comments,
  draft,
  hoveredCommentId,
  hoveredRect,
  selectedCommentId,
  selectedRect,
  onDelete,
  onDraftCancel,
  onDraftSubmit,
  onHoverDismiss,
  onHoverEngage,
  onReply,
  onSelectedClose,
  onStatusChange,
  onUpdateBody,
}: {
  busy: boolean;
  comments: readonly ArticleCommentDto[];
  draft: ArticleCommentDraft | null;
  hoveredCommentId: string | null;
  hoveredRect: ContentCommentDraftPopover['rect'] | null;
  selectedCommentId: string | null;
  selectedRect: ContentCommentDraftPopover['rect'] | null;
  onDelete(commentId: string): void;
  onDraftCancel(): void;
  onDraftSubmit(body: string): void;
  onHoverDismiss(): void;
  onHoverEngage(commentId: string): void;
  onReply(commentId: string, body: string): Promise<boolean>;
  onSelectedClose(): void;
  onStatusChange(commentId: string, status: ArticleCommentStatus): void;
  onUpdateBody(commentId: string, body: string): void;
}) {
  return (
    <ContentCommentPopover
      busy={busy}
      draft={draft}
      hovered={
        selectedCommentId || draft ? null : (comments.find((comment) => comment.id === hoveredCommentId) ?? null)
      }
      hoveredRect={hoveredRect}
      selected={comments.find((comment) => comment.id === selectedCommentId) ?? null}
      selectedRect={selectedRect}
      onDelete={onDelete}
      onDraftCancel={onDraftCancel}
      onDraftSubmit={onDraftSubmit}
      onHoverDismiss={onHoverDismiss}
      onHoverEngage={onHoverEngage}
      onReply={onReply}
      onSelectedClose={onSelectedClose}
      onStatusChange={onStatusChange}
      onUpdateBody={onUpdateBody}
    />
  );
}

function ArticleEditorDocumentCommentLayer({
  busy,
  comments,
  draft,
  hoveredCommentId,
  hoveredRect,
  selectedCommentId,
  selectedRect,
  onDelete,
  onDraftCancel,
  onDraftSubmit,
  onHoverDismiss,
  onHoverEngage,
  onReply,
  onSelectedClose,
  onStatusChange,
  onUpdateBody,
}: {
  busy: boolean;
  comments: readonly ArticleCommentDto[];
  draft: ArticleCommentDraft | null;
  hoveredCommentId: string | null;
  hoveredRect: ContentCommentDraftPopover['rect'] | null;
  selectedCommentId: string | null;
  selectedRect: ContentCommentDraftPopover['rect'] | null;
  onDelete(commentId: string): void;
  onDraftCancel(): void;
  onDraftSubmit(body: string): void;
  onHoverDismiss(): void;
  onHoverEngage(commentId: string): void;
  onReply(commentId: string, body: string): Promise<boolean>;
  onSelectedClose(): void;
  onStatusChange(commentId: string, status: ArticleCommentStatus): void;
  onUpdateBody(commentId: string, body: string): void;
}) {
  return (
    <ArticleDocumentCommentPopover
      busy={busy}
      comments={comments}
      draft={draft}
      hoveredCommentId={hoveredCommentId}
      hoveredRect={hoveredRect}
      selectedCommentId={selectedCommentId}
      selectedRect={selectedRect}
      onDelete={onDelete}
      onDraftCancel={onDraftCancel}
      onDraftSubmit={onDraftSubmit}
      onHoverDismiss={onHoverDismiss}
      onHoverEngage={onHoverEngage}
      onReply={onReply}
      onSelectedClose={onSelectedClose}
      onStatusChange={onStatusChange}
      onUpdateBody={onUpdateBody}
    />
  );
}

function useArticleElementProjection(initial: readonly ArticleElementPlacementInput[], onIdentityChange: () => void) {
  const [elements, setElements] = useState(initial);
  const elementsRef = useRef(elements);
  function handleElementsChange(
    next: readonly ArticleElementPlacementInput[],
    reason: VideoDocumentArticleElementsChangeReason,
  ) {
    if (reason !== 'hydrate' && sameArticleElementPlacements(elementsRef.current, next)) return;
    const snapshot = next.map((element) => ({ ...element }));
    elementsRef.current = snapshot;
    setElements(snapshot);
    if (reason === 'identity') onIdentityChange();
  }
  return { elements, handleElementsChange };
}

function articleEditorLayoutAction(
  left: ArticleEditorSidebarController,
  right: ArticleEditorSidebarController,
  root: HTMLElement | null,
  splitOpen: boolean,
  onSplitToggle: () => void,
) {
  if (!root) return null;
  return createPortal(
    <ArticleHeaderViewMenu
      splitOpen={splitOpen}
      wide={left.preferences.documentWidth === 'WIDE'}
      onSplitToggle={onSplitToggle}
      onWidthToggle={() => {
        const width = left.preferences.documentWidth === 'WIDE' ? 'STANDARD' : 'WIDE';
        left.setDocumentWidth(width);
        if (splitOpen) right.setDocumentWidth(width);
      }}
    />,
    root,
  );
}

export function ArticleEditorDocument(props: Props) {
  const commentCopy = useI18n().messages.contentEditor.comment;
  const { attachmentsPanel, attachmentCount, articleId, editorSessionIdentity, comments, commentMutationBusy } = props;
  const { initialElements, layoutToolbarRoot } = props;
  const { generatingIllustration = false, initialMarkdown, labels, media, mediaBindings, splitOpen } = props;
  const { title, titleAccessory, zh, onEditorHandleChange, onCommentCreate, onCommentDelete } = props;
  const { onCommentReply, onCommentStatusChange, onCommentUpdateBody, onIllustrationRequest } = props;
  const { onImageImportError, onImageImported, onMarkdownChange, onPersist, onSplitClose, onSplitToggle } = props;
  const { onTitleChange } = props;
  const editorMediaBindings = useMemo(() => editorBindings(mediaBindings), [mediaBindings]);
  const editorSession = useArticleEditorSession();
  const initialOutlineItems = useMemo(() => videoDocumentArticleHeadings(initialMarkdown), [initialMarkdown]);
  const [outlineItems, setOutlineItems] = useState(initialOutlineItems);
  const { elements, handleElementsChange } = useArticleElementProjection(initialElements, () =>
    recordDraftSequence(editorSession.articleElementsChanged()),
  );
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null);
  const [hoveredCommentRect, setHoveredCommentRect] = useState<ContentCommentDraftPopover['rect'] | null>(null);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [selectedCommentRect, setSelectedCommentRect] = useState<ContentCommentDraftPopover['rect'] | null>(null);
  const [commentDraft, setCommentDraft] = useState<ArticleCommentDraft | null>(null);
  const [secondaryEditorRoot, setSecondaryEditorRoot] = useState<HTMLDivElement | null>(null);
  const [secondaryChromeRoot, setSecondaryChromeRoot] = useState<HTMLDivElement | null>(null);
  const [cursorRequest, setCursorRequest] = useState<ArticleEditorOutlineCursorRequest>({
    index: null,
    revision: 0,
  });
  const outlineItemsRef = useRef(outlineItems);
  const documentRootRef = useRef<HTMLDivElement>(null);
  const leftPaneRootRef = useRef<HTMLDivElement>(null);
  const rightPaneRootRef = useRef<HTMLDivElement>(null);
  const secondaryScrollRootRef = useRef<HTMLDivElement>(null);
  const {
    editTrail: liveEditTrail,
    editorHandleRef,
    scrollRootRef,
    navigateArticleLocation,
    scheduleLocation,
    handleEditorChange,
    jumpToLocation,
    goToPreviousEdit,
    goToNextEdit,
    recordDraftSequence,
  } = useArticleEditorNavigation({ articleId, editorSession, onEditorHandleChange });
  const revealAfterUnfold = useDeferredCommentReveal(editorHandleRef, scrollRootRef, setSelectedCommentRect);
  const mediaControls = useArticleEditorMedia({
    bindings: editorMediaBindings,
    elements,
    onEditorHandleChange: handleEditorChange,
    onNavigate: jumpToLocation,
  });
  const leftSidebar = useArticleEditorSidebar(leftPaneRootRef, comments);
  const rightSidebar = useArticleEditorSidebar(rightPaneRootRef, comments, {
    enabled: splitOpen,
    preferenceScope: 'SECONDARY',
  });
  function handleMarkdownChange(markdown: string) {
    const nextOutlineItems = videoDocumentArticleHeadings(markdown);
    if (!sameOutlineItems(outlineItemsRef.current, nextOutlineItems)) {
      outlineItemsRef.current = nextOutlineItems;
      setOutlineItems(nextOutlineItems);
    }
    recordDraftSequence(onMarkdownChange(markdown));
  }
  function beginComment() {
    const target = editorHandleRef.current?.captureArticleCommentTarget();
    if (!target || commentMutationBusy) return;
    setCommentDraft({ anchor: { ...target.anchor }, preview: target.preview, rect: target.rect });
    setHoveredCommentId(null);
    setHoveredCommentRect(null);
    setSelectedCommentId(null);
    setSelectedCommentRect(null);
  }

  async function submitComment(body: string) {
    if (!commentDraft || commentMutationBusy || !body.trim()) return;
    const commentId = await onCommentCreate(commentDraft.anchor, commentDraft.preview, body);
    if (!commentId) return;
    const rect = commentDraft.rect;
    setCommentDraft(null);
    setSelectedCommentId(commentId);
    setSelectedCommentRect(rect);
  }

  useArticleEditLocationShortcuts({
    root: documentRootRef,
    onPreviousEdit: goToPreviousEdit,
    onNextEdit: goToNextEdit,
    onQuickComment: beginComment,
  });

  const elementPreviews = useMemo(
    () => Object.fromEntries(elements.map((element) => [element.elementId, element.preview])),
    [elements],
  );
  const visibleComments = useMemo(
    () => liveArticleComments(comments, elements, editorHandleRef.current?.getArticleCommentTargetResolution),
    [comments, editorHandleRef, elements],
  );
  const openCommentHoverId = hoveredOpenCommentId(visibleComments, hoveredCommentId);

  function jumpToComment(comment: ArticleCommentDto) {
    const location = editorHandleRef.current?.resolveArticleCommentLocation(comment.id) ?? {
      elementId: comment.anchor.startElementId,
      relativeOffset: comment.anchor.startOffset,
      blockIndex: comment.anchor.startBlockIndex,
    };
    const scrollRoot = scrollRootRef.current;
    // A selection reveals folded outline ancestors before measuring the target.
    if (props.outlineMode) jumpToLocation(location);
    const revealed = scrollRoot
      ? (editorHandleRef.current?.revealArticleLocation(location, scrollRoot) ?? false)
      : false;
    if (revealed) navigateArticleLocation(location);
    else jumpToLocation(location);
  }

  function openComment(commentId: string, reveal: boolean) {
    const comment = visibleComments.find((candidate) => candidate.id === commentId);
    if (!comment) return;
    if (reveal) jumpToComment(comment);
    const rect = editorHandleRef.current?.getArticleCommentAnchorRect(commentId) ?? selectedCommentRect;
    setCommentDraft(null);
    setHoveredCommentId(null);
    setHoveredCommentRect(null);
    setSelectedCommentId(commentId);
    setSelectedCommentRect(rect);
    revealAfterUnfold(commentId, Boolean(props.outlineMode && reveal));
  }

  const selectComment = (commentId: string) => openComment(commentId, false);
  const revealComment = (commentId: string) => openComment(commentId, true);

  function deleteComment(commentId: string) {
    onCommentDelete(commentId);
    setSelectedCommentId(null);
    setSelectedCommentRect(null);
  }

  function hoverComment(commentId: string | null) {
    setHoveredCommentId(commentId);
    setHoveredCommentRect(commentId ? (editorHandleRef.current?.getArticleCommentAnchorRect(commentId) ?? null) : null);
  }

  function closePane(side: 'LEFT' | 'RIGHT') {
    if (side === 'RIGHT') {
      onSplitClose();
      return;
    }
    const survivingScrollTop = secondaryScrollRootRef.current?.scrollTop ?? 0;
    leftSidebar.replacePreferences(rightSidebar.preferences);
    onSplitClose();
    window.requestAnimationFrame(() => {
      if (scrollRootRef.current) scrollRootRef.current.scrollTop = survivingScrollTop;
    });
  }

  const commentsOpen = leftSidebar.panelOpen('COMMENTS') || (splitOpen && rightSidebar.panelOpen('COMMENTS'));

  const articleElementControls: VideoDocumentArticleElementControls = {
    comments: visibleComments,
    commentsOpen,
    hoveredCommentId: openCommentHoverId,
    selectedCommentId,
    editTrail: liveEditTrail,
    elementPreviews,
    busy: commentMutationBusy,
    ...articleElementControlLabels(commentCopy),
    onAddComment: beginComment,
    onCommentHover: hoverComment,
    onCommentSelect: selectComment,
    onCommentsToggle: () => toggleCommentSidebar(splitOpen, rightPaneRootRef.current, leftSidebar, rightSidebar),
    onEditTrailSelect: jumpToLocation,
    onPreviousEdit: goToPreviousEdit,
    onNextEdit: goToNextEdit,
  };

  return (
    <div
      ref={documentRootRef}
      data-content-source={JSON.stringify({ kind: 'ARTICLE', id: articleId })}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
    >
      {articleEditorLayoutAction(leftSidebar, rightSidebar, layoutToolbarRoot, splitOpen, onSplitToggle)}
      <ArticleEditorDocumentPanes
        outlineMode={props.outlineMode}
        attachmentsPanel={attachmentsPanel}
        attachmentCount={attachmentCount}
        articleElementControls={articleElementControls}
        comments={visibleComments}
        commentMutationBusy={commentMutationBusy}
        cursorRequest={cursorRequest}
        editorMediaBindings={editorMediaBindings}
        editorSessionIdentity={editorSessionIdentity}
        elements={elements}
        generatingIllustration={generatingIllustration}
        initialElements={initialElements}
        initialMarkdown={initialMarkdown}
        document={props.document}
        labels={labels}
        leftPaneRootRef={leftPaneRootRef}
        leftSidebar={leftSidebar}
        media={media}
        {...mediaControls}
        openCommentHoverId={openCommentHoverId}
        outlineItems={outlineItems}
        rightPaneRootRef={rightPaneRootRef}
        rightSidebar={rightSidebar}
        scrollRootRef={scrollRootRef}
        secondaryChromeRoot={secondaryChromeRoot}
        secondaryEditorRoot={secondaryEditorRoot}
        secondaryScrollRootRef={secondaryScrollRootRef}
        selectedCommentId={selectedCommentId}
        splitOpen={splitOpen}
        title={title}
        titleAccessory={titleAccessory}
        zh={zh}
        onActiveHeadingChange={(index) => setCursorRequest((current) => ({ index, revision: current.revision + 1 }))}
        onArticleEditLocation={(location) => scheduleLocation(location, true)}
        onArticleElementsChange={handleElementsChange}
        onArticleLocationChange={(location) => scheduleLocation(location, false)}
        onArticleNavigationLocation={navigateArticleLocation}
        onClose={closePane}
        onCommentHover={hoverComment}
        onCommentSelect={revealComment}
        onCommentStatusChange={onCommentStatusChange}
        onHeadingNavigate={(sourceIndex) => {
          const location = editorHandleRef.current?.resolveArticleOutlineHeadingLocation(sourceIndex);
          if (location) navigateArticleLocation(location);
        }}
        onImageImportError={onImageImportError}
        onImageImported={onImageImported}
        onIllustrationRequest={onIllustrationRequest}
        onMarkdownChange={handleMarkdownChange}
        onPersist={onPersist}
        onSecondaryChromeRootChange={setSecondaryChromeRoot}
        onSecondaryEditorRootChange={setSecondaryEditorRoot}
        onTitleChange={onTitleChange}
      />
      <ArticleEditorDocumentCommentLayer
        busy={commentMutationBusy}
        comments={visibleComments}
        draft={commentDraft}
        hoveredCommentId={openCommentHoverId}
        hoveredRect={hoveredCommentRect}
        selectedCommentId={selectedCommentId}
        selectedRect={selectedCommentRect}
        onDelete={deleteComment}
        onDraftCancel={() => setCommentDraft(null)}
        onDraftSubmit={(body) => void submitComment(body)}
        onHoverDismiss={() => hoverComment(null)}
        onHoverEngage={selectComment}
        onReply={onCommentReply}
        onSelectedClose={() => {
          setSelectedCommentId(null);
          setSelectedCommentRect(null);
        }}
        onStatusChange={onCommentStatusChange}
        onUpdateBody={onCommentUpdateBody}
      />
    </div>
  );
}
