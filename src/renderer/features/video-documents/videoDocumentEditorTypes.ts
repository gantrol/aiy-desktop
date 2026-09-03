import type {
  ArticleEditorLocationDto,
  ArticleElementPlacementInput,
  VideoDocumentFrameCaptureResult,
  VideoDocumentMediaBinding,
  VideoDocumentRevisionMediaDto,
  VideoDocumentTimelineSegment,
} from '@/shared/contracts';
import type {
  articleCheckBlocks,
  articleCommentAnchorRect,
  articleCommentTargetResolution,
  captureArticleCommentTarget,
  mappedArticleCommentAnchors,
} from '@/renderer/features/video-documents/articleElementIdentity';
import type {
  VideoDocumentArticleElementControls,
  VideoDocumentEditorImageImport,
  VideoDocumentWysiwygEditorLabels,
} from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
import type {
  VideoDocumentArticleElementsChangeReason,
  VideoDocumentWysiwygPersistenceSnapshot,
} from '@/renderer/features/video-documents/videoDocumentEditorPublication';

export interface VideoDocumentQuickInsertNoteRequest {
  revision: number;
  timestampMs: number;
}

export interface VideoDocumentWysiwygEditorHandle {
  getArticleCheckBlocks(): ReturnType<typeof articleCheckBlocks>;
  getPersistenceSnapshot(): VideoDocumentWysiwygPersistenceSnapshot;
  removeUnboundImages(boundMediaPaths: readonly string[]): boolean;
  getArticleCommentAnchors(): ReturnType<typeof mappedArticleCommentAnchors>;
  getArticleCommentAnchorRect(commentId: string): ReturnType<typeof articleCommentAnchorRect>;
  getArticleCommentTargetResolution(commentId: string): ReturnType<typeof articleCommentTargetResolution>;
  captureArticleCommentTarget(): ReturnType<typeof captureArticleCommentTarget>;
  resolveArticleCommentLocation(commentId: string): ArticleEditorLocationDto | null;
  resolveArticleOutlineHeadingLocation(sourceIndex: number): ArticleEditorLocationDto | null;
  captureArticleLocation(): ArticleEditorLocationDto | null;
  captureArticleViewportLocation(scrollRoot: HTMLElement): ArticleEditorLocationDto | null;
  revealArticleLocation(location: ArticleEditorLocationDto, scrollRoot: HTMLElement): boolean;
  restoreArticleLocation(location: ArticleEditorLocationDto): boolean;
  focusArticleElement(elementId: string): boolean;
}

export interface VideoDocumentWysiwygEditorProps {
  markdown: string;
  sessionIdentity?: string;
  mediaBindings: readonly VideoDocumentMediaBinding[];
  media: readonly VideoDocumentRevisionMediaDto[];
  secondaryEditorRoot?: HTMLDivElement | null;
  secondaryChromeRoot?: HTMLDivElement | null;
  secondaryAriaLabel?: string;
  documentId?: string;
  sourceVideoUrl?: string;
  currentTimeMs: number;
  durationMs: number;
  timelineSegments: readonly VideoDocumentTimelineSegment[];
  quickInsertNoteRequest?: VideoDocumentQuickInsertNoteRequest | null;
  ariaLabel: string;
  labels: VideoDocumentWysiwygEditorLabels;
  onActiveHeadingChange?(index: number | null): void;
  articleElements?: readonly ArticleElementPlacementInput[];
  articleElementControls?: VideoDocumentArticleElementControls;
  onArticleElementsChange?(
    elements: readonly ArticleElementPlacementInput[],
    reason: VideoDocumentArticleElementsChangeReason,
  ): void;
  onArticleLocationChange?(location: ArticleEditorLocationDto): void;
  onArticleEditLocation?(location: ArticleEditorLocationDto): void;
  onArticleNavigationLocation?(location: ArticleEditorLocationDto): void;
  onEditorHandleChange?(
    handle: VideoDocumentWysiwygEditorHandle | null,
    releasedHandle: VideoDocumentWysiwygEditorHandle | null,
  ): void;
  onChange(markdown: string): void;
  onFrameCaptured(result: VideoDocumentFrameCaptureResult): void;
  onImageImported(result: VideoDocumentEditorImageImport): void;
  onImageImportError(): void;
  illustrationLabel?: string;
  onIllustrationRequest?(selectedText: string): void;
  onQuickInsertNoteBusyChange?(busy: boolean): void;
  onQuickInsertNoteError?(): void;
  onSave(markdown: string): void;
}
