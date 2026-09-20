import { ImageIcon, ImagePlusIcon, LoaderCircleIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';

export function SocialPostMediaActions({
  imageCount,
  adding,
  generatingCover,
  onAdd,
  onGenerateCover,
}: {
  imageCount: number;
  adding: boolean;
  generatingCover: boolean;
  onAdd(): void;
  onGenerateCover(): void;
}) {
  const copy = useI18n().messages.creator.socialPostEditor;
  return (
    <div className="sticky -top-3 z-30 -mx-3 -mt-3 flex min-h-11 flex-wrap items-center justify-between gap-2 border-b bg-background px-3 py-2">
      <span className="text-xs font-medium text-muted-foreground">
        {copy.imageCount.replace('{count}', String(imageCount))}
      </span>
      <div className="flex flex-wrap items-center justify-end gap-1">
        <Button type="button" variant="outline" size="sm" disabled={adding} onClick={onAdd}>
          {adding ? <LoaderCircleIcon className="size-4 animate-spin" /> : <ImagePlusIcon className="size-4" />}
          {copy.addImages}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={generatingCover}
          aria-busy={generatingCover || undefined}
          onClick={onGenerateCover}
        >
          {generatingCover ? <LoaderCircleIcon className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
          {copy.createCover}
        </Button>
      </div>
    </div>
  );
}
