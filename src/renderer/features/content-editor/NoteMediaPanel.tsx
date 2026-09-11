import { ContentMediaThumbnail } from '@/renderer/features/content-editor/ContentMediaThumbnail';
import type { useNoteMediaIntake } from '@/renderer/features/content-editor/useNoteMediaIntake';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { DesktopNote } from '@/shared/contracts/desktop-petals';
import { ImagesIcon, LoaderCircleIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { cn } from '@/renderer/lib/utils';

export function NoteMediaPanel({
  note,
  disabled,
  intake,
}: {
  note: DesktopNote;
  disabled: boolean;
  intake: ReturnType<typeof useNoteMediaIntake>;
}) {
  const copy = useI18n().messages;
  return (
    <section
      tabIndex={0}
      aria-label={copy.contentEditor.media}
      className={cn(
        'grid min-h-full content-start gap-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        intake.dragActive && 'ring-2 ring-inset ring-selected-border',
      )}
      onPaste={(event) => {
        event.stopPropagation();
        intake.paste(event);
      }}
      onDragOver={(event) => {
        event.stopPropagation();
        intake.dragOver(event);
      }}
      onDragLeave={intake.dragLeave}
      onDrop={(event) => {
        event.stopPropagation();
        intake.drop(event);
      }}
    >
      <div className="sticky -top-3 z-20 -mx-3 -mt-3 flex min-h-11 items-center justify-end border-b bg-background px-3">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={disabled || intake.adding || note.references.length >= 100}
          aria-label={copy.desktopPetals.references.upload}
          title={copy.desktopPetals.references.upload}
          onClick={() => void intake.choose()}
        >
          {intake.adding ? <LoaderCircleIcon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}
        </Button>
      </div>
      {note.references.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
          {note.references.map((reference, index) => (
            <ContentMediaThumbnail
              key={reference.assetId}
              assetId={reference.assetId}
              mediaUrl={reference.mediaUrl}
              index={index}
              actions={[
                {
                  id: 'note-media-remove',
                  label: copy.contentEditor.removeImage,
                  icon: Trash2Icon,
                  destructive: true,
                  disabled,
                  onSelect: () => void intake.remove(reference.assetId),
                },
              ]}
            />
          ))}
        </div>
      ) : (
        <div className="grid min-h-32 place-items-center text-muted-foreground">
          <ImagesIcon className="size-5" />
        </div>
      )}
    </section>
  );
}
