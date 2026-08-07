import { FolderOpenIcon, ImagePlusIcon, LoaderCircleIcon, PackageOpenIcon } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { intakeMediaAccept } from '@/renderer/features/intake/intakeImageFormats';

interface Props {
  chooseLabel: string;
  contentPackLabel: string;
  openLabel: string;
  openingLibrary: boolean;
  reading?: boolean;
  onChooseImages(files: File[]): void;
  onImportContentPack(): void;
  onOpenLibrary(): void;
}

/** Explicit ways to get material into an idle empty library. */
export function StartActionBar({
  chooseLabel,
  contentPackLabel,
  openLabel,
  openingLibrary,
  reading = false,
  onChooseImages,
  onImportContentPack,
  onOpenLibrary,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div data-slot="start-action-bar" className="flex items-center gap-2">
      <input
        ref={fileInputRef}
        data-action="intake-file-input"
        type="file"
        accept={intakeMediaAccept}
        multiple
        className="hidden"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          if (files.length) onChooseImages(files);
        }}
      />
      <Button
        type="button"
        variant="outline"
        data-action="intake-choose-images"
        disabled={reading}
        aria-busy={reading}
        onClick={() => fileInputRef.current?.click()}
      >
        {reading ? <LoaderCircleIcon className="size-4 animate-spin" /> : <ImagePlusIcon className="size-4" />}
        {chooseLabel}
      </Button>
      <Button type="button" variant="outline" onClick={onImportContentPack}>
        <PackageOpenIcon className="size-4" />
        {contentPackLabel}
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={openingLibrary}
        aria-busy={openingLibrary}
        onClick={onOpenLibrary}
      >
        {openingLibrary ? <LoaderCircleIcon className="size-4 animate-spin" /> : <FolderOpenIcon className="size-4" />}
        {openLabel}
      </Button>
    </div>
  );
}
