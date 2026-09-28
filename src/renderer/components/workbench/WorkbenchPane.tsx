import { useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import { PanelLeftCloseIcon, PanelLeftOpenIcon, PanelRightCloseIcon, PanelRightOpenIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';
import { useI18n } from '@/renderer/i18n/useI18n';
import './workbench-pane.css';

export function WorkbenchPaneHeader({ className, ...props }: ComponentProps<'header'>) {
  return <header className={cn('flex h-14 min-w-0 shrink-0 items-center gap-2 border-b px-3', className)} {...props} />;
}

export function WorkbenchPaneToggle({
  expanded,
  label,
  side = 'left',
  dockSide,
  floating = true,
  floatingHost,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, 'children'> & {
  expanded: boolean;
  label: string;
  side?: 'left' | 'right';
  dockSide?: 'left' | 'right';
  floating?: boolean;
  floatingHost?: HTMLElement | null;
}) {
  const copy = useI18n().messages.workbench;
  const anchor = useRef<HTMLSpanElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    // Dock to this pane, not to the viewport or to a relatively positioned header.
    if (!floating) {
      setHost(null);
      return;
    }
    const element = anchor.current?.closest<HTMLElement>('aside, [data-workbench-pane], [data-workbench-layout]');
    setHost(floatingHost ?? element ?? null);
  }, [floating, floatingHost]);
  const Icon =
    side === 'left'
      ? expanded
        ? PanelLeftCloseIcon
        : PanelLeftOpenIcon
      : expanded
        ? PanelRightCloseIcon
        : PanelRightOpenIcon;
  const action = expanded ? copy.hidePane(label) : copy.showPane(label);
  const button = (
    <Button
      type="button"
      variant={floating && host ? 'secondary' : 'ghost'}
      size="icon-sm"
      title={action}
      aria-label={action}
      aria-expanded={expanded}
      {...props}
      className={cn(floating && host && 'bg-surface', className)}
    >
      <Icon className="size-4" aria-hidden="true" />
    </Button>
  );
  const control =
    floating && host
      ? createPortal(
          <div className="workbench-pane-toggle-dock" data-side={dockSide ?? side}>
            {button}
          </div>,
          host,
        )
      : button;
  return (
    <>
      <span ref={anchor} hidden data-pane-toggle-anchor />
      {control}
    </>
  );
}
