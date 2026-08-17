import { useEffect, useRef, useState } from 'react';
import type { VideoDocumentBranchRole, VideoDocumentDto, VideoDocumentRevisionDto } from '@/shared/contracts';
import {
  useVideoDocumentRevision,
  type VideoDocumentRevisionCache,
} from '@/renderer/features/video-documents/useVideoDocumentRevision';
import { useVideoKeyChanges } from '@/renderer/features/video-documents/useVideoKeyChanges';

const SOURCE_PANE_WIDTH_KEY = 'aiy.videoDocuments.sourcePaneWidth';
const ACTIVE_BRANCH_KEY_PREFIX = 'aiy.videoDocuments.activeBranch.';

function storedSourcePaneWidth() {
  const value = Number(globalThis.localStorage?.getItem(SOURCE_PANE_WIDTH_KEY));
  return Number.isFinite(value) ? Math.min(720, Math.max(320, value)) : 420;
}

function initialBranchRole(document: VideoDocumentDto) {
  const stored = globalThis.localStorage?.getItem(`${ACTIVE_BRANCH_KEY_PREFIX}${document.id}`);
  if (
    (stored === 'ARTICLE' || stored === 'CLEAN_TRANSCRIPT') &&
    document.branches.some((branch) => branch.role === stored)
  ) {
    return stored;
  }
  const article = document.branches.find((branch) => branch.role === 'ARTICLE');
  const transcript = document.branches.find((branch) => branch.role === 'CLEAN_TRANSCRIPT');
  if (article?.latestDraftRevisionId) return 'ARTICLE';
  if (transcript?.latestDraftRevisionId) return 'CLEAN_TRANSCRIPT';
  return article?.role ?? transcript?.role ?? 'CLEAN_TRANSCRIPT';
}

function selectedArticleNote(revision: VideoDocumentRevisionDto | null, noteId: string | null) {
  if (revision?.content.format !== 'NOTE_COLLECTION') return null;
  const collection = revision.content;
  return collection.notes.find((note) => note.id === (noteId ?? collection.defaultNoteId)) ?? null;
}

function articleTimelineSource(
  activeRevision: VideoDocumentRevisionDto | null,
  timelineRevision: VideoDocumentRevisionDto | null,
) {
  if (activeRevision?.content.format === 'MARKDOWN' || activeRevision?.content.format === 'NOTE_COLLECTION') {
    return activeRevision;
  }
  return timelineRevision;
}

function articleTimelineSegments(revision: VideoDocumentRevisionDto | null, noteId: string | null) {
  if (revision?.content.format === 'MARKDOWN') return revision.content.timelineSegments ?? [];
  return selectedArticleNote(revision, noteId)?.timelineSegments ?? [];
}

function articleTranscriptSource(
  document: VideoDocumentDto | null,
  revision: VideoDocumentRevisionDto | null,
  noteId: string | null,
) {
  const transcriptBranch = document?.branches.find((branch) => branch.role === 'CLEAN_TRANSCRIPT') ?? null;
  const note = selectedArticleNote(revision, noteId);
  const revisionId =
    revision?.content.format === 'MARKDOWN'
      ? (revision.content.generation?.transcriptRevisionId ?? transcriptBranch?.latestDraftRevisionId ?? null)
      : (note?.generation?.transcriptRevisionId ?? transcriptBranch?.latestDraftRevisionId ?? null);
  return { branchId: transcriptBranch?.id ?? null, revisionId };
}

function isDocumentTransitionPending(active: boolean, documentId: string | null, document: VideoDocumentDto | null) {
  return Boolean(active && documentId && document && document.id !== documentId);
}

interface Options {
  active: boolean;
  documentId: string | null;
  revisionLoadFailedLabel: string;
  keyChangeErrorLabels: {
    ffmpegUnavailable: string;
    busy: string;
    extractFailed: string;
  };
  notify(message: string): void;
}

