import type { VideoDocumentRevisionContent } from '@/shared/contracts';

const hiddenArticleTitlePattern = /^[\t ]*#[\t ]+[^\r\n]*(?:\r?\n|$)/;

export function videoDocumentArticleHasVisibleContent(markdown: string) {
  return markdown.replace(hiddenArticleTitlePattern, '').trim().length > 0;
}

export function selectVideoDocumentArticle(
  content: VideoDocumentRevisionContent | null | undefined,
  noteId: string | null | undefined,
) {
  if (content?.format === 'MARKDOWN') return { noteId: null, markdown: content.markdown };
  if (content?.format !== 'NOTE_COLLECTION') return null;
  const note = content.notes.find((candidate) => candidate.id === (noteId ?? content.defaultNoteId));
  const selectedNote = note ?? content.notes.find((candidate) => candidate.id === content.defaultNoteId);
  return selectedNote ? { noteId: selectedNote.id, markdown: selectedNote.markdown } : null;
}
