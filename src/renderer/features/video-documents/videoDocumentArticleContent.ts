import type { VideoDocumentRevisionContent } from '@/shared/contracts';

export function videoDocumentArticleHasVisibleContent(markdown: string) {
  const firstLineEnd = markdown.indexOf('\n');
  const firstLine = firstLineEnd < 0 ? markdown : markdown.slice(0, firstLineEnd);
  const body = /^[\t ]*#[\t ]/.test(firstLine) ? (firstLineEnd < 0 ? '' : markdown.slice(firstLineEnd + 1)) : markdown;
  return body.trim().length > 0;
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
