import type { Locale, VideoDocumentDto, VideoDocumentGenerationRunDto } from '@/shared/contracts';
import type { VideoDocumentStartConfiguration } from '@/renderer/features/video-documents/VideoDocumentStartDialog';

interface Options {
  configuration: VideoDocumentStartConfiguration;
  locale: Locale;
  importFailedLabel: string;
  transcriptRequiredLabel: string;
  notify(message: string): void;
  formatGenerationError(run: VideoDocumentGenerationRunDto): string;
}

export async function createVideoDocument({
  configuration,
  locale,
  importFailedLabel,
  transcriptRequiredLabel,
  notify,
  formatGenerationError,
}: Options): Promise<VideoDocumentDto> {
  const bytes = new Uint8Array(await configuration.file.arrayBuffer());
  const imported = await window.desktopApi.intakeCommit({
    intent: 'IMPORT',
    source: configuration.source,
    albumId: null,
    items: [
      {
        id: crypto.randomUUID(),
        kind: 'VIDEO',
        name: configuration.file.name,
        mimeType: configuration.mimeType,
        width: configuration.width,
        height: configuration.height,
        durationMs: configuration.durationMs,
        bytes,
      },
    ],
  });
  const videoMaterialId = imported.videoMaterialIds[0];
  if (!videoMaterialId) throw new Error(importFailedLabel);

  let document = await window.desktopApi.videoDocumentCreate({
    videoMaterialId,
    title: configuration.title,
    titleLocale: locale,
    albumId: configuration.albumId,
  });
  if (!configuration.generateArticle) return document;

  const transcript = document.branches.find((branch) => branch.role === 'CLEAN_TRANSCRIPT');
  if (!transcript?.latestDraftRevisionId && document.source.audio.status === 'HAS_AUDIO') {
    notify(transcriptRequiredLabel);
  }

  const result = await window.desktopApi.videoDocumentArticleGenerate({ documentId: document.id });
  if (result.revision) document = await window.desktopApi.videoDocumentGet(document.id);
  else notify(formatGenerationError(result.run));
  return document;
}
