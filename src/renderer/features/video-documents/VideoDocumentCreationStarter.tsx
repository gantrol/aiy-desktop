import { useEffect, useRef, useState } from 'react';
import type { AlbumDto, GalleryItemDto, Locale, VideoDocumentGenerationRunDto } from '@/shared/contracts';
import { materialTitle, mediaMaterial } from '@/renderer/components/gallery/materialLibraryTypes';
import { createVideoDocument } from '@/renderer/features/video-documents/createVideoDocument';
import { VideoDocumentCreationSettings } from '@/renderer/features/video-documents/VideoDocumentCreationSettings';
import { VideoFileInput } from '@/renderer/features/video-documents/VideoDocumentFileInputs';
import { VideoDocumentRecentVideos } from '@/renderer/features/video-documents/VideoDocumentRecentVideos';
import { VideoDocumentSourcePicker } from '@/renderer/features/video-documents/VideoDocumentSourcePicker';
import {
  formatVideoDocumentDuration,
  formatVideoDocumentFileSize,
  useVideoDocumentLocalFile,
  videoDocumentFileStem,
} from '@/renderer/features/video-documents/useVideoDocumentLocalFile';
import { useRecentVideoMaterials } from '@/renderer/features/video-documents/useRecentVideoMaterials';
import { useI18n } from '@/renderer/i18n/useI18n';

export interface VideoDocumentCreationRequest {
  file: File;
  source: 'DROP' | 'UPLOAD';
}

interface Props {
  locale: Locale;
  albums: AlbumDto[];
  defaultAlbumId: string | null;
  request: VideoDocumentCreationRequest | null;
  onRequestChange(request: VideoDocumentCreationRequest | null): void;
  onLibraryChange(): void | Promise<void>;
  onCreated(documentId: string, albumId: string | null): void;
  notify(message: string): void;
}

type VideoDocumentLabels = ReturnType<typeof useI18n>['messages']['videoDocuments'];

function generationErrorLabel(run: VideoDocumentGenerationRunDto, labels: VideoDocumentLabels) {
  switch (run.errorCode) {
    case 'VIDEO_DOCUMENT_TRANSCRIPT_REQUIRED':
      return labels.generation.transcriptRequired;
    case 'VIDEO_DOCUMENT_GENERATION_BUSY':
      return labels.generation.busy;
    case 'VIDEO_DOCUMENT_MODEL_UNAVAILABLE':
    case 'VIDEO_DOCUMENT_REASONING_UNAVAILABLE':
      return labels.generation.modelUnavailable;
    case 'VIDEO_DOCUMENT_CODEX_NOT_LOGGED_IN':
      return labels.generation.notLoggedIn;
    case 'VIDEO_DOCUMENT_RATE_LIMITED':
      return labels.generation.rateLimited(
        run.errorDetails?.resetAt ? new Date(run.errorDetails.resetAt).toLocaleString() : null,
      );
    case 'VIDEO_DOCUMENT_CREDITS_DEPLETED':
      return labels.generation.creditsDepleted;
    case 'VIDEO_DOCUMENT_WORKSPACE_USAGE_LIMIT':
      return labels.generation.workspaceUsageLimit;
    case 'EMPTY_RESPONSE':
      return labels.generation.emptyResponse;
    case 'VIDEO_DOCUMENT_MODEL_OUTPUT_INVALID':
      return labels.generation.invalidOutput;
    case 'INTERRUPTED':
    case 'CANCELLED':
      return labels.generation.interrupted;
    default:
      return labels.generation.failed;
  }
}

