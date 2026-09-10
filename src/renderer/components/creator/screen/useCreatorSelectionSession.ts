import { useMemo, useRef, useState } from 'react';
import type { BootstrapDto, Locale } from '@/shared/contracts';
import { buildAlbumTreeIndex } from '@/renderer/components/albums/albumTree';
import type { CreatorLocation } from '@/renderer/components/app/app-navigation';
import { useCreationLibraryFilter } from '@/renderer/components/creator/creationLibraryFilter';
import { readCreationStartMode } from '@/renderer/components/creator/creationStartMode';
import { buildCreationSessionProjection } from '@/renderer/components/creator/creationSessionProjection';
import { creatorInitialSession } from '@/renderer/components/creator/screen/creatorInitialSession';
import { useCreatorContentSelection } from '@/renderer/components/creator/screen/useCreatorContentSelection';
import { useCreatorWorkbenchProjection } from '@/renderer/components/creator/screen/useCreatorWorkbenchProjection';
import type {
  CreationDraftPromptSnapshot,
  CreationDraftSaveSnapshot,
} from '@/renderer/components/creator/workflows/creationDraftSnapshot';
import { useCreationDraftSession } from '@/renderer/components/creator/workflows/useCreationDraftSession';
import type { VideoDocumentCreationRequest } from '@/renderer/features/video-documents/VideoDocumentCreationStarter';

interface Options {
  data: BootstrapDto;
  documentWorkspaceActive: boolean;
  locale: Locale;
  location: CreatorLocation;
}

export function useCreatorSelectionSession({ data, documentWorkspaceActive, locale, location }: Options) {
  const creationSessions = useMemo(
    () => buildCreationSessionProjection(data.series, data.styleExplorationBatches),
    [data.series, data.styleExplorationBatches],
  );
  const contentSelection = useCreatorContentSelection(data, location);
  const initial = creatorInitialSession(data, location, creationSessions);
  const [creationMode, setCreationMode] = useState(initial.initialCreationMode);
  const [creationStartMode, setCreationStartMode] = useState(readCreationStartMode);
  const [videoCreationRequest, setVideoCreationRequest] = useState<VideoDocumentCreationRequest | null>(null);
  const [creationLibraryFilter, setCreationLibraryFilter] = useCreationLibraryFilter(documentWorkspaceActive);
  const [seriesId, setSeriesId] = useState<string | null>(initial.initialSeriesId);
  const [targetAlbumId, setTargetAlbumId] = useState<string | null>(
    location.surface === 'new-creation'
      ? location.albumId
      : (initial.initialInspirationItemAlbumId ??
          initial.initialInspirationStashAlbumId ??
          initial.initialDraft?.targetAlbumId ??
          null),
  );
  const targetAlbum = data.albums.find((album) => album.id === targetAlbumId) ?? null;
  const albumTree = useMemo(() => buildAlbumTreeIndex(data.albums), [data.albums]);
  const targetAlbumUnavailable = Boolean(
    targetAlbumId && (!targetAlbum || albumTree.effectivelyArchived.has(targetAlbumId)),
  );
  const captureCreationDraftRef = useRef<
    (targetAlbumOverride?: string | null, prompt?: CreationDraftPromptSnapshot) => CreationDraftSaveSnapshot
  >(() => {
    throw new Error('Creation draft projection is not ready');
  });
  const creationDraftSession = useCreationDraftSession({
    initialDraft: initial.initialDraft,
    captureSnapshot: (targetAlbumOverride, prompt) => captureCreationDraftRef.current(targetAlbumOverride, prompt),
  });
  const [inputSessionRevision, setInputSessionRevision] = useState(0);
  const workbenchProjection = useCreatorWorkbenchProjection({
    creationDraftId: creationDraftSession.draftId,
    creationMode,
    creationSessions,
    data,
    locale,
    selectedAlbumId: contentSelection.selectedAlbumId,
    selectedArticle: contentSelection.selectedArticle,
    selectedArticleId: contentSelection.selectedArticleId,
    selectedEvaluationSuiteAlbumId:
      contentSelection.selectedEvaluationSuiteItem?.albumId ??
      contentSelection.selectedEvaluationSuite?.albumId ??
      null,
    selectedEvaluationSuiteId: contentSelection.selectedEvaluationSuiteId,
    selectedIdeaCreationId: contentSelection.selectedIdeaCreationId,
    selectedImageBreakdownAlbumId: contentSelection.selectedImageBreakdownItem?.albumId ?? null,
    selectedImageBreakdownId: contentSelection.selectedImageBreakdownId,
    selectedSocialPost: contentSelection.selectedSocialPost,
    selectedSocialPostId: contentSelection.selectedSocialPostId,
    seriesId,
    targetAlbumId,
  });

  return {
    albumTree,
    captureCreationDraftRef,
    contentSelection,
    creationDraftSession,
    creationLibraryFilter,
    creationMode,
    creationSessions,
    creationStartMode,
    initial,
    inputSessionRevision,
    setCreationLibraryFilter,
    setCreationMode,
    setCreationStartMode,
    setInputSessionRevision,
    setSeriesId,
    setTargetAlbumId,
    setVideoCreationRequest,
    seriesId,
    targetAlbum,
    targetAlbumId,
    targetAlbumUnavailable,
    videoCreationRequest,
    workbenchProjection,
  };
}
