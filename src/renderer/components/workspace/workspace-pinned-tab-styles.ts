import { cn } from '@/renderer/lib/utils';

export function workspacePinnedTabClassName({
  compact,
  selected,
  pending,
}: {
  compact: boolean;
  selected: boolean;
  pending: boolean;
}) {
  return cn(
    'h-7 shrink-0 rounded-sm border border-transparent text-muted-foreground transition-colors duration-fast motion-reduce:transition-none',
    compact ? 'w-7' : 'w-8',
    selected
      ? 'border-border bg-background text-foreground hover:bg-background'
      : 'hover:bg-hover hover:text-foreground-secondary',
    pending && !selected && 'bg-hover text-foreground-secondary',
  );
}
