import { useId, type ComponentProps } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { RosePetal, RosePaint } from '@/renderer/features/desktop-petals/RosePetal';
import { FLOWER_PETAL_COUNT, ROSE_BUD_SIZE, roseBudCenter } from '@/shared/flower-geometry';

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
        viewBox="0 0 200 200"
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 group-hover:brightness-105"
        style={{ width: ROSE_BUD_SIZE, height: ROSE_BUD_SIZE }}
        aria-hidden="true"
      >
        <RosePaint id={id} fold={1} />
        <g transform={`translate(100 100) translate(${-roseBudCenter.x} ${-roseBudCenter.y})`}>
          {Array.from({ length: FLOWER_PETAL_COUNT }, (_, index) => (
            <RosePetal key={index} paintId={id} index={index} fold={1} />
          ))}
        </g>
      </svg>
    </Button>
  );
}
