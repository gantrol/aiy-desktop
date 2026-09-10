import { useI18n } from '@/renderer/i18n/useI18n';
import { useId, type ReactNode, type Ref } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { usePetalPluck } from '@/renderer/features/desktop-petals/use-petal-pluck';
import { usePetalDrag } from '@/renderer/features/desktop-petals/use-petal-drag';
import { RosePetal, RosePaint } from '@/renderer/features/desktop-petals/RosePetal';
import { PetalShape } from '@/renderer/features/desktop-petals/PetalShape';
import { PetalCaption } from '@/renderer/features/desktop-petals/PetalCaption';
import { PETAL_SHAPE_LAYOUT, PETAL_SHAPE_ANCHOR } from '@/renderer/features/desktop-petals/petal-shape-layout';
import { appearanceStyle } from '@/renderer/features/desktop-petals/petal-appearance';
import { PETAL_WINDOW_SIZES } from '@/shared/contracts/petal-hub';
import {
  FLOWER_PETAL_COUNT,
  FLOWER_CENTER_LAYER,
  ROSE_CENTER,
  ROSE_BUD_SIZE,
  roseBudCenter,
  isPluckableFlowerPetal,
} from '@/shared/flower-geometry';
import '@/renderer/features/desktop-petals/RoseFlower.css';

interface RoseFlowerAppearanceProps {
  size: number;
  center?: ReactNode;
  progress?: { inner: number | null; outer: number | null };
  fold?: number;
  dock?: { x: number; y: number };
  centerLabel?: string;
  onCenterClick?: () => void;
}

interface RoseFlowerProps extends RoseFlowerAppearanceProps {
  onPluck(point?: { x: number; y: number }, dragged?: boolean): Promise<boolean>;
  onError?: (reason: unknown) => void;
  onPreview(active: boolean): Promise<void>;
}

type PluckGesture = ReturnType<typeof usePetalPluck>;

/** Native gestures stay with the desktop host; the view also supports timeline-driven presentation. */
export function RoseFlower({ onPluck, onPreview, onError, ...props }: RoseFlowerProps) {
  const { flower, ...gesture } = usePetalPluck(onPluck, props.size, onPreview, onError);
  const { handlers: drag } = usePetalDrag(props.onCenterClick, onError);
  return <RoseFlowerView {...props} {...gesture} flowerRef={flower} drag={drag} />;
}

