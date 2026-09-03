import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { XIcon } from 'lucide-react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import {
  ModalOverlayScope,
  OVERLAY_SURFACE_SELECTOR,
  useOverlayPortalContainer,
} from '@/renderer/components/ui/overlay-layer';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogPortal({ container, ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  const inheritedContainer = useOverlayPortalContainer();
  return (
    <DialogPrimitive.Portal
      data-slot="dialog-portal"
      container={container ?? inheritedContainer ?? undefined}
      {...props}
    />
  );
}
function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      data-overlay-layer="modal-scrim"
      className={cn('pointer-events-auto fixed inset-0 z-modal-scrim bg-dialog-scrim backdrop-blur-[2px]', className)}
      {...props}
    />
  );
}
function DialogContent({
  className,
  children,
  showCloseButton = true,
  onInteractOutside,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { showCloseButton?: boolean }) {
  const { messages } = useI18n();
  return (
    <DialogPortal>
      <DialogOverlay />
      <ModalOverlayScope>
        <DialogPrimitive.Content
          data-slot="dialog-content"
          data-overlay-layer="modal"
          data-overlay-surface=""
          className={cn(
            'corner-continuous pointer-events-auto fixed top-1/2 left-1/2 z-modal grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border border-border bg-overlay p-6 text-foreground shadow-dialog outline-none',
            className,
          )}
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
            <DialogPrimitive.Close className="absolute top-4 right-4 grid size-8 place-items-center rounded-md text-muted-foreground outline-none transition-colors duration-fast hover:bg-hover hover:text-foreground active:bg-pressed focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:text-disabled-foreground">
              <XIcon aria-hidden="true" className="size-4" />
              <span className="sr-only">{messages.common.close}</span>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </ModalOverlayScope>
    </DialogPortal>
  );
}
function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('flex flex-col gap-2 text-left', className)} {...props} />;
}
function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}
function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-lg font-semibold leading-none', className)}
      {...props}
    />
  );
}
function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
