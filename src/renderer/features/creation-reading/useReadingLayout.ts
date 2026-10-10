import { useEffect, useRef, useState } from 'react';

export type ReadingLayout = 'SINGLE' | 'HORIZONTAL' | 'VERTICAL';
export function useReadingLayout(opened: boolean) {
  const [layout, setLayout] = useState<ReadingLayout>('HORIZONTAL');
  const [ratios, setRatios] = useState({ HORIZONTAL: 50, VERTICAL: 50 });
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const root = useRef<HTMLDivElement>(null),
    dragging = useRef(false);
  useEffect(() => {
    const element = root.current;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setDimensions({ width: rect.width, height: rect.height });
    });
    if (element) observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const effectiveLayout: ReadingLayout =
    layout === 'HORIZONTAL' && dimensions.width < 700
      ? dimensions.height >= 550
        ? 'VERTICAL'
        : 'SINGLE'
      : layout === 'VERTICAL' && dimensions.height < 480
        ? 'SINGLE'
        : layout;
  const split = opened && effectiveLayout !== 'SINGLE';
  const showInput = opened;
  const showOutput = !opened || split;
  const axis = effectiveLayout === 'VERTICAL' ? 'VERTICAL' : 'HORIZONTAL';
  const ratio = ratios[axis];
  const changeRatio = (value: number) =>
    setRatios((current) => ({ ...current, [axis]: Math.max(25, Math.min(75, value)) }));
  return {
    layout,
    setLayout,
    dimensions,
    root,
    dragging,
    effectiveLayout,
    split,
    showInput,
    showOutput,
    ratio,
    changeRatio,
  };
}
