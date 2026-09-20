import { useRef, useState, type ReactNode } from 'react';
import { GripHorizontal } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';

const clamp = (height: number) => Math.min(1200, Math.max(100, height));

/** Local view preference only: resizing never creates a source or host revision. */
export function ContentReferenceViewport({ storageKey, children }: { storageKey: string; children: ReactNode }) {
  const label = useI18n().messages.referenceOutline.resize;
  const [height, setHeight] = useState(() => {
    try {
      const value = Number(localStorage.getItem(storageKey));
      return value >= 100 && value <= 1200 ? value : 240;
    } catch {
      return 240;
    }
  });
  const current = useRef(height);
  const drag = useRef<{ y: number; height: number } | null>(null);
  const resize = (next: number, persist = false) => {
    current.current = clamp(next);
    setHeight(current.current);
    if (persist) {
      try {
        localStorage.setItem(storageKey, String(current.current));
      } catch {
        /* A view preference is optional. */
      }
    }
  };
  return (
    <>
      <div className="min-h-0 overflow-y-auto overscroll-contain break-words pr-2" style={{ maxHeight: height }}>
        {children}
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-5 w-full touch-none cursor-ns-resize rounded-none text-muted-foreground"
        aria-label={label}
        title={label}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          drag.current = { y: event.clientY, height: current.current };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current) resize(drag.current.height + event.clientY - drag.current.y);
        }}
        onPointerUp={(event) => {
          if (!drag.current) return;
          drag.current = null;
          resize(current.current, true);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => {
          if (drag.current) {
            resize(current.current, true);
            drag.current = null;
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          event.stopPropagation();
          resize(current.current + (event.key === 'ArrowUp' ? -24 : 24), true);
        }}
      >
        <GripHorizontal className="size-3.5" />
      </Button>
    </>
  );
}
