import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/renderer/lib/utils';

export interface ImageMagnifierPoint {
  x: number;
  y: number;
}

export interface ImageMagnifierLayer {
  id: string;
  src: string;
  width: number;
  height: number;
  point?: ImageMagnifierPoint;
  opacity?: number;
  clipPath?: string;
}

interface Props {
  diameter: number;
  label: string;
  layers: readonly ImageMagnifierLayer[];
  point: ImageMagnifierPoint;
  scale: number;
  className?: string;
  children?: ReactNode;
}

export const imageMagnifierScales = [1, 1.5, 2, 3, 4] as const;

export interface ImageMagnifierWheelState {
  accumulatedDelta: number;
  lastEventAt: number;
}

interface ImageMagnifierWheelInput {
  ctrlKey: boolean;
  deltaMode: number;
  deltaY: number;
  timeStamp: number;
}

const WHEEL_IDLE_RESET_MS = 180;
const WHEEL_STEP_PX = 32;
const PINCH_STEP_PX = 8;
const FEEDBACK_VISIBLE_MS = 700;

export function consumeImageMagnifierWheel(
  state: ImageMagnifierWheelState,
  input: ImageMagnifierWheelInput,
): { direction: -1 | 1 | null; state: ImageMagnifierWheelState } {
  const pixelDelta = input.deltaY * (input.deltaMode === 1 ? 16 : input.deltaMode === 2 ? 120 : 1);
  if (!pixelDelta) return { direction: null, state };

  const idle = state.lastEventAt > 0 && input.timeStamp - state.lastEventAt > WHEEL_IDLE_RESET_MS;
  const reversed = state.accumulatedDelta !== 0 && Math.sign(state.accumulatedDelta) !== Math.sign(pixelDelta);
  const accumulatedDelta = (idle || reversed ? 0 : state.accumulatedDelta) + pixelDelta;
  const nextState = { accumulatedDelta, lastEventAt: input.timeStamp };
  const threshold = input.ctrlKey ? PINCH_STEP_PX : WHEEL_STEP_PX;
  if (Math.abs(accumulatedDelta) < threshold) return { direction: null, state: nextState };

  return {
    direction: accumulatedDelta > 0 ? -1 : 1,
    state: { accumulatedDelta: 0, lastEventAt: input.timeStamp },
  };
}

export function stepImageMagnifierScale(current: number, direction: -1 | 1) {
  const currentIndex = imageMagnifierScales.findIndex((candidate) => candidate >= current);
  const index = currentIndex < 0 ? imageMagnifierScales.length - 1 : currentIndex;
  const nextIndex = index + direction;
  if (nextIndex < 0) return null;
  return imageMagnifierScales[Math.min(imageMagnifierScales.length - 1, nextIndex)];
}

export function useTransientImageMagnifierFeedback() {
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<number | null>(null);

  const hide = useCallback(() => {
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
    setVisible(false);
  }, []);

  const show = useCallback(() => {
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    setVisible(true);
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      setVisible(false);
    }, FEEDBACK_VISIBLE_MS);
  }, []);

  useEffect(
    () => () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    },
    [],
  );

  return { hide, show, visible };
}

export function ImageMagnifierScaleBadge({ scale, visible }: { scale: number; visible: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'absolute bottom-2 left-1/2 z-30 -translate-x-1/2 rounded-sm border bg-overlay/90 px-1.5 py-0.5 font-mono text-[10px] leading-none tabular-nums transition-opacity duration-fast motion-reduce:transition-none',
        visible ? 'opacity-100' : 'opacity-0',
      )}
    >
      {scale}×
    </span>
  );
}

export function ImageMagnifier({ diameter, label, layers, point, scale, className, children }: Props) {
  const radius = diameter / 2;

  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        'relative isolate shrink-0 overflow-hidden rounded-full border border-border-strong bg-surface-sunken shadow-sm',
        className,
      )}
      style={{ width: diameter, height: diameter }}
    >
      {layers.map((layer) => {
        const width = Math.max(1, layer.width * scale);
        const height = Math.max(1, layer.height * scale);
        const layerPoint = layer.point ?? point;
        return (
          <span
            key={layer.id}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden"
            style={{ clipPath: layer.clipPath, opacity: layer.opacity }}
          >
            <img
              src={layer.src}
              alt=""
              decoding="async"
              draggable={false}
              className="pointer-events-none absolute max-w-none select-none"
              style={{
                width,
                height,
                left: radius - layerPoint.x * width,
                top: radius - layerPoint.y * height,
              }}
            />
          </span>
        );
      })}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 z-20 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background bg-foreground/75"
      />
      {children}
    </div>
  );
}
