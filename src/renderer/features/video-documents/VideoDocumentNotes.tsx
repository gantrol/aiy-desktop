import { CheckIcon, LoaderCircleIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  VideoDocumentNote,
  VideoDocumentRevisionContent,
  VideoDocumentRevisionDto,
  VideoDocumentTimelineSegment,
} from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Textarea } from '@/renderer/components/ui/textarea';
import { VideoDocumentTimeline } from '@/renderer/features/video-documents/VideoDocumentTimeline';

interface Labels {
  timeline: string;
  time: string;
  text: string;
  add: string;
  save: string;
  remove: string;
  invalidTime: string;
  saveFailed: string;
  openAt(time: string): string;
}

interface Props {
  revision: VideoDocumentRevisionDto | null;
  currentTimeMs: number;
  durationMs: number;
  segments: readonly VideoDocumentTimelineSegment[];
  labels: Labels;
  onSave(content: VideoDocumentRevisionContent): Promise<void>;
  onSeek(timestampMs: number): void;
}

function formatTimestamp(timestampMs: number) {
  const totalSeconds = Math.max(0, Math.floor(timestampMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function parseTimestamp(value: string) {
  const parts = value.trim().split(':');
  if (!parts.length || parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d{1,3})?$/.test(part))) return null;
  const seconds = parts.map(Number).reduce((total, part) => total * 60 + part, 0);
  return Number.isFinite(seconds) ? Math.round(seconds * 1_000) : null;
}

function orderedNotes(notes: readonly VideoDocumentNote[]) {
  return [...notes].sort((left, right) => left.timestampMs - right.timestampMs || left.id.localeCompare(right.id));
}

interface NoteRowProps {
  note: VideoDocumentNote;
  draft: NoteDraft;
  durationMs: number;
  saving: boolean;
  labels: Labels;
  onSeek(timestampMs: number): void;
  onDraftChange(draft: NoteDraft): void;
  onCommit(note: VideoDocumentNote): Promise<void>;
  onRemove(): void;
}

interface NoteDraft {
  time: string;
  text: string;
}

const NOTE_PAGE_SIZE = 100;

function draftForNote(note: VideoDocumentNote): NoteDraft {
  return { time: formatTimestamp(note.timestampMs), text: note.text };
}

function NoteRow({ note, draft, durationMs, saving, labels, onSeek, onDraftChange, onCommit, onRemove }: NoteRowProps) {
  const timestampMs = parseTimestamp(draft.time);
  const validTime = timestampMs !== null && timestampMs >= 0 && timestampMs <= durationMs;
  const dirty = draft.text.trim() !== note.text || timestampMs !== note.timestampMs;
  return (
    <div className="group/note grid grid-cols-[4.75rem_minmax(0,1fr)_auto] items-start gap-3 border-b py-3">
      <div className="grid gap-1">
        <Input
          value={draft.time}
          className="h-7 border-0 bg-transparent px-0 font-mono text-xs tabular-nums text-selected-foreground shadow-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-label={labels.time}
          aria-invalid={!validTime}
          onChange={(event) => onDraftChange({ ...draft, time: event.target.value })}
        />
        <button
          type="button"
          className="w-fit text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => onSeek(note.timestampMs)}
        >
          {formatTimestamp(note.timestampMs)}
        </button>
      </div>
      <Textarea
        value={draft.text}
        className="min-h-10 resize-none border-0 bg-transparent px-0 py-1 text-sm leading-6 shadow-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={labels.text}
        onChange={(event) => onDraftChange({ ...draft, text: event.target.value })}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && dirty && validTime && draft.text.trim()) {
            event.preventDefault();
            void onCommit({ ...note, timestampMs: timestampMs!, text: draft.text.trim() });
          }
        }}
      />
      <div className="flex opacity-0 transition-opacity group-hover/note:opacity-100 focus-within:opacity-100">
        {dirty && validTime && draft.text.trim() && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={saving}
            title={labels.save}
            aria-label={labels.save}
            onClick={() => void onCommit({ ...note, timestampMs: timestampMs!, text: draft.text.trim() })}
          >
            <CheckIcon className="size-3.5" />
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={saving}
          title={labels.remove}
          aria-label={labels.remove}
          onClick={onRemove}
        >
          <Trash2Icon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function VideoDocumentNotes({ revision, currentTimeMs, durationMs, segments, labels, onSave, onSeek }: Props) {
  const content = revision?.content.format === 'TIMED_NOTES' ? revision.content : null;
  const [notes, setNotes] = useState<VideoDocumentNote[]>(content?.notes ?? []);
  const [noteDrafts, setNoteDrafts] = useState<ReadonlyMap<string, NoteDraft>>(new Map());
  const [notePage, setNotePage] = useState(0);
  const [draftTime, setDraftTime] = useState(formatTimestamp(currentTimeMs));
  const [draftText, setDraftText] = useState('');
  const [timeEdited, setTimeEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const nextNotes = content?.notes ?? [];
    const nextNoteIds = new Set(nextNotes.map((note) => note.id));
    setNotes(nextNotes);
    setNoteDrafts((current) => {
      const next = new Map([...current].filter(([noteId]) => nextNoteIds.has(noteId)));
      return next.size === current.size ? current : next;
    });
    setError('');
  }, [content?.notes, revision?.id]);

  useEffect(() => {
    if (!timeEdited && !draftText.trim()) setDraftTime(formatTimestamp(currentTimeMs));
  }, [currentTimeMs, draftText, timeEdited]);

  const markers = useMemo(
    () => notes.map((note) => ({ id: note.id, timestampMs: note.timestampMs, title: note.text })),
    [notes],
  );
  const notePages = useMemo(
    () =>
      Array.from({ length: Math.ceil(notes.length / NOTE_PAGE_SIZE) }, (_, page) => {
        const start = page * NOTE_PAGE_SIZE;
        const end = Math.min(notes.length, start + NOTE_PAGE_SIZE) - 1;
        return {
          page,
          label: `${start + 1}-${end + 1} / ${formatTimestamp(notes[start]!.timestampMs)}-${formatTimestamp(notes[end]!.timestampMs)}`,
        };
      }),
    [notes],
  );
  const activeNotePage = Math.min(notePage, Math.max(0, notePages.length - 1));
  const visibleNotes = notes.slice(activeNotePage * NOTE_PAGE_SIZE, (activeNotePage + 1) * NOTE_PAGE_SIZE);

  async function commit(nextNotes: readonly VideoDocumentNote[]) {
    if (saving) return false;
    const next = orderedNotes(nextNotes);
    setSaving(true);
    setError('');
    try {
      await onSave({ schemaVersion: 1, format: 'TIMED_NOTES', notes: next });
      setNotes(next);
      return true;
    } catch {
      setError(labels.saveFailed);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function addNote() {
    const timestampMs = parseTimestamp(draftTime);
    const text = draftText.trim();
    if (timestampMs === null || timestampMs < 0 || timestampMs > durationMs) {
      setError(labels.invalidTime);
      return;
    }
    if (!text || saving) return;
    const note = { id: crypto.randomUUID(), timestampMs, text };
    const nextNotes = orderedNotes([...notes, note]);
    if (await commit(nextNotes)) {
      setNotePage(Math.floor(nextNotes.findIndex((candidate) => candidate.id === note.id) / NOTE_PAGE_SIZE));
      setDraftText('');
      setTimeEdited(false);
      setDraftTime(formatTimestamp(currentTimeMs));
    }
  }

  return (
    <section className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-3">
      <VideoDocumentTimeline
        durationMs={durationMs}
        currentTimeMs={currentTimeMs}
        segments={segments}
        markers={markers}
        ariaLabel={labels.timeline}
        openAtLabel={labels.openAt}
        onSeek={onSeek}
      />
      <div className="min-w-0">
        <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-start gap-3 border-b pb-3">
          <Input
            value={draftTime}
            className="h-9 font-mono text-xs tabular-nums"
            aria-label={labels.time}
            onChange={(event) => {
              setDraftTime(event.target.value);
              setTimeEdited(true);
            }}
          />
          <Textarea
            value={draftText}
            className="min-h-9 resize-none py-2 text-sm"
            aria-label={labels.text}
            onChange={(event) => setDraftText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                void addNote();
              }
            }}
          />
          <Button
            type="button"
            size="icon"
            className="size-9"
            disabled={saving || !draftText.trim()}
            title={labels.add}
            aria-label={labels.add}
            onClick={() => void addNote()}
          >
            {saving ? <LoaderCircleIcon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}
          </Button>
        </div>
        {error && <p className="border-b py-2 text-xs text-destructive">{error}</p>}
        {notePages.length > 1 && (
          <div className="flex justify-end border-b py-2">
            <Select value={String(activeNotePage)} onValueChange={(value) => setNotePage(Number(value))}>
              <SelectTrigger className="h-8 w-40 font-mono text-xs tabular-nums" aria-label={labels.time}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {notePages.map((page) => (
                  <SelectItem key={page.page} value={String(page.page)}>
                    {page.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div role="list">
          {visibleNotes.map((note, visibleIndex) => {
            const noteIndex = activeNotePage * NOTE_PAGE_SIZE + visibleIndex;
            const noteDraft = noteDrafts.get(note.id) ?? draftForNote(note);
            return (
              <div key={note.id} role="listitem" aria-posinset={noteIndex + 1} aria-setsize={notes.length}>
                <NoteRow
                  note={note}
                  draft={noteDraft}
                  durationMs={durationMs}
                  saving={saving}
                  labels={labels}
                  onSeek={onSeek}
                  onDraftChange={(nextDraft) => {
                    setNoteDrafts((current) => new Map(current).set(note.id, nextDraft));
                  }}
                  onCommit={async (updated) => {
                    const nextNotes = orderedNotes(
                      notes.map((candidate) => (candidate.id === note.id ? updated : candidate)),
                    );
                    if (await commit(nextNotes)) {
                      setNotePage(
                        Math.floor(nextNotes.findIndex((candidate) => candidate.id === note.id) / NOTE_PAGE_SIZE),
                      );
                      setNoteDrafts((current) => {
                        const nextDrafts = new Map(current);
                        nextDrafts.delete(note.id);
                        return nextDrafts;
                      });
                    }
                  }}
                  onRemove={() => {
                    void commit(notes.filter((candidate) => candidate.id !== note.id)).then((saved) => {
                      if (!saved) return;
                      setNoteDrafts((current) => {
                        const nextDrafts = new Map(current);
                        nextDrafts.delete(note.id);
                        return nextDrafts;
                      });
                    });
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
