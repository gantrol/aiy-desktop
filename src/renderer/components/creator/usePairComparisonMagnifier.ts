import { useEffect, useRef, useState, type WheelEvent as ReactWheelEvent } from 'react';
import {
  consumeImageMagnifierWheel,
  stepImageMagnifierScale,
  type ImageMagnifierPoint,
  type ImageMagnifierWheelState,
  useTransientImageMagnifierFeedback,
} from '@/renderer/components/creator/ImageMagnifier';
import type { PairComparisonMode, PairComparisonSlot } from '@/renderer/components/creator/PairComparisonView';

interface Options {
  active: boolean;
  mode: PairComparisonMode;
  onActiveChange(active: boolean): void;
  onOverlayMixChange(mix: number): void;
  onScaleChange(scale: number): void;
  overlayMix: number;
  resolveSample(clientX: number, clientY: number): PairComparisonMagnifierSample | null;
  scale: number;
  soloSlot: PairComparisonSlot | null;
  sourceAId: string;
  sourceBId: string;
}

export interface PairComparisonMagnifierSample {
  anchor: { left: number; top: number };
  point: ImageMagnifierPoint;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function isPairComparisonMagnifierControl(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('[data-magnifier-control], [data-swipe-divider]'));
}

export function usePairComparisonMagnifier({
  active,
  mode,
  onActiveChange,
  onOverlayMixChange,
  onScaleChange,
  overlayMix,
  resolveSample,
  scale,
  soloSlot,
  sourceAId,
  sourceBId,
}: Options) {
  const altPressedRef = useRef(false);
  const wheelState = useRef<ImageMagnifierWheelState>({ accumulatedDelta: 0, lastEventAt: 0 });
  const scaleRef = useRef(scale);
  const overlayMixRef = useRef(overlayMix);
  const previousOverlayMixRef = useRef(overlayMix);
  const previousActiveRef = useRef(active);
  const [sample, setSample] = useState<PairComparisonMagnifierSample | null>(null);
  const [sampleLocked, setSampleLocked] = useState(false);
  const {
    hide: hideScaleFeedback,
    show: showScaleFeedback,
    visible: scaleFeedbackVisible,
  } = useTransientImageMagnifierFeedback();
  const {
    hide: hideOpacityFeedback,
    show: showOpacityFeedback,
    visible: opacityFeedbackVisible,
  } = useTransientImageMagnifierFeedback();

  useEffect(() => {
    const becameActive = active && !previousActiveRef.current;
    previousActiveRef.current = active;
    if (active) {
      if (becameActive) {
        wheelState.current = { accumulatedDelta: 0, lastEventAt: 0 };
        scaleRef.current = 1;
        onScaleChange(1);
        showScaleFeedback();
      }
      return;
    }
    wheelState.current = { accumulatedDelta: 0, lastEventAt: 0 };
    setSample(null);
    setSampleLocked(false);
    hideScaleFeedback();
    hideOpacityFeedback();
  }, [active, hideOpacityFeedback, hideScaleFeedback, onScaleChange, showScaleFeedback]);

  useEffect(() => {
    const keyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Alt') altPressedRef.current = true;
    };
    const keyUp = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Alt') altPressedRef.current = false;
    };
    const clearModifier = () => {
      altPressedRef.current = false;
    };
    window.addEventListener('keydown', keyDown, true);
    window.addEventListener('keyup', keyUp, true);
    window.addEventListener('blur', clearModifier);
    return () => {
      window.removeEventListener('keydown', keyDown, true);
      window.removeEventListener('keyup', keyUp, true);
      window.removeEventListener('blur', clearModifier);
    };
  }, []);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    const changed = previousOverlayMixRef.current !== overlayMix;
    previousOverlayMixRef.current = overlayMix;
    overlayMixRef.current = overlayMix;
    if (changed && active && mode === 'OVERLAY' && !soloSlot) showOpacityFeedback();
  }, [active, mode, overlayMix, showOpacityFeedback, soloSlot]);

  useEffect(() => {
    if (mode !== 'OVERLAY' || soloSlot) hideOpacityFeedback();
  }, [hideOpacityFeedback, mode, soloSlot]);

  useEffect(() => {
    wheelState.current = { accumulatedDelta: 0, lastEventAt: 0 };
    setSample(null);
    setSampleLocked(false);
    hideScaleFeedback();
    hideOpacityFeedback();
  }, [hideOpacityFeedback, hideScaleFeedback, sourceAId, sourceBId]);

  useEffect(() => {
    if (!active) return undefined;
    const keyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (sampleLocked) setSampleLocked(false);
      else onActiveChange(false);
    };
    window.addEventListener('keydown', keyDown);
    return () => window.removeEventListener('keydown', keyDown);
  }, [active, onActiveChange, sampleLocked]);

  function lockSample(clientX: number, clientY: number) {
    const nextSample = resolveSample(clientX, clientY);
    if (!nextSample) return false;
    setSample(nextSample);
    setSampleLocked(true);
    return true;
  }

  function moveSample(clientX: number, clientY: number, target: EventTarget | null) {
    if (!active || sampleLocked || isPairComparisonMagnifierControl(target)) return;
    setSample(resolveSample(clientX, clientY));
  }

  function onWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!event.deltaY || isPairComparisonMagnifierControl(event.target)) return;
    const nextSample = active && sampleLocked ? sample : resolveSample(event.clientX, event.clientY);
    if (!nextSample) return;

    const opacityWheel =
      mode === 'OVERLAY' && !soloSlot && (event.altKey || event.getModifierState('Alt') || altPressedRef.current);
    if (opacityWheel) {
      event.preventDefault();
      wheelState.current = { accumulatedDelta: 0, lastEventAt: 0 };
      if (!sampleLocked) setSample(nextSample);
      if (!active) {
        scaleRef.current = 1;
        onScaleChange(1);
        onActiveChange(true);
      }
      const nextOverlayMix = clamp(overlayMixRef.current + (event.deltaY > 0 ? -5 : 5), 0, 100);
      if (nextOverlayMix !== overlayMixRef.current) {
        overlayMixRef.current = nextOverlayMix;
        onOverlayMixChange(nextOverlayMix);
        showOpacityFeedback();
      }
      return;
    }

    if (!active) {
      if (event.deltaY > 0) return;
      event.preventDefault();
      wheelState.current = { accumulatedDelta: 0, lastEventAt: 0 };
      scaleRef.current = 1;
      setSample(nextSample);
      setSampleLocked(false);
      onScaleChange(1);
      onActiveChange(true);
      return;
    }

    event.preventDefault();
    if (!sampleLocked) setSample(nextSample);
    const consumed = consumeImageMagnifierWheel(wheelState.current, event);
    wheelState.current = consumed.state;
    if (consumed.direction === null) return;
    const nextScale = stepImageMagnifierScale(scaleRef.current, consumed.direction);
    if (nextScale === null) {
      onActiveChange(false);
      return;
    }
    if (nextScale === scaleRef.current) return;
    scaleRef.current = nextScale;
    onScaleChange(nextScale);
    showScaleFeedback();
  }

  return {
    lockSample,
    moveSample,
    onPointerLeave: () => {
      if (active && !sampleLocked) setSample(null);
    },
    onWheel,
    opacityFeedbackVisible,
    sample,
    sampleLocked,
    scaleFeedbackVisible,
  };
}
