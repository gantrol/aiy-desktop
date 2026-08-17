import type { VideoDocumentDto, VideoDocumentRevisionDto } from '@/shared/contracts/video-document';

interface Selection {
  document: VideoDocumentDto;
  revision: VideoDocumentRevisionDto;
}

export function selectVideoDocumentExportNote(
  document: VideoDocumentDto,
  revision: VideoDocumentRevisionDto,
  noteId?: string | null,
): Selection | null {
  if (revision.content.format !== 'NOTE_COLLECTION') return { document, revision };
  const collection = revision.content;
  const note = collection.notes.find((candidate) => candidate.id === (noteId ?? collection.defaultNoteId));
  if (!note) return null;
  return {
    document: { ...document, title: note.title },
    revision: {
      ...revision,
      content: {
        schemaVersion: 1,
        format: 'MARKDOWN',
        markdown: note.markdown,
        transcriptBasis: note.transcriptBasis,
        sourceUrl: note.sourceUrl,
        generation: note.generation,
        mediaBindings: note.mediaBindings,
        timelineSegments: note.timelineSegments,
      },
    },
  };
}
