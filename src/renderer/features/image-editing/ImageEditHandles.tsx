import type { ImageEditDocument, ImageEditMark } from '@/shared/contracts/image-edit';
import { cornerHandles, type ImageEditTool } from '@/renderer/features/image-editing/image-edit-geometry';

export function ImageEditHandles({
  box,
  tool,
  selected,
  size,
}: {
  box: ImageEditDocument['crop'];
  tool: ImageEditTool;
  selected?: ImageEditMark;
  size: number;
}) {
  return (
    <g className="fill-background stroke-foreground" strokeWidth="1.5">
      {tool !== 'crop' && <rect {...box} fill="none" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
      {(tool === 'crop' ||
        (selected && ['rectangle', 'ellipse', 'cover', 'highlight', 'mosaic', 'blur'].includes(selected.kind))) &&
        cornerHandles(box).map(([name, x, y]) => (
          <rect
            key={name}
            data-handle={name}
            x={x - size / 2}
            y={y - size / 2}
            width={size}
            height={size}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      {(selected?.kind === 'arrow' || selected?.kind === 'line') &&
        tool !== 'crop' &&
        [
          ['start', selected.x, selected.y],
          ['end', selected.x + selected.width, selected.y + selected.height],
        ].map(([name, x, y]) => (
          <circle key={name} data-handle={name} cx={x} cy={y} r={size / 2} vectorEffect="non-scaling-stroke" />
        ))}
    </g>
  );
}
