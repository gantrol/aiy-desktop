import { useEffect, useState } from 'react';
import type {
  VideoDocumentBranchDto,
  VideoDocumentBranchRole,
  VideoDocumentDto,
  VideoDocumentExportFormat,
  VideoDocumentExportResult,
  VideoDocumentGenerationRunDto,
  VideoDocumentRevisionContent,
  VideoDocumentRevisionDto,
} from '@/shared/contracts';
import { VIDEO_DOCUMENT_SOURCE_REPLACEMENT_MAX_DURATION_DELTA_MS } from '@/shared/contracts/video-document';
import { intakeMediaMimeType, isIntakeVideoMimeType } from '@/renderer/features/intake/intakeImageFormats';
import { intakePreview, releaseIntakePreview } from '@/renderer/features/intake/intakePreview';

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

interface Options {
  document: VideoDocumentDto | null;
  selectedBranch: VideoDocumentBranchDto | null;
  activeRevision: {
    revision: VideoDocumentRevisionDto | null;
    setRevision(revision: VideoDocumentRevisionDto | null): void;
  };
  selectedDocumentIdRef: { current: string | null };
  labels: {
    transcriptRequired: string;
    generationBusy: string;
    modelUnavailable: string;
    generationFailed: string;
    exportFailed: string;
    audioProbeFailed: string;
    videoUnsupported: string;
    videoTooLarge: string;
    videoUnreadable: string;
    videoReplaceFailed: string;
    videoReplaceIncompatible: string;
    videoReplaceAlreadyUsed: string;
    videoReplaceSucceeded: string;
    exportSaved(fileName: string): string;
  };
  notify(message: string): void;
  formatGenerationError(run: VideoDocumentGenerationRunDto): string;
  formatExportError(result: Extract<VideoDocumentExportResult, { status: 'failed' }>): string;
  setDocument(document: VideoDocumentDto): void;
  setTitle(title: string): void;
  setActiveBranch(role: VideoDocumentBranchRole): void;
  updateSummary(document: VideoDocumentDto): void;
  refreshNavigation(): void;
  refreshAlbumPreviews(): void | Promise<void>;
}

interface GenerateArticleOptions {
  documentId?: string;
  noteId?: string | null;
  transcriptReady?: boolean;
  focusOnComplete?: boolean;
}

function articleGenerationNeedsTranscript(
  document: VideoDocumentDto,
  targetDocumentId: string,
  options: GenerateArticleOptions,
) {
  const transcript = document.branches.find((branch) => branch.role === 'CLEAN_TRANSCRIPT');
  return (
    !options.transcriptReady &&
    targetDocumentId === document.id &&
    !transcript?.latestDraftRevisionId &&
    document.source.audio.status === 'HAS_AUDIO'
  );
}

function articleGenerationFailureLabel(message: string, labels: Options['labels']) {
  if (message.includes('VIDEO_DOCUMENT_TRANSCRIPT_REQUIRED')) return labels.transcriptRequired;
  if (message.includes('VIDEO_DOCUMENT_GENERATION_BUSY')) return labels.generationBusy;
  if (message.includes('VIDEO_DOCUMENT_MODEL_UNAVAILABLE')) return labels.modelUnavailable;
  return labels.generationFailed;
}

