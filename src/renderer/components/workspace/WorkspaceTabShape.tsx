// Fixed end caps preserve the chosen curve as tab titles grow or shrink.
const curve = 'M0 31.5H3C8 31.5 9.8 28.7 11 23.5L14 10.5C15.2 5.3 18 0.5 24 0.5';

function TabCurveEnd({ mirrored = false }: { mirrored?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 32"
      preserveAspectRatio="none"
      className="h-full w-6 shrink-0 overflow-visible"
      aria-hidden="true"
      focusable="false"
    >
      <g transform={mirrored ? 'translate(24 0) scale(-1 1)' : undefined}>
        <path d={`${curve}V32H0Z`} className="fill-background" />
        <path d={curve} fill="none" className="stroke-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
  );
}

/** Decorative only: the buttons retain their existing rectangular hit targets. */
export function WorkspaceTabShape({ selected }: { selected: boolean }) {
  return (
    <div
      aria-hidden="true"
      data-selected={selected}
      className="pointer-events-none absolute inset-y-0 -inset-x-2 z-0 flex opacity-0 transition-opacity duration-fast ease-[var(--ease-standard)] data-[selected=true]:opacity-100 motion-reduce:transition-none"
    >
      <TabCurveEnd />
      <div className="min-w-0 flex-1 border-t border-border bg-background" />
      <TabCurveEnd mirrored />
    </div>
  );
}
