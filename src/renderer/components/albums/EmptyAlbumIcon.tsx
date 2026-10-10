import type { SVGProps } from 'react';
import { AlbumGlyphIcon } from '@/renderer/icons';

export function EmptyAlbumIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="5" y="3" width="18" height="22" rx="2" />
      <path d="M9 3v22" />
      <AlbumGlyphIcon x="9" y="7" width="14" height="14" shaded={false} />
    </svg>
  );
}