export function useVideoDocumentContentActions({
  document,
  selectedBranch,
  activeRevision,
  selectedDocumentIdRef,
  labels,
  notify,
  formatGenerationError,
  formatExportError,
  setDocument,
  setTitle,
  setActiveBranch,
  updateSummary,
  refreshNavigation,
  refreshAlbumPreviews,
}: Options) {
  const [generating, setGenerating] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<VideoDocumentExportFormat | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [importingTranscript, setImportingTranscript] = useState(false);
  const [replacingVideo, setReplacingVideo] = useState(false);
  const [generationHistoryRefreshKey, setGenerationHistoryRefreshKey] = useState(0);
  const [lastExport, setLastExport] = useState<{ branchId: string; outputPath: string } | null>(null);

  useEffect(() => {
    setGenerationError(null);
    setLastExport(null);
  }, [document?.id]);

  async function importTranscript() {
    if (!document || importingTranscript) return false;
    const targetDocumentId = document.id;
    setImportingTranscript(true);
    try {
      const revision = await window.desktopApi.videoDocumentTranscriptImport(targetDocumentId);
      if (!revision) return false;
      const updated = await window.desktopApi.videoDocumentGet(targetDocumentId);
      if (selectedDocumentIdRef.current !== targetDocumentId) return true;
      setDocument(updated);
      setTitle(updated.title);
      setActiveBranch('CLEAN_TRANSCRIPT');
      updateSummary(updated);
      refreshNavigation();
      return true;
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      setImportingTranscript(false);
    }
  }

  async function saveRevision(content: VideoDocumentRevisionContent) {
    if (!document || !selectedBranch || (selectedBranch.latestDraftRevisionId && !activeRevision.revision)) {
      throw new Error('VIDEO_DOCUMENT_REVISION_UNAVAILABLE');
    }
    const targetDocumentId = document.id;
    const saved = await window.desktopApi.videoDocumentRevisionSave({
      branchId: selectedBranch.id,
      expectedParentRevisionId: activeRevision.revision?.id ?? null,
      content,
    });
    if (selectedDocumentIdRef.current !== targetDocumentId) return;
    activeRevision.setRevision(saved);
    const updated = await window.desktopApi.videoDocumentGet(targetDocumentId);
    if (selectedDocumentIdRef.current !== targetDocumentId) return;
    setDocument(updated);
    updateSummary(updated);
    refreshNavigation();
  }

  async function generateArticle(options: GenerateArticleOptions = {}) {
    if (!document || generating) return false;
    const targetDocumentId = options.documentId ?? document.id;
    if (articleGenerationNeedsTranscript(document, targetDocumentId, options)) {
      notify(labels.transcriptRequired);
      setActiveBranch('CLEAN_TRANSCRIPT');
      return false;
    }
    setGenerating(true);
    setGenerationError(null);
    try {
      const result = await window.desktopApi.videoDocumentArticleGenerate({
        documentId: targetDocumentId,
        noteId: options.noteId ?? null,
      });
      if (!result.revision) {
        if (selectedDocumentIdRef.current === targetDocumentId) {
          const failure = formatGenerationError(result.run);
          setGenerationError(failure);
          notify(failure);
          setActiveBranch('CLEAN_TRANSCRIPT');
        }
        return false;
      }
      const updated = await window.desktopApi.videoDocumentGet(targetDocumentId);
      void Promise.resolve(refreshAlbumPreviews()).catch((reason) => {
        notify(reason instanceof Error ? reason.message : String(reason));
        refreshNavigation();
      });
      if (selectedDocumentIdRef.current !== targetDocumentId) return true;
      setDocument(updated);
      setTitle(updated.title);
      if (options.focusOnComplete !== false) setActiveBranch('ARTICLE');
      updateSummary(updated);
      return true;
    } catch (reason) {
      if (selectedDocumentIdRef.current !== targetDocumentId) return false;
      const message = reason instanceof Error ? reason.message : String(reason);
      const failure = articleGenerationFailureLabel(message, labels);
      setGenerationError(failure);
      notify(failure);
      setActiveBranch('CLEAN_TRANSCRIPT');
      return false;
    } finally {
      setGenerating(false);
      setGenerationHistoryRefreshKey((value) => value + 1);
    }
  }

  async function exportDocument(format: VideoDocumentExportFormat, noteId: string | null = null) {
    const revision = activeRevision.revision;
    if (!document || !selectedBranch || !revision || exportingFormat) return;
    const targetDocumentId = document.id;
    setExportingFormat(format);
    try {
      const result = await window.desktopApi.videoDocumentExport({
        documentId: targetDocumentId,
        branchId: selectedBranch.id,
        revisionId: revision.id,
        noteId,
        format,
      });
      if (result.status === 'saved' && selectedDocumentIdRef.current === targetDocumentId) {
        setLastExport({ branchId: selectedBranch.id, outputPath: result.outputPath });
        notify(labels.exportSaved(result.fileName));
      } else if (result.status === 'failed' && selectedDocumentIdRef.current === targetDocumentId) {
        notify(formatExportError(result));
      }
    } catch {
      if (selectedDocumentIdRef.current === targetDocumentId) notify(labels.exportFailed);
    } finally {
      setExportingFormat(null);
    }
  }

  function recheckAudio() {
    if (!document) return;
    const targetDocumentId = document.id;
    void window.desktopApi
      .videoDocumentAudioProbe({ documentId: targetDocumentId, force: true })
      .then((updated) => {
        if (selectedDocumentIdRef.current === targetDocumentId) setDocument(updated);
      })
      .catch(() => notify(labels.audioProbeFailed));
  }

  async function replaceVideo(file: File) {
    if (!document || replacingVideo) return;
    const mimeType = intakeMediaMimeType(file);
    if (!mimeType || !isIntakeVideoMimeType(mimeType)) {
      notify(labels.videoUnsupported);
      return;
    }
    if (file.size <= 0 || file.size > MAX_VIDEO_BYTES) {
      notify(labels.videoTooLarge);
      return;
    }

    const targetDocument = document;
    let previewUrl = '';
    setReplacingVideo(true);
    try {
      let preview;
      try {
        preview = await intakePreview(file, true);
        previewUrl = preview.url;
      } catch {
        throw new Error('VIDEO_DOCUMENT_SOURCE_REPLACEMENT_UNREADABLE');
      }
      if (
        preview.width !== targetDocument.source.asset.width ||
        preview.height !== targetDocument.source.asset.height ||
        Math.abs((preview.durationMs ?? 0) - targetDocument.source.asset.durationMs) >
          VIDEO_DOCUMENT_SOURCE_REPLACEMENT_MAX_DURATION_DELTA_MS
      ) {
        throw new Error('VIDEO_DOCUMENT_SOURCE_REPLACEMENT_INCOMPATIBLE');
      }

      const imported = await window.desktopApi.intakeCommit({
        intent: 'IMPORT',
        source: 'UPLOAD',
        items: [
          {
            id: crypto.randomUUID(),
            kind: 'VIDEO',
            name: file.name,
            mimeType,
            width: preview.width,
            height: preview.height,
            durationMs: preview.durationMs ?? 0,
            bytes: new Uint8Array(await file.arrayBuffer()),
          },
        ],
      });
      const videoMaterialId = imported.videoMaterialIds[0];
      if (!videoMaterialId) throw new Error('VIDEO_DOCUMENT_SOURCE_REPLACEMENT_IMPORT_FAILED');
      const updated = await window.desktopApi.videoDocumentSourceReplace({
        documentId: targetDocument.id,
        videoMaterialId,
      });
      updateSummary(updated);
      refreshNavigation();
      if (selectedDocumentIdRef.current === targetDocument.id) {
        setDocument(updated);
        setTitle(updated.title);
      }
      notify(labels.videoReplaceSucceeded);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      notify(
        message.includes('VIDEO_DOCUMENT_SOURCE_REPLACEMENT_INCOMPATIBLE')
          ? labels.videoReplaceIncompatible
          : message.includes('VIDEO_DOCUMENT_SOURCE_REPLACEMENT_ALREADY_USED')
            ? labels.videoReplaceAlreadyUsed
            : message.includes('VIDEO_DOCUMENT_SOURCE_REPLACEMENT_UNREADABLE')
              ? labels.videoUnreadable
              : labels.videoReplaceFailed,
      );
    } finally {
      if (previewUrl) releaseIntakePreview(previewUrl);
      setReplacingVideo(false);
    }
  }

  function revealExport(outputPath: string) {
    void window.desktopApi.videoDocumentRevealExport({ outputPath }).catch(() => notify(labels.exportFailed));
  }

  return {
    generating,
    exportingFormat,
    generationError,
    importingTranscript,
    replacingVideo,
    generationHistoryRefreshKey,
    lastExport,
    importTranscript,
    saveRevision,
    generateArticle,
    exportDocument,
    replaceVideo,
    recheckAudio,
    revealExport,
  };
}
