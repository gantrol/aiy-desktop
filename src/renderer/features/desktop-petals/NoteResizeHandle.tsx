import { useEffect, useRef } from 'react';
import { Grip } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { petalNoteSizeSchema } from '@/shared/contracts/desktop-petals';

type Size = { width: number; height: number };
export function NoteResizeHandle({ disabled, onError }: { disabled?: boolean; onError(reason: unknown): void }) {
  const copy = useI18n().messages.desktopPetals;
  const gesture = useRef<{ pointerId: number; x: number; y: number; size: Size; target: HTMLButtonElement } | null>(
    null,
  );
  const pending = useRef<Size | null>(null);
  const moving = useRef<Promise<void> | null>(null);
  const error = useRef(onError);
  error.current = onError;
  const resize = (size: Size) => {
    pending.current = petalNoteSizeSchema.parse({
      width: Math.max(280, Math.min(640, Math.round(size.width))),
      height: Math.max(300, Math.min(800, Math.round(size.height))),
    });
    if (moving.current) return;
    moving.current = (async () => {
      while (pending.current) {
        const next = pending.current;
        pending.current = null;
        await window.desktopPetals.resize(next);
      }
    })()
      .catch((reason) => {
        pending.current = null;
        error.current(reason);
      })
      .finally(() => {
        moving.current = null;
      });
  };
  const finish = () => {
    const active = gesture.current;
    gesture.current = null;
    if (active?.target.hasPointerCapture(active.pointerId)) active.target.releasePointerCapture(active.pointerId);
  };
  useEffect(() => {
    window.addEventListener('blur', finish);
    return () => {
      window.removeEventListener('blur', finish);
      pending.current = null;
      finish();
    };
  }, []);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={disabled}
      aria-label={copy.actions.resize}
      title={copy.actions.resize}
      className="absolute bottom-0 right-0 z-10 size-3 cursor-se-resize rounded-none p-0 text-inherit opacity-40 hover:opacity-100 touch-none"
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary || gesture.current || moving.current) return;
        event.preventDefault();
        gesture.current = {
          pointerId: event.pointerId,
          x: event.screenX,
          y: event.screenY,
          size: { width: window.innerWidth, height: window.innerHeight },
          target: event.currentTarget,
        };
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch (reason) {
          finish();
          error.current(reason);
        }
      }}
      onPointerMove={(event) => {
        const active = gesture.current;
        if (!active || event.pointerId !== active.pointerId) return;
        if (!(event.buttons & 1)) return finish();
        resize({
          width: active.size.width + event.screenX - active.x,
          height: active.size.height + event.screenY - active.y,
        });
      }}
      onPointerUp={(event) => {
        const active = gesture.current;
        if (!active || event.pointerId !== active.pointerId) return;
        resize({
          width: active.size.width + event.screenX - active.x,
          height: active.size.height + event.screenY - active.y,
        });
        finish();
      }}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && gesture.current) {
          resize(gesture.current.size);
          finish();
          return;
        }
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        resize({
          width: window.innerWidth + (event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0),
          height: window.innerHeight + (event.key === 'ArrowUp' ? -16 : event.key === 'ArrowDown' ? 16 : 0),
        });
      }}
    >
      <Grip className="size-3" />
    </Button>
  );
}
