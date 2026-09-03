import type { PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '@/renderer/lib/utils';

interface Props {
  edge: 'left' | 'right';
  label: string;
  onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void;
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  valueText?: string;
  disabled?: boolean;
  onValueChange?(value: number): void;
}

export function CreatorPaneResizeHandle({
  edge,
  label,
  onPointerDown,
  value,
  min,
  max,
  step = 16,
  valueText,
  disabled = false,
  onValueChange,
}: Props) {
  const keyboardEnabled = !disabled && value !== undefined && Boolean(onValueChange);

  function updateValue(next: number) {
    const bounded = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, next));
    onValueChange?.(bounded);
  }

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      aria-disabled={disabled || undefined}
      tabIndex={keyboardEnabled ? 0 : undefined}
      className={cn(
        'group absolute inset-y-0 z-40 hidden h-full w-3 cursor-col-resize touch-none select-none outline-none @min-[840px]/creator:block',
        edge === 'left' ? '-left-1.5' : '-right-1.5',
        disabled && 'pointer-events-none cursor-default',
      )}
      onPointerDown={disabled ? undefined : onPointerDown}
      onKeyDown={(event) => {
        if (!keyboardEnabled || value === undefined) return;
        const multiplier = event.shiftKey ? 4 : 1;
        const rightDelta = step * multiplier * (edge === 'right' ? 1 : -1);
        let next: number | null = null;
        if (event.key === 'ArrowRight') next = value + rightDelta;
        else if (event.key === 'ArrowLeft') next = value - rightDelta;
        else if (event.key === 'Home' && min !== undefined) next = min;
        else if (event.key === 'End' && max !== undefined) next = max;
        if (next === null) return;
        event.preventDefault();
        updateValue(next);
      }}
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-ring group-focus-visible:bg-ring group-active:bg-ring" />
    </div>
  );
}