/** The overhead rose exposes only its outer petals to plucking. Inner paint blocks clicks behind it. */
export function RoseFlowerView({
  size,
  center,
  progress,
  centerLabel,
  onCenterClick,
  fold = 0,
  dock,
  flowerRef,
  pull = null,
  growing = [],
  events,
  finishGrowing,
  drag,
  animate = true,
  showDetachedPetal = true,
}: RoseFlowerAppearanceProps & {
  flowerRef?: Ref<HTMLDivElement>;
  pull?: PluckGesture['pull'];
  growing?: PluckGesture['growing'];
  events?: PluckGesture['events'];
  finishGrowing?: PluckGesture['finishGrowing'];
  drag?: ReturnType<typeof usePetalDrag>['handlers'];
  animate?: boolean;
  showDetachedPetal?: boolean;
}) {
  const { messages } = useI18n();
  const copy = messages.desktopPetals.flower;
  const id = useId();
  const visible = Math.max(0, 1 - fold * 5);
  const scale = 1 + (ROSE_BUD_SIZE / size - 1) * fold;
  const transform = `translate(${100 + (((dock?.x ?? 0) * 200) / size) * fold} ${100 + (((dock?.y ?? 0) * 200) / size) * fold}) scale(${scale}) translate(${-100 - (roseBudCenter.x - 100) * fold} ${-100 - (roseBudCenter.y - 100) * fold})`;
  return (
    <div ref={flowerRef} className="rose-flower relative touch-none select-none" style={{ width: size, height: size }}>
      <svg viewBox="0 0 200 200" className="block size-full overflow-visible" aria-label={copy.title}>
        <RosePaint id={id} fold={fold} />
        <g transform={transform}>
          {Array.from({ length: FLOWER_PETAL_COUNT }, (_, index) => (
            <g
              key={index}
              className={`origin-[100px_100px] transition-[translate,rotate,opacity] ease-out motion-reduce:duration-0 ${(pull?.index === index && pull.phase === 'pulling') || growing.includes(index) ? 'duration-0' : 'duration-180'} ${growing.includes(index) ? 'rose-regrow' : ''}`}
              onAnimationEnd={() => finishGrowing?.(index)}
              style={
                pull?.index === index && !growing.includes(index)
                  ? {
                      transition: animate ? undefined : 'none',
                      translate: `${pull.x}px ${pull.y}px`,
                      rotate: `${Math.max(-5, Math.min(5, pull.x * 0.04))}deg`,
                      opacity: 1 - pull.detached,
                    }
                  : { translate: '0px 0px', rotate: '0deg', opacity: 1, transition: animate ? undefined : 'none' }
              }
            >
              <g
                {...(fold === 0 && isPluckableFlowerPetal(index) ? events?.(index) : {})}
                {...(fold === 0 && !pull && index === FLOWER_CENTER_LAYER
                  ? {
                      onPointerDown: drag?.onPointerDown,
                      onPointerEnter: drag?.onPointerEnter,
                      onDragStart: drag?.onDragStart,
                    }
                  : {})}
                role={isPluckableFlowerPetal(index) ? 'button' : undefined}
                data-flower-petal-id={isPluckableFlowerPetal(index) ? index : undefined}
                tabIndex={isPluckableFlowerPetal(index) ? (fold === 0 ? 0 : -1) : undefined}
                className={
                  isPluckableFlowerPetal(index)
                    ? 'cursor-grab outline-none hover:brightness-110 active:cursor-grabbing focus-visible:brightness-125'
                    : index === FLOWER_CENTER_LAYER
                      ? 'cursor-move'
                      : undefined
                }
                aria-label={
                  isPluckableFlowerPetal(index) ? copy.pluck.replace('{number}', String(index + 1)) : undefined
                }
                aria-hidden={isPluckableFlowerPetal(index) ? undefined : true}
              >
                <RosePetal paintId={id} index={index} fold={fold} />
              </g>
            </g>
          ))}
        </g>
        <g opacity={visible} className="pointer-events-none">
          {progress?.outer != null && (
            <circle
              cx="100"
              cy={ROSE_CENTER.y}
              r={ROSE_CENTER.radius + 3}
              pathLength="100"
              strokeDasharray={`${progress.outer} 100`}
              transform={`rotate(-90 100 ${ROSE_CENTER.y})`}
              stroke="#efb9c8"
              strokeWidth="1.7"
              strokeLinecap="round"
              fill="none"
            />
          )}
          {progress?.inner != null && (
            <circle
              cx="100"
              cy={ROSE_CENTER.y}
              r={ROSE_CENTER.radius}
              pathLength="100"
              strokeDasharray={`${progress.inner} 100`}
              transform={`rotate(-90 100 ${ROSE_CENTER.y})`}
              stroke="#efd4a3"
              strokeWidth="1.7"
              strokeLinecap="round"
              fill="none"
            />
          )}
        </g>
      </svg>
      {/* SVG paint owns pointer hits; the normal HTML button retains text sizing and keyboard activation. */}
      <Button
        variant="ghost"
        type="button"
        className="pointer-events-none absolute left-1/2 size-[25.5%] -translate-x-1/2 -translate-y-1/2 rounded-full p-0 text-media-checker-a hover:bg-transparent active:bg-transparent"
        style={{ top: `${ROSE_CENTER.y / 2}%`, opacity: visible }}
        tabIndex={fold ? -1 : undefined}
        disabled={fold > 0 || Boolean(pull)}
        aria-label={centerLabel ?? (onCenterClick ? messages.desktopPetals.controls.timerAction : copy.drag)}
        title={centerLabel ?? copy.dragHint}
        onClick={drag?.onClick}
      >
        {center}
      </Button>
      {showDetachedPetal && pull && (
        <div
          className={`pointer-events-none absolute flex flex-col items-center justify-center ease-out motion-reduce:duration-0 ${pull.phase === 'pulling' ? '' : 'transition-[left,top,opacity] duration-180'}`}
          aria-hidden="true"
          style={{
            ...appearanceStyle('rose'),
            left: pull.pointerX - PETAL_SHAPE_ANCHOR.x,
            top: pull.pointerY - PETAL_SHAPE_ANCHOR.y,
            width: PETAL_WINDOW_SIZES.collapsed.width,
            height: PETAL_WINDOW_SIZES.collapsed.height,
            opacity: pull.detached,
          }}
        >
          <span
            className="block shrink-0"
            style={{ width: PETAL_SHAPE_LAYOUT.width, height: PETAL_SHAPE_LAYOUT.height }}
          >
            <PetalShape icon="feather" />
          </span>
          <PetalCaption title="" visible={false} />
        </div>
      )}
    </div>
  );
}
