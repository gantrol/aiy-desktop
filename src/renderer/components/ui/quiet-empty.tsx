import * as React from 'react';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';

interface QuietEmptyProps extends Omit<React.ComponentProps<'div'>, 'children'> {
  title: string;
  actionLabel: string;
  actionDisabled?: boolean;
  onAction: React.MouseEventHandler<HTMLButtonElement>;
}

function QuietEmpty({ title, actionLabel, actionDisabled = false, onAction, className, ...props }: QuietEmptyProps) {
  return (
    <div
      data-slot="quiet-empty"
      className={cn('grid justify-items-center gap-3 px-6 py-10 text-center', className)}
      {...props}
    >
      <strong className="text-sm font-medium">{title}</strong>
      <Button type="button" variant="outline" size="sm" disabled={actionDisabled} onClick={onAction}>
        {actionLabel}
      </Button>
    </div>
  );
}

export { QuietEmpty };
