import { useState } from 'react';
import { File, FileText, Music2, Video, X, Play, Square } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { noteFileMediaUrl, type NoteFile } from '@/shared/contracts/note-files';

export function PetalFileAttachments({
  files,
  libraryId,
  stashId,
  disabled,
  onOpen,
  onRemove,
}: {
  files: NoteFile[];
  libraryId: string;
  stashId: string;
  disabled: boolean;
  onOpen(id: string): void;
  onRemove(id: string): Promise<boolean>;
}) {
  const copy = useI18n().messages.desktopPetals.files;
  const [playing, setPlaying] = useState<string | null>(null);
  if (!files.length) return null;
  return (
    <div className="max-h-44 shrink-0 overflow-y-auto px-3 py-1" aria-label={copy.title}>
      {files.map((file) => {
        const audio = file.mimeType.startsWith('audio/'),
          video = file.mimeType.startsWith('video/');
        const Icon = audio ? Music2 : video ? Video : file.mimeType === 'application/pdf' ? FileText : File;
        return (
          <div key={file.id} className="py-0.5">
            <div className="flex min-w-0 items-center gap-1">
              <Icon className="size-3.5 shrink-0 opacity-60" />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 min-w-0 flex-1 justify-start px-1 text-inherit"
                title={file.name}
                aria-label={`${copy.open}: ${file.name}`}
                onClick={() => onOpen(file.id)}
              >
                <span className="truncate">{file.name}</span>
              </Button>
              {(audio || video) && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-inherit"
                  aria-label={playing === file.id ? copy.stop : copy.play}
                  title={playing === file.id ? copy.stop : copy.play}
                  aria-pressed={playing === file.id}
                  onClick={() => setPlaying((current) => (current === file.id ? null : file.id))}
                >
                  {playing === file.id ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-inherit"
                disabled={disabled}
                aria-label={copy.remove}
                title={copy.remove}
                onClick={() => void onRemove(file.id)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
            {playing === file.id &&
              (audio || video) &&
              (video ? (
                <video
                  controls
                  autoPlay
                  preload="metadata"
                  className="max-h-32 w-full"
                  src={noteFileMediaUrl(libraryId, stashId, file.id)}
                  aria-label={file.name}
                />
              ) : (
                <audio
                  controls
                  autoPlay
                  preload="metadata"
                  className="h-8 w-full"
                  src={noteFileMediaUrl(libraryId, stashId, file.id)}
                  aria-label={file.name}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}
