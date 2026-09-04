import { GripVerticalIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { startSocialPostMediaReorderDrag } from '@/renderer/components/creator/socialPostMediaDrag';

export function SocialPostMediaOrderHandle({
  assetId,
  index,
  zh,
  onDragEnd,
  onMove,
}: {
  assetId: string;
  index: number;
  zh: boolean;
  onDragEnd(): void;
  onMove(offset: -1 | 1): void;
}) {
  const label = zh ? `拖动第 ${index + 1} 张图片调整顺序` : `Drag image ${index + 1} to reorder`;
  return (
    <Button
      type="button"
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
