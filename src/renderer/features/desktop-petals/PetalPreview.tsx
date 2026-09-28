import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { PetalOverlay } from '@/renderer/features/desktop-petals/PetalOverlay';
import { usePetalOverlay } from '@/renderer/features/desktop-petals/use-petal-overlay';
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
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pressed = useRef(false);
  const callbacks = useRef({ disabled, onError });
  callbacks.current = { disabled, onError };
  const overlay = usePetalOverlay('hover', () => dismiss());
  const { open: openOverlay, close: closeOverlay } = overlay;
  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    clearTimeout(leaveTimer.current);
    const token = active.current;
    active.current = null;
    setContent(null);
    closeOverlay();
    if (token) void window.desktopPetals.preview({ id, token, open: false }).catch(() => undefined);
  }, [closeOverlay, id]);
  const show = () => {
    clearTimeout(leaveTimer.current);
    if (callbacks.current.disabled || pressed.current || active.current || !trigger.current) return;
    const token = crypto.randomUUID();
    active.current = token;
    const bounds = trigger.current.getBoundingClientRect();
    const point = {
      x: window.screenX + bounds.left + bounds.width / 2,
      y: window.screenY + bounds.bottom,
      top: window.screenY + bounds.top,
    };
    void Promise.all([window.desktopPetals.preview({ id, token, open: true }), openOverlay(point)])
      .then(([result, surface]) => {
        if (active.current !== token) {
          void window.desktopPetals.preview({ id, token, open: false }).catch(() => undefined);
          return;
        }
        if (!result || !surface) return dismiss();
        setContent(result);
      })
      .catch((error) => {
        if (active.current !== token) return;
        dismiss();
        callbacks.current.onError(error);
      });
  };
  const leave = () => {
    clearTimeout(timer.current);
    clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(dismiss, 180);
  };
  useEffect(() => {
    if (disabled) dismiss();
  }, [disabled, dismiss]);
  useEffect(() => {
    const down = () => {
      pressed.current = true;
      dismiss();
    };
    const up = () => {
      pressed.current = false;
    };
    const blur = () => {
      pressed.current = false;
      dismiss();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && active.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        dismiss();
      }
    };
    window.addEventListener('blur', blur);
    window.addEventListener('wheel', dismiss, true);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('blur', blur);
      window.removeEventListener('wheel', dismiss, true);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('keydown', key, true);
      dismiss();
    };
  }, [dismiss]);
  return (
    <>
      <Slot
        ref={trigger}
        onPointerEnter={() => {
          clearTimeout(leaveTimer.current);
          clearTimeout(timer.current);
          timer.current = setTimeout(show, 400);
        }}
        onPointerLeave={leave}
        onFocus={show}
        onBlur={dismiss}
        onContextMenuCapture={dismiss}
      >
        {children}
      </Slot>
      <PetalOverlay surface={content ? overlay.surface : null} fitHeight>
        {content && (
          <div
            data-petal-preview=""
            role="tooltip"
            onPointerEnter={() => clearTimeout(leaveTimer.current)}
            onPointerLeave={leave}
            onPointerDown={dismiss}
            className="max-h-full w-full overflow-y-auto overscroll-contain rounded-sm border border-border bg-background p-2 text-foreground shadow-none"
          >
            <div className="whitespace-normal break-words text-xs font-medium">{content.title || title}</div>
            {content.mediaUrl ? (
              <img src={content.mediaUrl} alt="" className="mt-2 h-24 w-full object-contain" />
            ) : content.text && content.text !== content.title ? (
              <div className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-xs font-normal text-muted-foreground">
                {content.text}
              </div>
            ) : null}
          </div>
        )}
      </PetalOverlay>
    </>
  );
}
