import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import type { PetalPreviewContent } from '@/shared/petal-preview';

export function PetalPreview({
  id,
  title,
  disabled = false,
  children,
  onError,
}: {
  id: string;
  title: string;
  disabled?: boolean;
  children: ReactElement;
  onError(error: unknown): void;
}) {
  const [content, setContent] = useState<PetalPreviewContent | null>(null);
  const active = useRef<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const pendingBounds = useRef<{ left: number; top: number; right: number; bottom: number } | null>(null);
  const frame = useRef<number | null>(null);
  const pressed = useRef(false);
  const callbacks = useRef({ disabled, onError });
  callbacks.current = { disabled, onError };
  const dismiss = useCallback(() => {
    const token = active.current;
    active.current = null;
    pendingBounds.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setContent(null);
    if (token) void window.desktopPetals.preview({ id, token, open: false }).catch(() => undefined);
  }, [id]);
  const leavePending = useCallback(
    (event: { screenX: number; screenY: number }) => {
      const bounds = pendingBounds.current;
      if (
        bounds &&
        (event.screenX < bounds.left ||
          event.screenX > bounds.right ||
          event.screenY < bounds.top ||
          event.screenY > bounds.bottom)
      )
        dismiss();
    },
    [dismiss],
  );
  const change = (open: boolean) => {
    if (!open) return dismiss();
    if (callbacks.current.disabled || pressed.current || active.current) return;
    const token = crypto.randomUUID();
    active.current = token;
    const bounds = trigger.current?.getBoundingClientRect();
    pendingBounds.current = bounds
      ? {
          left: window.screenX + bounds.left,
          right: window.screenX + bounds.right,
          top: window.screenY + bounds.top,
          bottom: window.screenY + bounds.bottom,
        }
      : null;
    void window.desktopPetals
      .preview({ id, token, open: true })
      .then((result) => {
        if (active.current !== token) {
          void window.desktopPetals.preview({ id, token, open: false }).catch(() => undefined);
          return;
        }
        if (!result) return dismiss();
        // Allow the native frame and the trigger's preserved screen anchor to arrive before positioning the tooltip.
        frame.current = requestAnimationFrame(() => {
          frame.current = requestAnimationFrame(() => {
            frame.current = null;
            if (active.current === token && !callbacks.current.disabled) {
              pendingBounds.current = null;
              setContent(result);
            }
          });
        });
      })
      .catch((error) => {
        if (active.current !== token) return;
        dismiss();
        callbacks.current.onError(error);
      });
  };
  useEffect(() => {
    if (disabled) dismiss();
  }, [disabled, dismiss]);
  useEffect(() => {
    const blur = () => {
      pressed.current = false;
      dismiss();
    };
    const wheel = (event: WheelEvent) => {
      if (!(event.target instanceof Element && event.target.closest('[data-petal-preview]'))) dismiss();
    };
    window.addEventListener('blur', blur);
    window.addEventListener('wheel', wheel, true);
    const down = () => {
      pressed.current = true;
      dismiss();
    };
    const up = () => {
      pressed.current = false;
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('pointermove', leavePending, true);
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && active.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        dismiss();
      }
    };
    window.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('blur', blur);
      window.removeEventListener('wheel', wheel, true);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('pointermove', leavePending, true);
      window.removeEventListener('keydown', escape, true);
      dismiss();
    };
  }, [dismiss, leavePending]);
  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={0}>
      <Tooltip open={Boolean(content) && !disabled} onOpenChange={change}>
        <TooltipTrigger
          ref={trigger}
          asChild
          onPointerLeave={leavePending}
          onPointerDownCapture={dismiss}
          onContextMenuCapture={dismiss}
        >
          {children}
        </TooltipTrigger>
        {content && (
          <TooltipContent
            data-petal-preview=""
            side="bottom"
            sideOffset={8}
            collisionPadding={8}
            className="max-h-[var(--radix-tooltip-content-available-height)] w-60 max-w-[calc(100vw-16px)] overflow-y-auto overscroll-contain rounded-sm border-border bg-background p-2 text-foreground shadow-none"
          >
            <div className="whitespace-normal break-words text-xs font-medium">{content.title || title}</div>
            {content.mediaUrl ? (
              <img src={content.mediaUrl} alt="" className="mt-2 h-24 w-full object-contain" />
            ) : content.text && content.text !== content.title ? (
              <div className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-xs font-normal text-muted-foreground">
                {content.text}
              </div>
            ) : null}
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
}
