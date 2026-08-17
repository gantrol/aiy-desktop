import type { ComponentProps, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';

interface VideoDocumentToolbarProps {
  children: ReactNode;
  target: HTMLElement | null;
  className?: string;
}

export function VideoDocumentToolbar({ children, target, className }: VideoDocumentToolbarProps) {
  if (!target) return null;
  return createPortal(
    <div data-slot="video-document-toolbar" className={cn('flex min-w-0 items-center gap-0.5', className)}>
      {children}
    </div>,
    target,
  );
}

type VideoDocumentToolbarActionProps = Omit<
  ComponentProps<typeof Button>,
  'aria-label' | 'children' | 'size' | 'title'
> & {
  icon: ReactNode;
  label: string;
  expanded?: boolean;
};

export function VideoDocumentToolbarAction({
  icon,
  label,
  expanded = false,
  className,
  variant = 'ghost',
  ...props
}: VideoDocumentToolbarActionProps) {
  return (
    <Button
      {...props}
      variant={variant}
      size="sm"
      className={cn(
        'group/video-document-action h-8 gap-0 px-2 font-normal transition-[background-color,gap] duration-200 hover:gap-1.5 focus-visible:gap-1.5',
        expanded && 'gap-1.5',
        className,
      )}
      aria-label={label}
    >
      {icon}
      <span
        className={cn(
          'max-w-0 overflow-hidden opacity-0 transition-[max-width,opacity] duration-200 group-hover/video-document-action:max-w-40 group-hover/video-document-action:opacity-100 group-focus-visible/video-document-action:max-w-40 group-focus-visible/video-document-action:opacity-100',
          expanded && 'max-w-40 opacity-100',
        )}
      >
        {label}
      </span>
    </Button>
  );
}
