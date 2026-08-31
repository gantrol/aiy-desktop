import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ArticleEditTrailEntryDto,
  ArticleEditorLocationDto,
  WorkspaceArticleEditorStateDto,
} from '@/shared/contracts';
import type { useArticleEditorSession } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { useWorkspaceArticleEditorState } from '@/renderer/components/workspace/WorkspaceArticleEditorStateProvider';
import type { VideoDocumentWysiwygEditorHandle } from '@/renderer/features/video-documents/VideoDocumentWysiwygEditor';
import { commandMatchesShortcut } from '@/renderer/commands/app-shortcuts';

interface ArticleEditEvent extends ArticleEditTrailEntryDto {
  draftSeq: number;
}

function initialNavigationState(articleId: string): WorkspaceArticleEditorStateDto {
  return { articleId, resumeLocation: null, editTrail: [] };
}

function sameLocation(left: ArticleEditorLocationDto | null, right: ArticleEditorLocationDto | null) {
  return left?.elementId === right?.elementId && left?.relativeOffset === right?.relativeOffset;
}

function coalescedEditTrail(events: readonly ArticleEditEvent[]) {
  const trail: ArticleEditTrailEntryDto[] = [];
  for (const event of events) {
    const { draftSeq: _draftSeq, ...entry } = event;
    const previous = trail[trail.length - 1];
    const continuous =
      previous?.elementId === entry.elementId &&
      new Date(entry.recordedAt).getTime() - new Date(previous.recordedAt).getTime() <= 4_000;
    if (continuous) trail[trail.length - 1] = entry;
    else trail.push(entry);
  }
  return trail.slice(-40);
}

