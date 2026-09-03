import { ImageIcon, ImagePlusIcon, LoaderCircleIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';

export function SocialPostMediaActions({
  adding,
  generatingCover,
  onAdd,
  onGenerateCover,
  zh,
}: {
  adding: boolean;
  generatingCover: boolean;
  onAdd(): void;
  onGenerateCover(): void;
  zh: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={generatingCover}
        aria-busy={generatingCover || undefined}
        onClick={onGenerateCover}
      >
        {generatingCover ? <LoaderCircleIcon className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
        {zh ? '制作封面' : 'Create cover'}
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={adding} onClick={onAdd}>
        {adding ? <LoaderCircleIcon className="size-4 animate-spin" /> : <ImagePlusIcon className="size-4" />}
        {zh ? '添加图片' : 'Add images'}
      </Button>
    </div>
  );
}
