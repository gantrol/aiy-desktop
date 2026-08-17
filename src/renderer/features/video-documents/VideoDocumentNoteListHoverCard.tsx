import { FilesIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { VideoDocumentRichNote } from '@/shared/contracts';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/renderer/components/ui/hover-card';
import { VideoDocumentNoteList } from '@/renderer/features/video-documents/VideoDocumentNoteList';
import { VideoDocumentToolbarAction } from '@/renderer/features/video-documents/VideoDocumentToolbar';

interface Props {
  notes: readonly VideoDocumentRichNote[];
  activeNoteId: string;
  label: string;
  renameLabel: string;
  disabled: boolean;
  onSelect(noteId: string): void;
  onRename(noteId: string, title: string): Promise<void>;
}

export function VideoDocumentNoteListHoverCard({
  notes,
  activeNoteId,
  label,
  renameLabel,
  disabled,
  onSelect,
  onRename,
}: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <HoverCard open={open} openDelay={0} closeDelay={120} onOpenChange={setOpen}>
      <HoverCardTrigger asChild>
        <VideoDocumentToolbarAction
          type="button"
          disabled={disabled}
          icon={<FilesIcon className="size-4" />}
          label={label}
          onClick={() => setOpen(true)}
        />
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-80 p-0">
        <div className="max-h-96 overflow-y-auto">
          <VideoDocumentNoteList
            notes={notes}
            activeNoteId={activeNoteId}
            renameLabel={renameLabel}
            onSelect={(noteId) => {
              setOpen(false);
              onSelect(noteId);
            }}
            onRename={onRename}
          />
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
