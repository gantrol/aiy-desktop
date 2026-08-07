import { BookmarkIcon, DownloadIcon, LoaderCircleIcon, PlayIcon, XIcon } from 'lucide-react';
import type { IntakeCommitIntent } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Label } from '@/renderer/components/ui/label';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  defaultIntent: IntakeCommitIntent;
  pendingIntent: IntakeCommitIntent | null;
  creationAvailable?: boolean;
  favorite: boolean;
  /** Album that receives the import, when the user is inside one. */
  albumName?: string | null;
  onFavoriteChange(favorite: boolean): void;
  onStartCreation(): void;
  onImport(): void;
  onCancel(): void;
}

export function IntakeActionBar({
  defaultIntent,
  pendingIntent,
  creationAvailable = true,
  favorite,
  albumName,
  onFavoriteChange,
  onStartCreation,
  onImport,
  onCancel,
}: Props) {
  const { messages } = useI18n();
  const l = messages.intake.actions;
  const pending = Boolean(pendingIntent);
  const createButton = (
    <Button
      type="button"
      data-action="intake-start-creation"
      variant={defaultIntent === 'START_CREATION' ? 'default' : 'outline'}
      disabled={pending || !creationAvailable}
      aria-busy={pendingIntent === 'START_CREATION'}
      onClick={onStartCreation}
    >
      {pendingIntent === 'START_CREATION' ? (
        <LoaderCircleIcon className="size-4 animate-spin" />
      ) : (
        <PlayIcon className="size-4" />
      )}
      {l.create}
    </Button>
  );
  const importButton = (
    <Button
      type="button"
      data-action="intake-import"
      variant={defaultIntent === 'IMPORT' ? 'default' : 'outline'}
      disabled={pending}
      aria-busy={pendingIntent === 'IMPORT'}
      onClick={onImport}
    >
      {pendingIntent === 'IMPORT' ? (
        <LoaderCircleIcon className="size-4 animate-spin" />
      ) : (
        <DownloadIcon className="size-4" />
      )}
      {albumName ? l.importToAlbum(albumName) : l.import}
    </Button>
  );

  return (
    <div className="mx-auto flex min-h-16 w-full max-w-3xl flex-wrap items-center justify-end gap-2 border-t px-3 py-2">
      <div className="mr-auto flex items-center gap-2">
        <Checkbox id="intake-favorite" checked={favorite} disabled={pending} onCheckedChange={onFavoriteChange} />
        <Label htmlFor="intake-favorite" className="flex items-center gap-1.5 text-sm font-normal">
          <BookmarkIcon className="size-3.5" />
          {l.favorite}
        </Label>
      </div>
      <Button
        type="button"
        data-action="intake-cancel"
        variant="ghost"
        size="icon-sm"
        disabled={pending}
        title={l.cancel}
        aria-label={l.cancel}
        onClick={onCancel}
      >
        <XIcon className="size-4" />
      </Button>
      {defaultIntent === 'IMPORT' ? (
        <>
          {createButton}
          {importButton}
        </>
      ) : (
        <>
          {importButton}
          {createButton}
        </>
      )}
    </div>
  );
}
