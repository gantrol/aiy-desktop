import { useId } from 'react';
import type { PetalIcon } from '@/shared/contracts/desktop-petals';
import { PetalNoteIcon } from '@/renderer/features/desktop-petals/petal-appearance';

export interface PetalSignal {
  label: string;
  color: string;
  active: boolean;
}
const outline =
  'M60 134C47 119 20 105 17 69C14 42 28 22 45 25C53 26 57 32 64 27C81 14 102 27 105 52C110 84 87 111 60 134Z';

/** Task state colors the existing rim and casts a soft halo around the unchanged silhouette. */
export function PetalShape({
  icon,
  signal,
  compact = false,
}: {
  icon?: PetalIcon;
  signal?: PetalSignal;
  compact?: boolean;
}) {
  const id = useId();
  return (
    <span className="relative block size-full">
      <svg
        className="pointer-events-none block size-full"
        viewBox={compact ? '13 20 96 116' : '0 0 122 158'}
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <filter id={`${id}-halo`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="white" stopOpacity=".25" />
            <stop offset=".5" stopColor="white" stopOpacity="0" />
            <stop offset="1" stopColor="black" stopOpacity=".17" />
          </linearGradient>
        </defs>
        {signal && (
          <g className={signal.active ? 'motion-safe:animate-pulse' : undefined}>
            <path d={outline} stroke={signal.color} strokeWidth="9" opacity=".36" filter={`url(#${id}-halo)`} />
          </g>
        )}
        <path d={outline} fill="var(--petal-surface)" stroke="var(--petal-edge)" />
        <path d={outline} fill={`url(#${id})`} />
        <path
          d="M23 63C24 40 34 27 46 30C54 32 57 37 64 32C80 20 97 30 100 52"
          stroke={signal?.color ?? 'var(--petal-edge)'}
          strokeWidth="3.6"
          strokeLinecap="round"
          className="transition-[stroke] duration-300 motion-reduce:duration-0"
        />
      </svg>
      {icon && (
        <PetalNoteIcon
          icon={icon}
          className="absolute left-1/2 top-[36%] size-4 -translate-x-1/2 text-[var(--petal-ink)]"
        />
      )}
    </span>
  );
}
