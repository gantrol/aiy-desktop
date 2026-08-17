import { useEffect, useMemo, useState } from 'react';
import type {
  VideoDocumentMediaBinding,
  VideoDocumentRevisionContent,
  VideoDocumentRevisionDto,
  VideoDocumentRichNote,
} from '@/shared/contracts';

const DEFAULT_NOTE_ID = 'default';

function markdownTitle(markdown: string, fallback: string) {
  const match = /^#\s+(.+?)\s*#*\s*$/m.exec(markdown);
  return match?.[1]?.trim() || fallback;
}

function legacyRichNote(
  content: Extract<VideoDocumentRevisionContent, { format: 'MARKDOWN' }>,
  documentTitle: string,
  createdAt: string,
): VideoDocumentRichNote {
  return {
    id: DEFAULT_NOTE_ID,
    title: markdownTitle(content.markdown, documentTitle),
    markdown: content.markdown,
    transcriptBasis: content.transcriptBasis,
    sourceUrl: content.sourceUrl,
    generation: content.generation,
    mediaBindings: content.mediaBindings,
    timelineSegments: content.timelineSegments,
    createdAt,
    updatedAt: createdAt,
  };
}

function markdownContentFromNote(
  note: VideoDocumentRichNote,
): Extract<VideoDocumentRevisionContent, { format: 'MARKDOWN' }> {
  return {
    schemaVersion: 1,
    format: 'MARKDOWN',
    markdown: note.markdown,
    transcriptBasis: note.transcriptBasis,
    sourceUrl: note.sourceUrl,
    generation: note.generation,
    mediaBindings: note.mediaBindings,
    timelineSegments: note.timelineSegments,
  };
}

interface Options {
  revision: VideoDocumentRevisionDto;
  documentTitle: string;
  activeNoteId?: string | null;
  untitledLabel: string;
  onActiveNoteChange?(noteId: string): void;
  onSave?(content: VideoDocumentRevisionContent): Promise<void>;
}

export function useVideoDocumentRichNotes({
  revision,
  documentTitle,
  activeNoteId,
  untitledLabel,
  onActiveNoteChange,
  onSave,
}: Options) {
  const collection = revision.content.format === 'NOTE_COLLECTION' ? revision.content : null;
  const notes = useMemo(() => {
    if (revision.content.format === 'NOTE_COLLECTION') return revision.content.notes;
    if (revision.content.format === 'MARKDOWN') {
      return [legacyRichNote(revision.content, documentTitle || revision.id, revision.createdAt)];
    }
    return [];
  }, [documentTitle, revision.content, revision.createdAt, revision.id]);
  const defaultNoteId = collection?.defaultNoteId ?? notes[0]?.id ?? DEFAULT_NOTE_ID;
  const selectedNote =
    notes.find((note) => note.id === activeNoteId) ?? notes.find((note) => note.id === defaultNoteId) ?? null;
  const selectedNoteId = selectedNote?.id ?? defaultNoteId;
  const content = selectedNote ? markdownContentFromNote(selectedNote) : null;
  const [mutating, setMutating] = useState(false);

  useEffect(() => {
    if (selectedNote && activeNoteId !== selectedNote.id) onActiveNoteChange?.(selectedNote.id);
  }, [activeNoteId, onActiveNoteChange, selectedNote]);

  function collectionContent(nextNotes: VideoDocumentRichNote[]): VideoDocumentRevisionContent {
    return { schemaVersion: 2, format: 'NOTE_COLLECTION', defaultNoteId, notes: nextNotes };
  }

  function contentForCurrentNote(markdown: string, mediaBindings: VideoDocumentMediaBinding[]) {
    if (!selectedNote || !content) throw new Error('VIDEO_DOCUMENT_NOTE_UNAVAILABLE');
    const updatedNote: VideoDocumentRichNote = {
      ...selectedNote,
      markdown,
      mediaBindings,
      updatedAt: new Date().toISOString(),
    };
    return collection
      ? collectionContent(notes.map((note) => (note.id === updatedNote.id ? updatedNote : note)))
      : { ...content, markdown, mediaBindings };
  }

  async function createNote() {
    if (!onSave || mutating) return null;
    const timestamp = new Date().toISOString();
    const title = notes.some((note) => note.title === untitledLabel)
      ? `${untitledLabel} ${notes.length + 1}`
      : untitledLabel;
    const note: VideoDocumentRichNote = {
      id: crypto.randomUUID(),
      title,
      markdown: `# ${title}\n`,
      transcriptBasis: selectedNote?.transcriptBasis ?? 'NONE',
      sourceUrl: selectedNote?.sourceUrl ?? null,
      generation: null,
      mediaBindings: [],
      timelineSegments: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    setMutating(true);
    try {
      await onSave(collectionContent([...notes, note]));
      onActiveNoteChange?.(note.id);
      return note.id;
    } finally {
      setMutating(false);
    }
  }

  async function renameNote(noteId: string, title: string) {
    if (!onSave || mutating) return;
    const updatedAt = new Date().toISOString();
    setMutating(true);
    try {
      await onSave(collectionContent(notes.map((note) => (note.id === noteId ? { ...note, title, updatedAt } : note))));
    } finally {
      setMutating(false);
    }
  }

  return {
    collection,
    notes,
    selectedNote,
    selectedNoteId,
    content,
    mutating,
    contentForCurrentNote,
    createNote,
    renameNote,
  };
}
