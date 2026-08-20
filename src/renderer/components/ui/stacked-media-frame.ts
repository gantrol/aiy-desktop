import type { CSSProperties } from 'react';

export const stackedMediaFrameLayerClassName = 'z-[var(--stacked-media-frame-layer)]';
export const stackedMediaFrameLiftClassName = 'hover:z-20 focus-visible:z-20';

interface StackedMediaFrameStyle extends CSSProperties {
  '--stacked-media-frame-layer': number;
}

export function stackedMediaFrameStyle(layer: number, style: CSSProperties): StackedMediaFrameStyle {
  return { ...style, '--stacked-media-frame-layer': layer };
}
