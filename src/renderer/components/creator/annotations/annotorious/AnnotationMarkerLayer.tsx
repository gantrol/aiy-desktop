import type { CSSProperties } from 'react';
import { cn } from '@/renderer/lib/utils';
import type { AnnotationLabels, NumberedAnnotation } from '@/renderer/components/creator/annotations/types';

interface Props {
  annotations: NumberedAnnotation[];
  labels: AnnotationLabels;
  selectedId: string | null;
  visible: boolean;
  onSelect(id: string | null): void;
}

interface MarkerProps {
  label: string;
  number?: number;
  selected?: boolean;
  closed?: boolean;
  style: CSSProperties;
  onSelect?(): void;
}

function Marker({ label, number, selected, closed, style, onSelect }: MarkerProps) {
  const Comp = onSelect ? 'button' : 'span';
  return (
    <Comp
      data-annotation-marker
      type={onSelect ? 'button' : undefined}
      className={cn(
        'pointer-events-auto absolute z-20 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-background bg-primary text-[10px] font-semibold leading-none text-primary-foreground outline-none',
        'size-5',
        selected && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
        closed && 'border-dashed opacity-45 grayscale',
      )}
      style={style}
      aria-label={onSelect ? label : undefined}
      title={label || undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onSelect}
    >
      {number}
    </Comp>
  );
}

export function AnnotationMarkerLayer({ annotations, labels, selectedId, visible, onSelect }: Props) {
  if (!visible) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {annotations.map(({ annotation, number }) => (
        <Marker
          key={annotation.id}
          label={labels.markerLabel(number, annotation.comment || labels.note)}
          number={number}
          selected={annotation.id === selectedId}
          closed={annotation.status !== 'OPEN'}
          style={{
            left: `${(annotation.x + (annotation.width ?? 0) / 2) * 100}%`,
            top: `${(annotation.y + (annotation.height ?? 0) / 2) * 100}%`,
          }}
          onSelect={() => onSelect(annotation.id === selectedId ? null : annotation.id)}
        />
      ))}
    </div>
  );
}
