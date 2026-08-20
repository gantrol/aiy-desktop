import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { XIcon } from 'lucide-react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import './sheet.css';

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;

function SheetPortal(props: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn('sheet-overlay-motion fixed inset-0 z-50 bg-dialog-scrim', className)}
      {...props}
    />
  );
}

const sheetVariants = cva(
  'corner-continuous sheet-content-motion fixed z-50 flex flex-col gap-4 overflow-hidden border bg-overlay p-6 text-foreground shadow-dialog outline-none',
  {
    variants: {
      side: {
        top: 'inset-x-2 top-2 max-h-[calc(100%-1rem)] rounded-xl',
        right: 'top-10 right-2 bottom-2 h-[calc(100%-3rem)] w-[min(26rem,calc(100%-1rem))] rounded-xl',
        bottom: 'inset-x-2 bottom-2 max-h-[calc(100%-1rem)] rounded-xl',
        left: 'top-10 bottom-2 left-2 h-[calc(100%-3rem)] w-[min(26rem,calc(100%-1rem))] rounded-xl',
      },
    },
    defaultVariants: { side: 'right' },
  },
);

interface SheetContentProps
  extends React.ComponentProps<typeof DialogPrimitive.Content>, VariantProps<typeof sheetVariants> {
  showCloseButton?: boolean;
}

// Nested overlays portal to document.body, but remain interaction surfaces
// owned by the Sheet rather than outside-click targets.
const nestedOverlaySelector =
  '[data-slot="popover-content"], [data-slot="select-content"], [data-slot="context-menu-content"], [data-slot="context-menu-sub-content"]';

function SheetContent({
  side,
  className,
  children,
  showCloseButton = true,
  onInteractOutside,
  ...props
}: SheetContentProps) {
  const { messages } = useI18n();
  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        data-side={side ?? 'right'}
        className={cn(sheetVariants({ side }), className)}
        onInteractOutside={(event) => {
          onInteractOutside?.(event);
          if (
            !event.defaultPrevented &&
            event.target instanceof Element &&
            event.target.closest(nestedOverlaySelector)
          ) {
            event.preventDefault();
          }
        }}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close className="absolute top-3 right-3 grid size-8 place-items-center rounded-md text-muted-foreground outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
            <XIcon aria-hidden="true" className="size-4" />
            <span className="sr-only">{messages.common.close}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sheet-header" className={cn('flex flex-col gap-2 text-left', className)} {...props} />;
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('mt-auto flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title data-slot="sheet-title" className={cn('text-md font-semibold', className)} {...props} />
  );
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
  sheetVariants,
};