export function VideoDocumentCreationStarter({
  locale,
  albums,
  defaultAlbumId,
  request,
  onRequestChange,
  onLibraryChange,
  onCreated,
  notify,
}: Props) {
  const labels = useI18n().messages.videoDocuments;
  const inputRef = useRef<HTMLInputElement>(null);
  const localVideo = useVideoDocumentLocalFile(request?.file ?? null, Boolean(request), labels.start);
  const recentVideos = useRecentVideoMaterials(locale);
  const [selectedGalleryVideo, setSelectedGalleryVideo] = useState<GalleryItemDto | null>(null);
  const [title, setTitle] = useState('');
  const [albumId, setAlbumId] = useState<string | null>(defaultAlbumId);
  const [openAfterCreate, setOpenAfterCreate] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    setAlbumId(defaultAlbumId);
  }, [defaultAlbumId]);

  useEffect(() => {
    if (!request) return;
    setSelectedGalleryVideo(null);
    setTitle(videoDocumentFileStem(request.file.name));
    setSubmitError('');
  }, [request]);

  const hasSource = Boolean(request || selectedGalleryVideo);
  const canCreate = Boolean(
    title.trim() &&
    !localVideo.reading &&
    !localVideo.error &&
    ((request && localVideo.mediaInfo) || selectedGalleryVideo?.materialId),
  );
  const localDetails = request
    ? [
        formatVideoDocumentFileSize(request.file.size),
        localVideo.mediaInfo
          ? `${formatVideoDocumentDuration(localVideo.mediaInfo.durationMs)} · ${localVideo.mediaInfo.width}×${localVideo.mediaInfo.height}`
          : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  function chooseGalleryVideo(item: GalleryItemDto) {
    if (!item.materialId) return;
    onRequestChange(null);
    setSelectedGalleryVideo(item);
    setTitle(materialTitle(mediaMaterial(item), labels.start.sourceVideoFallback));
    setSubmitError('');
  }

  function clearSelection() {
    onRequestChange(null);
    setSelectedGalleryVideo(null);
    setTitle('');
    setSubmitError('');
  }

  async function refreshLibrary() {
    try {
      await Promise.resolve(onLibraryChange());
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function createAlbum(title: string, parentAlbumId: string | null) {
    const created = await window.desktopApi.albumsCreate({ title, titleLocale: locale, parentAlbumId });
    await refreshLibrary();
    return created;
  }

  async function submit() {
    const nextTitle = title.trim();
    if (!canCreate || !nextTitle || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const document = selectedGalleryVideo?.materialId
        ? await window.desktopApi.videoDocumentCreate({
            videoMaterialId: selectedGalleryVideo.materialId,
            title: nextTitle,
            titleLocale: locale,
            albumId,
          })
        : request && localVideo.mediaInfo
          ? await createVideoDocument({
              configuration: {
                file: request.file,
                source: request.source,
                ...localVideo.mediaInfo,
                title: nextTitle,
                albumId,
                generateArticle: false,
              },
              locale,
              importFailedLabel: labels.start.failed,
              transcriptRequiredLabel: labels.generation.transcriptRequired,
              notify,
              formatGenerationError: (run) => generationErrorLabel(run, labels),
            })
          : null;
      if (!document) return;
      await refreshLibrary();
      if (openAfterCreate) onCreated(document.id, document.albumId);
      else {
        clearSelection();
        notify(labels.start.created);
      }
    } catch (reason) {
      setSubmitError(reason instanceof Error && reason.message ? reason.message : labels.start.failed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-sunken/20">
      <VideoFileInput inputRef={inputRef} onSelect={(file) => onRequestChange({ file, source: 'UPLOAD' })} />
      <div className="mx-auto grid w-full max-w-[1240px] gap-5 p-5 xl:p-7">
        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <VideoDocumentSourcePicker
            inputRef={inputRef}
            localFile={request?.file ?? null}
            selectedGalleryVideo={selectedGalleryVideo}
            localSourceUrl={localVideo.sourceUrl}
            localReading={localVideo.reading}
            localDetails={localDetails}
            localError={localVideo.error}
            galleryVideos={recentVideos.items}
            galleryLoading={recentVideos.loading}
            disabled={submitting}
            onChooseGalleryVideo={chooseGalleryVideo}
            onClear={clearSelection}
          />
          <VideoDocumentCreationSettings
            albums={albums}
            title={title}
            albumId={albumId}
            hasSource={hasSource}
            openAfterCreate={openAfterCreate}
            canCreate={canCreate}
            submitting={submitting}
            error={submitError}
            onTitleChange={setTitle}
            onAlbumChange={setAlbumId}
            onOpenAfterCreateChange={setOpenAfterCreate}
            onCreateAlbum={createAlbum}
            onSubmit={submit}
          />
        </div>
        <VideoDocumentRecentVideos
          locale={locale}
          items={recentVideos.items}
          loading={recentVideos.loading}
          selectedMaterialId={selectedGalleryVideo?.materialId ?? null}
          onSelect={chooseGalleryVideo}
        />
      </div>
    </div>
  );
}
