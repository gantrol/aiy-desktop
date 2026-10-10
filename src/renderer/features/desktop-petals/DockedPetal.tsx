import { useId, type ComponentProps } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { RosePetal, RosePaint } from '@/renderer/features/desktop-petals/RosePetal';
import { FLOWER_PETAL_COUNT, ROSE_BUD_SCALE, flowerDockSize, roseBudCenter } from '@/shared/flower-geometry';

const dockSize = flowerDockSize();

/** A top-view bud uses the same pose and lighting at each desktop edge. */
export function DockedPetal({
  label,
  onPointerEnter,
  onClick,
}: {
  label: string;
} & Pick<ComponentProps<typeof Button>, 'onPointerEnter' | 'onClick'>) {
  const id = useId();
  return (
    <Button
      variant="ghost"
      className="group size-full overflow-hidden rounded-none bg-transparent p-0 hover:bg-transparent active:bg-transparent focus-visible:ring-inset focus-visible:ring-offset-0"
      aria-label={label}
      title={label}
      onPointerEnter={onPointerEnter}
      onClick={onClick}
    >
      <svg
        viewBox={`0 0 ${dockSize.width} ${dockSize.height}`}
        className="pointer-events-none block size-full group-hover:brightness-105"
        aria-hidden="true"
      >
        <RosePaint id={id} fold={1} />
        <g
          transform={`translate(${dockSize.width / 2} ${dockSize.height / 2}) scale(${ROSE_BUD_SCALE}) translate(${-roseBudCenter.x} ${-roseBudCenter.y})`}
        >
          {Array.from({ length: FLOWER_PETAL_COUNT }, (_, index) => (
            <RosePetal key={index} paintId={id} index={index} fold={1} />
          ))}
        </g>
      </svg>
    </Button>
  );
}
