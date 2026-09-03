import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { XIcon } from 'lucide-react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import {
  ModalOverlayScope,
  OVERLAY_SURFACE_SELECTOR,
  useOverlayPortalContainer,
} from '@/renderer/components/ui/overlay-layer';
import './sheet.css';

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;

function SheetPortal({ container, ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  const inheritedContainer = useOverlayPortalContainer();
  return (
    <DialogPrimitive.Portal
      data-slot="sheet-portal"
      container={container ?? inheritedContainer ?? undefined}
      {...props}
    />
  );
}

function SheetOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="sheet-overlay"
      data-overlay-layer="modal-scrim"
      className={cn('sheet-overlay-motion pointer-events-auto fixed inset-0 z-modal-scrim bg-dialog-scrim', className)}
      {...props}
    />
  );
}

const sheetVariants = cva(
  'corner-continuous sheet-content-motion pointer-events-auto fixed z-modal flex flex-col gap-4 overflow-hidden border bg-overlay p-6 text-foreground shadow-dialog outline-none',
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
      <ModalOverlayScope>
        <DialogPrimitive.Content
          data-slot="sheet-content"
          data-side={side ?? 'right'}
          data-overlay-layer="modal"
          data-overlay-surface=""
          className={cn(sheetVariants({ side }), className)}
          onInteractOutside={(event) => {
            onInteractOutside?.(event);
            if (
              !event.defaultPrevented &&
              event.target instanceof Element &&
              event.target.closest(OVERLAY_SURFACE_SELECTOR)
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
      </ModalOverlayScope>
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
