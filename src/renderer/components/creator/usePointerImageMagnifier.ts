import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  consumeImageMagnifierWheel,
  stepImageMagnifierScale,
  type ImageMagnifierPoint,
  type ImageMagnifierWheelState,
  useTransientImageMagnifierFeedback,
} from '@/renderer/components/creator/ImageMagnifier';

export interface PointerImageMagnifierSample {
  point: ImageMagnifierPoint;
  left: number;
  top: number;
  imageWidth: number;
  imageHeight: number;
}

interface Options {
  active: boolean;
  enabled: boolean;
  imageRef: RefObject<HTMLImageElement | null>;
  onActiveChange(active: boolean): void;
  sourceId: string;
  viewportRef: RefObject<HTMLDivElement | null>;
  viewportSize: { width: number; height: number };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function usePointerImageMagnifier({
  active,
  enabled,
  imageRef,
  onActiveChange,
  sourceId,
  viewportRef,
  viewportSize,
}: Options) {
  const wheelState = useRef<ImageMagnifierWheelState>({ accumulatedDelta: 0, lastEventAt: 0 });
  const scaleRef = useRef(1);
  const [scale, setScale] = useState(1);
  const [sample, setSample] = useState<PointerImageMagnifierSample | null>(null);
  const {
    hide: hideScaleFeedback,
    show: showScaleFeedback,
    visible: scaleFeedbackVisible,
  } = useTransientImageMagnifierFeedback();
  const diameter = Math.min(180, Math.max(96, Math.min(viewportSize.width, viewportSize.height) - 24));

  useEffect(() => {
    wheelState.current = { accumulatedDelta: 0, lastEventAt: 0 };
    scaleRef.current = 1;
    setScale(1);
    setSample(null);
    hideScaleFeedback();
  }, [hideScaleFeedback, sourceId]);

  useEffect(() => {
    if (active) {
      wheelState.current = { accumulatedDelta: 0, lastEventAt: 0 };
      scaleRef.current = 1;
      setScale(1);
      showScaleFeedback();
    } else {
      wheelState.current = { accumulatedDelta: 0, lastEventAt: 0 };
      setSample(null);
      hideScaleFeedback();
    }
  }, [active, hideScaleFeedback, showScaleFeedback]);

  function sampleAt(clientX: number, clientY: number) {
    const viewport = viewportRef.current;
    const image = imageRef.current;
    if (!viewport || !image) return null;
    const viewportBounds = viewport.getBoundingClientRect();
    const imageBounds = image.getBoundingClientRect();
    const insideImage =
      clientX >= imageBounds.left &&
      clientX <= imageBounds.right &&
      clientY >= imageBounds.top &&
      clientY <= imageBounds.bottom;
    if (!insideImage || !imageBounds.width || !imageBounds.height) return null;
    const radius = diameter / 2;
    const horizontalInset = Math.min(radius + 8, viewportBounds.width / 2);
    const verticalInset = Math.min(radius + 8, viewportBounds.height / 2);
    return {
      point: {
        x: clamp((clientX - imageBounds.left) / imageBounds.width, 0, 1),
        y: clamp((clientY - imageBounds.top) / imageBounds.height, 0, 1),
      },
      left: clamp(clientX - viewportBounds.left, horizontalInset, viewportBounds.width - horizontalInset),
      top: clamp(clientY - viewportBounds.top, verticalInset, viewportBounds.height - verticalInset),
      imageWidth: imageBounds.width,
      imageHeight: imageBounds.height,
    } satisfies PointerImageMagnifierSample;
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!active) return;
    setSample(sampleAt(event.clientX, event.clientY));
  }

  function onWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!enabled || !event.deltaY) return;
    const nextSample = sampleAt(event.clientX, event.clientY);
    if (!nextSample) return;

    if (!active) {
      if (event.deltaY > 0) return;
      event.preventDefault();
      wheelState.current = { accumulatedDelta: 0, lastEventAt: 0 };
      scaleRef.current = 1;
      setScale(1);
      setSample(nextSample);
      onActiveChange(true);
      return;
    }

    event.preventDefault();
    setSample(nextSample);
    const consumed = consumeImageMagnifierWheel(wheelState.current, event);
    wheelState.current = consumed.state;
    const { direction } = consumed;
    if (direction === null) return;
    const nextScale = stepImageMagnifierScale(scaleRef.current, direction);
    if (nextScale === null) {
      onActiveChange(false);
      return;
    }
    if (nextScale === scaleRef.current) return;
    scaleRef.current = nextScale;
    setScale(nextScale);
    showScaleFeedback();
  }

  return {
    diameter,
    onPointerLeave: () => setSample(null),
    onPointerMove,
    onScroll: () => setSample(null),
    onWheel,
    sample,
    scale,
    scaleFeedbackVisible,
  };
}
