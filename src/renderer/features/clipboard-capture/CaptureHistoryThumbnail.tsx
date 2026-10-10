import { useEffect, useRef, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import type { ClipboardHistoryController } from '@/renderer/features/clipboard-capture/useClipboardHistory';

/** Visible thumbnails only; the host serializes decoding and bounds its thumbnail cache. */
export function CaptureHistoryThumbnail({
  id,
  execute,
}: {
  id: string;
  execute: ClipboardHistoryController['execute'];
}) {
  const element = useRef<HTMLSpanElement>(null);
  const [source, setSource] = useState<string>();
  useEffect(() => {
    let current = true;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void execute({ kind: 'thumbnail', id })
        .then((result) => {
          if (current && result.kind === 'detail' && result.image) setSource(result.image);
        })
        .catch(() => undefined);
    });
    if (element.current) observer.observe(element.current);
    return () => {
      current = false;
      observer.disconnect();
    };
  }, [id, execute]);
  return (
    <span ref={element} className="grid h-12 w-20 shrink-0 place-items-center bg-muted/40">
      {source ? (
        <img src={source} alt="" className="size-full object-contain" />
      ) : (
        <ImageIcon className="size-4 text-muted-foreground" />
      )}
    </span>
  );
}
