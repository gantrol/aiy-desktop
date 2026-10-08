import { useEffect, useRef, useState } from 'react';
import type {
  AlbumDto,
  CreationVideoAttachmentDto,
  GalleryItemDto,
  Locale,
  VideoDocumentGenerationRunDto,
} from '@/shared/contracts';
import { materialTitle, mediaMaterial } from '@/renderer/components/gallery/materialLibraryTypes';
import { createVideoDocument } from '@/renderer/features/video-documents/createVideoDocument';
import { VideoDocumentCreationSettings } from '@/renderer/features/video-documents/VideoDocumentCreationSettings';
import { VideoFileInput } from '@/renderer/features/video-documents/VideoDocumentFileInputs';
import { VideoDocumentRecentVideos } from '@/renderer/features/video-documents/VideoDocumentRecentVideos';
import {
  VideoDocumentAttachedSources,
  VideoDocumentSourcePicker,
  type VideoDocumentSelectedSource,
} from '@/renderer/features/video-documents/VideoDocumentSourcePicker';
import {
  formatVideoDocumentDuration,
  formatVideoDocumentFileSize,
  useVideoDocumentLocalFile,
} from '@/renderer/features/video-documents/useVideoDocumentLocalFile';
import { useRecentVideoMaterials } from '@/renderer/features/video-documents/useRecentVideoMaterials';
import { useI18n } from '@/renderer/i18n/useI18n';

export interface VideoDocumentCreationRequest {
  file: File;
  source: 'DROP' | 'UPLOAD';
}

interface Props {
  beforeCreate?(): Promise<import('@/shared/contracts/creation-source').CreationSource | undefined>;
  locale: Locale;
  albums: AlbumDto[];
  defaultAlbumId: string | null;
  request: VideoDocumentCreationRequest | null;
  attachedVideos?: readonly CreationVideoAttachmentDto[];
  onRemoveAttachedVideo?(materialId: string): void;
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
  beforeCreate,
  locale,
  albums,
  defaultAlbumId,
  request,
  attachedVideos = [],
  onRemoveAttachedVideo,
  onRequestChange,
  onLibraryChange,
  onCreated,
  notify,
}: Props) {
  const labels = useI18n().messages.videoDocuments;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const inputRef = useRef<HTMLInputElement>(null);
  const localVideo = useVideoDocumentLocalFile(request?.file ?? null, Boolean(request), labels.start);
  const recentVideos = useRecentVideoMaterials(locale);
  const [selectedGalleryVideo, setSelectedGalleryVideo] = useState<GalleryItemDto | null>(null);
  const [attachedMaterialId, setAttachedMaterialId] = useState<string | null>(() =>
    !request && attachedVideos.length === 1 ? attachedVideos[0].materialId : null,
  );
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
    setAttachedMaterialId(null);
    setTitle('');
    setSubmitError('');
  }, [request]);

  const attachedVideo = attachedVideos.find((video) => video.materialId === attachedMaterialId);
  const selectedVideo: VideoDocumentSelectedSource | null = selectedGalleryVideo?.materialId
    ? {
        materialId: selectedGalleryVideo.materialId,
        asset: selectedGalleryVideo.asset,
        title: materialTitle(mediaMaterial(selectedGalleryVideo), labels.start.sourceVideoFallback),
      }
    : attachedVideo
      ? { materialId: attachedVideo.materialId, asset: attachedVideo.asset, title: attachedVideo.name }
      : null;
  const hasSource = Boolean(request || selectedVideo);
  const canCreate = Boolean(
    !localVideo.reading && !localVideo.error && ((request && localVideo.mediaInfo) || selectedVideo),
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
    if (!item.materialId || submitting) return;
    onRequestChange(null);
    setAttachedMaterialId(null);
    setSelectedGalleryVideo(item);
    setTitle('');
    setSubmitError('');
  }

  function clearSelection() {
    onRequestChange(null);
    setSelectedGalleryVideo(null);
    setAttachedMaterialId(null);
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
    if (!canCreate || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const creationSource = await beforeCreate?.();
      if (!mounted.current) return;
      const document = selectedVideo
        ? await window.desktopApi.videoDocumentCreate({
            videoMaterialId: selectedVideo.materialId,
            title: nextTitle,
            titleLocale: locale,
            albumId,
            creationSource,
          })
        : request && localVideo.mediaInfo
          ? await createVideoDocument({
              creationSource,
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
      if (!mounted.current) return;
      if (openAfterCreate) onCreated(document.id, document.albumId);
      else {
        clearSelection();
        notify(labels.start.created);
      }
    } catch (reason) {
      if (mounted.current)
        setSubmitError(reason instanceof Error && reason.message ? reason.message : labels.start.failed);
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-sunken/20">
      <VideoFileInput inputRef={inputRef} onSelect={(file) => onRequestChange({ file, source: 'UPLOAD' })} />
      <div className="mx-auto grid w-full max-w-[1240px] gap-5 p-5 xl:p-7">
        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="grid min-w-0 content-start gap-3">
            <VideoDocumentAttachedSources
              videos={attachedVideos}
              selectedMaterialId={selectedVideo?.materialId ?? null}
              disabled={submitting}
              onRemove={onRemoveAttachedVideo}
              onSelect={(materialId) => {
                if (submitting) return;
                clearSelection();
                setAttachedMaterialId(materialId);
              }}
            />
            <VideoDocumentSourcePicker
              inputRef={inputRef}
              localFile={request?.file ?? null}
              selectedVideo={selectedVideo}
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
          </div>
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
          selectedMaterialId={selectedVideo?.materialId ?? null}
          onSelect={chooseGalleryVideo}
        />
      </div>
    </div>
  );
}
