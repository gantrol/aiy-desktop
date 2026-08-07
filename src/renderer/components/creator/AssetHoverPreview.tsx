import type { ReactElement } from 'react';
import type { AssetDto } from '@/shared/contracts';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/renderer/components/ui/hover-card';

interface Props {
  asset: AssetDto | null | undefined;
  children: ReactElement;
  side: 'left' | 'right';
}

export function AssetHoverPreview({ asset, children, side }: Props) {
  if (!asset) return children;

  return (
    <HoverCard openDelay={220} closeDelay={80}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side={side} align="start" sideOffset={10} collisionPadding={12} className="w-auto p-2">
        <img
          src={asset.mediaUrl}
          alt=""
          className="block rounded-sm object-contain"
          style={{ maxWidth: 'min(480px, 68vw)', maxHeight: '72vh' }}
        />
      </HoverCardContent>
    </HoverCard>
  );
}
