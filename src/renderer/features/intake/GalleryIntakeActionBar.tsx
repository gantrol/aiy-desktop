import { BookmarkIcon, DownloadIcon, ImagesIcon, LoaderCircleIcon, XIcon } from 'lucide-react';
import type { Locale } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Label } from '@/renderer/components/ui/label';

interface Props {
  locale: Locale;
  favorite: boolean;
  albumName?: string | null;
  materialPending: boolean;
  creationPending: boolean;
  creationAvailable: boolean;
  onFavoriteChange(value: boolean): void;
  onImportMaterial(): void;
  onImportCreation(): void;
  onCancel(): void;
}

export function GalleryIntakeActionBar({
  locale,
  favorite,
  albumName,
  materialPending,
  creationPending,
  creationAvailable,
  onFavoriteChange,
  onImportMaterial,
  onImportCreation,
  onCancel,
}: Props) {
  const zh = locale === 'zh';
  const pending = materialPending || creationPending;
  return (
    <div className="mx-auto flex min-h-16 w-full max-w-3xl flex-wrap items-center justify-end gap-2 border-t px-3 py-2">
      <div className="mr-auto flex items-center gap-2">
        <Checkbox
          id="gallery-intake-favorite"
          checked={favorite}
          disabled={pending}
          onCheckedChange={onFavoriteChange}
        />
        <Label htmlFor="gallery-intake-favorite" className="flex items-center gap-1.5 text-sm font-normal">
          <BookmarkIcon className="size-3.5" />
          {zh ? '收藏' : 'Favorite'}
        </Label>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={pending}
        title={zh ? '取消' : 'Cancel'}
        aria-label={zh ? '取消' : 'Cancel'}
        onClick={onCancel}
      >
        <XIcon className="size-4" />
      </Button>
      <Button
        type="button"
        data-action="intake-import-external-creation"
        variant="outline"
        disabled={pending || !creationAvailable}
        aria-busy={creationPending}
        onClick={onImportCreation}
      >
        {creationPending ? <LoaderCircleIcon className="size-4 animate-spin" /> : <ImagesIcon className="size-4" />}
        {zh ? '导入外部创作' : 'Import external creation'}
      </Button>
      <Button
        type="button"
        data-action="intake-import-material"
        disabled={pending}
        aria-busy={materialPending}
        onClick={onImportMaterial}
      >
        {materialPending ? <LoaderCircleIcon className="size-4 animate-spin" /> : <DownloadIcon className="size-4" />}
        {albumName
          ? zh
            ? `收为素材 · ${albumName}`
            : `Save as material · ${albumName}`
          : zh
            ? '收为素材'
            : 'Save as material'}
      </Button>
    </div>
  );
}
