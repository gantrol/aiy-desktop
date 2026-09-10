import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AssetThumbnail } from '@/renderer/components/media/AssetThumbnail';

interface Props {
  assetId?: string;
  active: boolean;
  icon: LucideIcon;
}

export function OutlineNodePreview({ assetId, active, icon: Icon }: Props) {
  const frameRef = useRef<HTMLSpanElement>(null);
  const [admitted, setAdmitted] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const frame = frameRef.current;
    if (!active || !assetId || admitted || !frame) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setAdmitted(true);
        observer.disconnect();
      },
      {
        root: frame.closest<HTMLElement>('[data-slot="scroll-area-viewport"]'),
        rootMargin: '160px 0px',
      },
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, [active, admitted, assetId]);

  return (
    <span
      ref={frameRef}
      aria-hidden="true"
      className="pointer-events-none flex size-7 shrink-0 items-center justify-center"
    >
      {active && admitted && assetId && !failed ? (
        <AssetThumbnail
          asset={{ id: assetId }}
          size={96}
          width={28}
          height={28}
          className="size-7 rounded-sm object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon className="size-4 shrink-0 text-muted-foreground" />
      )}
    </span>
  );
}