export function useArticleEditorNavigation({
  articleId,
  editorSession,
  onEditorHandleChange,
}: {
  articleId: string;
  editorSession: ReturnType<typeof useArticleEditorSession>;
  onEditorHandleChange(
    handle: VideoDocumentWysiwygEditorHandle | null,
    previousHandle: VideoDocumentWysiwygEditorHandle | null,
  ): void;
}) {
  const {
    state,
    update,
    navigationEntryId,
    articleLocation,
    updateArticleLocation,
    navigateArticleLocation: navigateWorkspaceArticleLocation,
    registerLocationFlush,
  } = useWorkspaceArticleEditorState(articleId);
  const navigationState = state ?? initialNavigationState(articleId);
  const navigationStateRef = useRef(navigationState);
  navigationStateRef.current = navigationState;
  const [editTrail, setEditTrail] = useState(navigationState.editTrail);
  const editTrailRef = useRef(editTrail);
  editTrailRef.current = editTrail;
  const editEventsRef = useRef<ArticleEditEvent[]>(
    navigationState.editTrail.map((entry) => ({ ...entry, draftSeq: -1 })),
  );
  const editorHandleRef = useRef<VideoDocumentWysiwygEditorHandle | null>(null);
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const restoredEntryRef = useRef<string | null>(null);
  const restoreFrameRef = useRef<number | null>(null);
  const editTrailIndexRef = useRef<number | null>(null);
  const pendingResumeRef = useRef<ArticleEditorLocationDto | null>(null);
  const pendingEditRef = useRef<{ location: ArticleEditorLocationDto; draftSeq: number } | null>(null);
  const latestDraftSeqRef = useRef(0);
  const locationTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);

  const flushPendingLocations = useCallback(() => {
    if (locationTimerRef.current !== null) {
      globalThis.clearTimeout(locationTimerRef.current);
      locationTimerRef.current = null;
    }
    const resumeLocation = pendingResumeRef.current;
    const editLocation = pendingEditRef.current;
    pendingResumeRef.current = null;
    pendingEditRef.current = null;
    if (!resumeLocation && !editLocation) return;
    if (resumeLocation) updateArticleLocation(resumeLocation);
    if (!editLocation) return;
    editEventsRef.current = [
      ...editEventsRef.current,
      { ...editLocation.location, recordedAt: new Date().toISOString(), draftSeq: editLocation.draftSeq },
    ].slice(-240);
    const next = coalescedEditTrail(editEventsRef.current);
    editTrailRef.current = next;
    setEditTrail(next);
  }, [updateArticleLocation]);

  useEffect(
    () =>
      editorSession.subscribeAcknowledged((_article, request) => {
        flushPendingLocations();
        const acknowledged = editEventsRef.current.filter(
          (event) => event.draftSeq < 0 || event.draftSeq <= request.draftSeq,
        );
        const pending = editEventsRef.current.filter((event) => event.draftSeq > request.draftSeq);
        const persistedTrail = coalescedEditTrail(acknowledged);
        editEventsRef.current = [...persistedTrail.map((entry) => ({ ...entry, draftSeq: -1 })), ...pending].slice(
          -240,
        );
        const next = coalescedEditTrail(editEventsRef.current);
        editTrailRef.current = next;
        setEditTrail(next);
        update((current) => ({
          ...(current ?? initialNavigationState(articleId)),
          editTrail: persistedTrail,
        }));
      }),
    [articleId, editorSession, flushPendingLocations, update],
  );

  useEffect(() => {
    registerLocationFlush(flushPendingLocations);
    return () => registerLocationFlush(null);
  }, [flushPendingLocations, registerLocationFlush]);

  const scheduleLocation = useCallback(
    (location: ArticleEditorLocationDto, edited: boolean) => {
      pendingResumeRef.current = location;
      if (edited) {
        pendingEditRef.current = { location, draftSeq: latestDraftSeqRef.current };
        editTrailIndexRef.current = null;
      }
      if (locationTimerRef.current !== null) globalThis.clearTimeout(locationTimerRef.current);
      locationTimerRef.current = globalThis.setTimeout(flushPendingLocations, 450);
    },
    [flushPendingLocations],
  );

  const navigateArticleLocation = useCallback(
    (location: ArticleEditorLocationDto) => {
      flushPendingLocations();
      navigateWorkspaceArticleLocation(location);
    },
    [flushPendingLocations, navigateWorkspaceArticleLocation],
  );

  useEffect(
    () => () => {
      if (restoreFrameRef.current !== null) window.cancelAnimationFrame(restoreFrameRef.current);
      flushPendingLocations();
    },
    [flushPendingLocations],
  );

  useEffect(() => {
    const scrollRoot = scrollRootRef.current;
    if (!scrollRoot) return;
    let frame: number | null = null;
    const capture = () => {
      frame = null;
      const location = editorHandleRef.current?.captureArticleViewportLocation(scrollRoot);
      if (location) scheduleLocation(location, false);
    };
    const onScroll = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(capture);
    };
    scrollRoot.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scrollRoot.removeEventListener('scroll', onScroll);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [scheduleLocation]);

  function handleEditorChange(
    handle: VideoDocumentWysiwygEditorHandle | null,
    releasedHandle: VideoDocumentWysiwygEditorHandle | null,
  ) {
    if (!handle) {
      if (releasedHandle && editorHandleRef.current === releasedHandle) {
        editorHandleRef.current = null;
        if (restoreFrameRef.current !== null) {
          window.cancelAnimationFrame(restoreFrameRef.current);
          restoreFrameRef.current = null;
        }
      }
      onEditorHandleChange(null, releasedHandle);
      return;
    }
    const previousHandle = editorHandleRef.current;
    editorHandleRef.current = handle;
    onEditorHandleChange(handle, previousHandle);
    if (restoreFrameRef.current !== null) window.cancelAnimationFrame(restoreFrameRef.current);
    restoreFrameRef.current = window.requestAnimationFrame(() => {
      restoreFrameRef.current = null;
      const location = articleLocation ?? navigationStateRef.current.resumeLocation;
      const scrollRoot = scrollRootRef.current;
      if (location && scrollRoot) handle.revealArticleLocation(location, scrollRoot);
      restoredEntryRef.current = navigationEntryId;
    });
  }

  useEffect(() => {
    if (!navigationEntryId || navigationEntryId === restoredEntryRef.current) return;
    const handle = editorHandleRef.current;
    const scrollRoot = scrollRootRef.current;
    if (!handle || !scrollRoot) return;
    const location = articleLocation ?? navigationStateRef.current.resumeLocation;
    if (location) handle.revealArticleLocation(location, scrollRoot);
    restoredEntryRef.current = navigationEntryId;
  }, [articleLocation, navigationEntryId]);

  function jumpToLocation(location: ArticleEditorLocationDto) {
    const handle = editorHandleRef.current;
    flushPendingLocations();
    if (!handle?.restoreArticleLocation(location)) return false;
    navigateWorkspaceArticleLocation(location);
    return true;
  }

  function goToPreviousEdit() {
    const current = editorHandleRef.current?.captureArticleLocation() ?? null;
    let index = editTrailIndexRef.current ?? editTrailRef.current.length;
    while (index > 0) {
      const candidate = editTrailRef.current[--index];
      if (sameLocation(current, candidate)) continue;
      if (jumpToLocation(candidate)) editTrailIndexRef.current = index;
      return;
    }
  }

  function goToNextEdit() {
    const current = editorHandleRef.current?.captureArticleLocation() ?? null;
    if (editTrailIndexRef.current === null) return;
    let index = editTrailIndexRef.current;
    while (index < editTrailRef.current.length - 1) {
      const candidate = editTrailRef.current[++index];
      if (sameLocation(current, candidate)) continue;
      if (jumpToLocation(candidate)) editTrailIndexRef.current = index;
      return;
    }
  }

  return {
    editTrail,
    editorHandleRef,
    scrollRootRef,
    navigateArticleLocation,
    scheduleLocation,
    handleEditorChange,
    jumpToLocation,
    goToPreviousEdit,
    goToNextEdit,
    recordDraftSequence: (draftSeq: number) => {
      latestDraftSeqRef.current = draftSeq;
    },
  };
}

export function useArticleEditLocationShortcuts({
  root,
  onPreviousEdit,
  onNextEdit,
  onQuickComment,
}: {
  root: { current: HTMLDivElement | null };
  onPreviousEdit(): void;
  onNextEdit(): void;
  onQuickComment(): void;
}) {
  useEffect(() => {
    const actions = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const previous = commandMatchesShortcut(event, window.desktopApi.appPlatform, 'edit.previous-location');
      const next = commandMatchesShortcut(event, window.desktopApi.appPlatform, 'edit.next-location');
      const quickComment = commandMatchesShortcut(event, window.desktopApi.appPlatform, 'comment.quick-add');
      if (!previous && !next && !quickComment) return;
      const activeElement = document.activeElement;
      if (!(activeElement instanceof Node) || !root.current?.contains(activeElement)) return;
      if (quickComment) {
        if (
          !(activeElement instanceof Element) ||
          !activeElement.closest('[data-slot="video-document-wysiwyg-editor"]')
        ) {
          return;
        }
        onQuickComment();
      } else if (previous) onPreviousEdit();
      else onNextEdit();
      event.preventDefault();
    };
    window.addEventListener('keydown', actions);
    return () => window.removeEventListener('keydown', actions);
  }, [onNextEdit, onPreviousEdit, onQuickComment, root]);
}
