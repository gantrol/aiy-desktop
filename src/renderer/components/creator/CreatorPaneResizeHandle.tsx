import type { PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '@/renderer/lib/utils';

interface Props {
  edge: 'left' | 'right' | 'top';
  label: string;
  onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void;
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  valueText?: string;
  disabled?: boolean;
  onValueChange?(value: number): void;
  visibility?: 'creator' | 'content-workspace';
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
  visibility = 'creator',
}: Props) {
  const keyboardEnabled = !disabled && value !== undefined && Boolean(onValueChange);
  const horizontal = edge === 'top';

  function updateValue(next: number) {
    const bounded = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, next));
    onValueChange?.(bounded);
  }

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      aria-disabled={disabled || undefined}
      tabIndex={keyboardEnabled ? 0 : undefined}
      className={cn(
        'group absolute z-40 touch-none select-none outline-none',
        horizontal
          ? 'inset-x-0 -top-1.5 h-3 w-full cursor-row-resize @[960px]/content-workspace:hidden'
          : 'inset-y-0 hidden h-full w-3 cursor-col-resize',
        !horizontal && (visibility === 'creator' ? '@min-[840px]/creator:block' : '@[960px]/content-workspace:block'),
        !horizontal && (edge === 'left' ? '-left-1.5' : '-right-1.5'),
        disabled && 'pointer-events-none cursor-default',
      )}
      onPointerDown={disabled ? undefined : onPointerDown}
      onKeyDown={(event) => {
        if (!keyboardEnabled || value === undefined) return;
        const multiplier = event.shiftKey ? 4 : 1;
        const rightDelta = step * multiplier * (edge === 'right' ? 1 : -1);
        let next: number | null = null;
        if (event.key === (horizontal ? 'ArrowDown' : 'ArrowRight')) next = value + rightDelta;
        else if (event.key === (horizontal ? 'ArrowUp' : 'ArrowLeft')) next = value - rightDelta;
        else if (event.key === 'Home' && min !== undefined) next = min;
        else if (event.key === 'End' && max !== undefined) next = max;
        if (next === null) return;
        event.preventDefault();
        updateValue(next);
      }}
    >
      <span
        className={cn(
          'absolute bg-transparent transition-colors group-hover:bg-ring group-focus-visible:bg-ring group-active:bg-ring',
          horizontal ? 'inset-x-0 top-1/2 h-px -translate-y-1/2' : 'inset-y-0 left-1/2 w-px -translate-x-1/2',
        )}
      />
    </div>
  );
}
