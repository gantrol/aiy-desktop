import { PlusIcon, Settings2Icon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { staticImage } from '@/renderer/features/gif-making/useGifMaker';
import type { GifMakerModel } from '@/renderer/features/gif-making/useGifMaker';
export function GifSourceToolbar({ model }: { model: GifMakerModel }) {
  const {
    labels,
    setPlaying,
    setPicker,
    settings,
    setSettings,
    result,
    showEncoded,
    setShowEncoded,
    fileInput,
    backgroundInput,
    busy,
    add,
    importFiles,
    initialAssets,
  } = model;
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
      <Input
        ref={backgroundInput}
        data-control="gif-import-background"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        aria-label={labels.importBackground}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          void importFiles(files, true);
        }}
      />
      <Input
        ref={fileInput}
        data-control="gif-import-frames"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        aria-label={labels.addImages}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          void importFiles(files);
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={busy}>
            <PlusIcon className="size-4" />
            {labels.addFrames}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => fileInput.current?.click()}>{labels.addImages}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPicker('frames')}>{labels.fromLibrary}</DropdownMenuItem>
          {initialAssets.some(staticImage) && (
            <DropdownMenuItem onSelect={() => add(initialAssets.filter(staticImage))}>
              {labels.currentImages}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        size="sm"
        variant={settings ? 'secondary' : 'ghost'}
        data-action="gif-toggle-settings"
        disabled={busy}
        onClick={() => {
          setSettings((value) => !value);
        }}
      >
        <Settings2Icon className="size-4" />
        {labels.settings}
      </Button>
      {result && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setPlaying(false);
            setShowEncoded((value) => !value);
          }}
        >
          {showEncoded ? labels.preview : labels.encoded}
        </Button>
      )}
    </div>
  );
}
