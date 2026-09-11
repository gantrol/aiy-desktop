import { GripVerticalIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { startSocialPostMediaReorderDrag } from '@/renderer/components/creator/socialPostMediaDrag';

export function SocialPostMediaOrderHandle({
  assetId,
  index,
  onDragEnd,
  onMove,
}: {
  assetId: string;
  index: number;
  onDragEnd(): void;
  onMove(offset: -1 | 1): void;
}) {
  const label = useI18n().messages.creator.socialPostEditor.reorderImage.replace('{index}', String(index + 1));
  return (
    <Button
      type="button"
      data-action="reorder-social-post-image"
      data-asset-id={assetId}
      variant="ghost"
      draggable
      className="absolute top-1.5 left-1.5 z-20 h-6 min-w-6 cursor-grab gap-0.5 rounded bg-overlay/90 px-1.5 text-2xs tabular-nums active:cursor-grabbing"
      title={label}
      aria-label={label}
      onDragStart={(event) => startSocialPostMediaReorderDrag(event, assetId)}
      onDragEnd={onDragEnd}
      onKeyDown={(event) => {
        const offset = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
        if (!offset) return;
        event.preventDefault();
        onMove(offset);
      }}
    >
      <GripVerticalIcon className="size-3" aria-hidden="true" />
      {index + 1}
    </Button>
  );
}