export function useVideoDocumentSession({
  active,
  documentId,
  revisionLoadFailedLabel,
  keyChangeErrorLabels,
  notify,
}: Options) {
  const [document, setDocument] = useState<VideoDocumentDto | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [activeBranch, setActiveBranchState] = useState<VideoDocumentBranchRole>('CLEAN_TRANSCRIPT');
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [sourcePaneOpen, setSourcePaneOpen] = useState(true);
  const [sourcePaneWidth, setSourcePaneWidthState] = useState(storedSourcePaneWidth);
  const [playbackTimeMs, setPlaybackTimeMs] = useState(0);
  const selectedDocumentIdRef = useRef(documentId);
  selectedDocumentIdRef.current = documentId;
  const revisionCacheRef = useRef({ documentId, revisions: new Map() as VideoDocumentRevisionCache });
  if (revisionCacheRef.current.documentId !== documentId) {
    revisionCacheRef.current = { documentId, revisions: new Map() };
  }
  const revisionCache = revisionCacheRef.current.revisions;
  const currentDocument = document?.id === documentId ? document : null;

  const selectedBranch = currentDocument?.branches.find((branch) => branch.role === activeBranch) ?? null;
  const activeRevision = useVideoDocumentRevision({
    active,
    branchId: selectedBranch?.id ?? null,
    revisionId: selectedBranch?.latestDraftRevisionId ?? null,
    loadFailedLabel: revisionLoadFailedLabel,
    cache: revisionCache,
    notify,
  });
  const articleBranch = currentDocument?.branches.find((branch) => branch.role === 'ARTICLE') ?? null;
  const timelineRevision = useVideoDocumentRevision({
    active: active && activeBranch === 'CLEAN_TRANSCRIPT',
    branchId: articleBranch?.id ?? null,
    revisionId: articleBranch?.latestDraftRevisionId ?? null,
    loadFailedLabel: revisionLoadFailedLabel,
    cache: revisionCache,
    notify,
  });
  const timelineSourceRevision = articleTimelineSource(activeRevision.revision, timelineRevision.revision);
  const timelineSegments = articleTimelineSegments(timelineSourceRevision, activeNoteId);
  const transcriptSource = articleTranscriptSource(currentDocument, activeRevision.revision, activeNoteId);
  const articleTranscriptRevision = useVideoDocumentRevision({
    active: active && activeBranch === 'ARTICLE',
    branchId: transcriptSource.branchId,
    revisionId: transcriptSource.revisionId,
    loadFailedLabel: revisionLoadFailedLabel,
    cache: revisionCache,
    notify,
  });
  const keyChanges = useVideoKeyChanges({
    active,
    documentId: currentDocument?.id ?? null,
    sourceAssetId: currentDocument?.source.asset.id ?? null,
    articleActive: activeBranch === 'ARTICLE',
    errorLabels: keyChangeErrorLabels,
    notify,
  });

  useEffect(() => {
    if (!active || !documentId) {
      setDocument(null);
      return undefined;
    }
    let current = true;
    setDocument(null);
    setPlaybackTimeMs(0);
    setActiveNoteId(null);
    setDocumentLoading(true);
    void window.desktopApi
      .videoDocumentGet(documentId)
      .then((next) => {
        if (!current) return;
        setDocument(next);
        setTitle(next.title);
        setActiveBranchState(initialBranchRole(next));
        setDocumentLoading(false);
      })
      .catch((reason) => {
        if (!current) return;
        setDocumentLoading(false);
        notify(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      current = false;
    };
  }, [active, documentId, notify]);

  function setSourcePaneWidth(width: number) {
    const normalized = Math.min(720, Math.max(320, Math.round(width)));
    setSourcePaneWidthState(normalized);
    globalThis.localStorage?.setItem(SOURCE_PANE_WIDTH_KEY, String(normalized));
  }

  function setActiveBranch(role: VideoDocumentBranchRole) {
    setActiveBranchState(role);
    const activeDocumentId = selectedDocumentIdRef.current;
    if (activeDocumentId) globalThis.localStorage?.setItem(`${ACTIVE_BRANCH_KEY_PREFIX}${activeDocumentId}`, role);
  }

  return {
    document: currentDocument,
    setDocument,
    documentLoading: documentLoading || isDocumentTransitionPending(active, documentId, document),
    title,
    setTitle,
    activeBranch,
    setActiveBranch,
    activeNoteId,
    setActiveNoteId,
    selectedBranch,
    activeRevision,
    articleTranscriptRevision: articleTranscriptRevision.revision,
    timelineSegments,
    keyChanges,
    sourcePaneOpen,
    setSourcePaneOpen,
    sourcePaneWidth,
    setSourcePaneWidth,
    playbackTimeMs,
    setPlaybackTimeMs,
    selectedDocumentIdRef,
  };
}
