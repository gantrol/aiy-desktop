import { PencilIcon } from 'lucide-react';
import { useState } from 'react';
import type { VideoDocumentRichNote } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { cn } from '@/renderer/lib/utils';

interface Props {
  notes: readonly VideoDocumentRichNote[];
  activeNoteId: string;
  renameLabel: string;
  onSelect(noteId: string): void;
  onRename(noteId: string, title: string): Promise<void>;
}

export function VideoDocumentNoteList({ notes, activeNoteId, renameLabel, onSelect, onRename }: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  async function saveRename(noteId: string) {
    const nextTitle = title.trim();
    if (!nextTitle || saving) return;
    setSaving(true);
    try {
      await onRename(noteId, nextTitle);
      setRenamingId(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div role="list" className="divide-y border-y">
      {notes.map((note) => (
        <div key={note.id} role="listitem" className="group/note flex min-h-14 items-center gap-2 px-2">
          {renamingId === note.id ? (
            <Input
              value={title}
              autoFocus
              className="h-8 min-w-0 flex-1"
              aria-label={renameLabel}
              disabled={saving}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => void saveRename(note.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void saveRename(note.id);
                } else if (event.key === 'Escape') {
                  setRenamingId(null);
                }
              }}
            />
          ) : (
            <Button
              type="button"
              variant="ghost"
              className={cn(
                'h-auto min-w-0 flex-1 justify-start rounded-none px-2 py-2 text-left font-normal',
                note.id === activeNoteId &&
                  'border-l-2 border-l-selected-foreground bg-selected/45 text-selected-foreground',
              )}
              onClick={() => onSelect(note.id)}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{note.title}</span>
                <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
                  {new Date(note.updatedAt).toLocaleString()}
                </span>
              </span>
            </Button>
          )}
          {renamingId !== note.id && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="opacity-0 transition-opacity group-hover/note:opacity-100 focus-visible:opacity-100"
              title={renameLabel}
              aria-label={renameLabel}
              onClick={() => {
                setTitle(note.title);
                setRenamingId(note.id);
              }}
            >
              <PencilIcon className="size-3.5" />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
