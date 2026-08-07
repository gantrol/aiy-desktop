import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';

interface HoverRevealButtonProps extends Omit<ComponentProps<typeof Button>, 'children' | 'size'> {
  label: string;
  children: ReactNode;
}

export function HoverRevealButton({ label, children, className, title = label, ...props }: HoverRevealButtonProps) {
  return (
    <Button
      {...props}
      size="sm"
      className={cn(
        'group/reveal max-w-8 justify-start gap-2 overflow-hidden px-2 transition-[max-width,background-color,color,border-color,box-shadow] duration-300 ease-out hover:max-w-48 focus-visible:max-w-48',
        className,
      )}
      title={title}
      aria-label={props['aria-label'] ?? label}
    >
      {children}
      <span className="translate-x-1 opacity-0 transition-[transform,opacity] duration-200 ease-out group-hover/reveal:translate-x-0 group-hover/reveal:opacity-100 group-focus-visible/reveal:translate-x-0 group-focus-visible/reveal:opacity-100">
        {label}
      </span>
    </Button>
  );
}
