import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ImagePlusIcon, LoaderCircleIcon, RefreshCwIcon } from 'lucide-react';
import type { NaturalWatermarkPosition, NaturalWatermarkProfile } from '@/shared/contracts/natural-watermark';
import { Button } from '@/renderer/components/ui/button';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { NaturalWatermarkMark } from '@/renderer/features/extensions/natural-watermark/NaturalWatermarkMark';
import { clampNaturalWatermarkRatio } from '@/renderer/features/extensions/natural-watermark-editor-model';
import { cn } from '@/renderer/lib/utils';

interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPosition: NaturalWatermarkPosition;
}

const previewRatios = [
  { id: '4:5', value: 4 / 5 },
  { id: '1:1', value: 1 },
  { id: '4:3', value: 4 / 3 },
  { id: '16:9', value: 16 / 9 },
] as const;

type PreviewRatioId = (typeof previewRatios)[number]['id'];

function PreviewFallback() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 800 1000"
      className="absolute inset-0 size-full"
      preserveAspectRatio="xMidYMid slice"
    >
      <rect width="800" height="1000" className="fill-media-surround-dark" />
      <path d="M0 0h800v310H0z" className="fill-media-surround" />
      <path d="M0 680h800v320H0z" className="fill-surface-sunken" />
      <circle cx="400" cy="385" r="145" className="fill-background/70" />
      <path d="M168 1000c16-260 94-405 232-405s216 145 232 405z" className="fill-foreground/20" />
    </svg>
  );
}

function sampledPosition(
  profile: NaturalWatermarkProfile,
  basePosition: NaturalWatermarkPosition,
  sample: NaturalWatermarkPosition | null,
) {
  if (!profile.positionJitter.enabled || !sample) return basePosition;
  const minimumX = Math.max(0, basePosition.x - profile.positionJitter.x);
  const maximumX = Math.min(1, basePosition.x + profile.positionJitter.x);
  const minimumY = Math.max(0, basePosition.y - profile.positionJitter.y);
  const maximumY = Math.min(1, basePosition.y + profile.positionJitter.y);
  return {
    x: minimumX + sample.x * (maximumX - minimumX),
    y: minimumY + sample.y * (maximumY - minimumY),
  };
}

function jitterBounds(profile: NaturalWatermarkProfile, basePosition: NaturalWatermarkPosition) {
  return {
    left: Math.max(0, basePosition.x - profile.positionJitter.x),
    right: Math.min(1, basePosition.x + profile.positionJitter.x),
    top: Math.max(0, basePosition.y - profile.positionJitter.y),
    bottom: Math.min(1, basePosition.y + profile.positionJitter.y),
  };
}

export function NaturalWatermarkPreview({
  profile,
  customLogoUrl,
  disabled,
  importingPreview,
  previewImageUrl,
  zh,
  onImportPreview,
  onPositionChange,
}: {
  profile: NaturalWatermarkProfile;
  customLogoUrl: string | null;
  disabled: boolean;
  importingPreview: boolean;
  previewImageUrl: string | null;
  zh: boolean;
  onImportPreview(): void;
  onPositionChange(position: NaturalWatermarkPosition): void;
}) {
  const safeAreaRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragPositionRef = useRef<NaturalWatermarkPosition | null>(null);
  const [dragPosition, setDragPosition] = useState<NaturalWatermarkPosition | null>(null);
  const [sample, setSample] = useState<NaturalWatermarkPosition | null>(null);
  const [ratioId, setRatioId] = useState<PreviewRatioId>('4:5');
  const basePosition = dragPosition ?? profile.position;
  const previewPosition = sampledPosition(profile, basePosition, sample);
  const bounds = jitterBounds(profile, basePosition);
  const previewRatio = previewRatios.find(({ id }) => id === ratioId)?.value ?? 4 / 5;
  const logoHeight = Math.max(10, Math.round(profile.sizeRatio * 320));

  function moveByKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    const change = event.shiftKey ? 0.05 : 0.01;
    const delta = {
      ArrowLeft: { x: -change, y: 0 },
      ArrowRight: { x: change, y: 0 },
      ArrowUp: { x: 0, y: -change },
      ArrowDown: { x: 0, y: change },
    }[event.key];
    if (!delta || disabled) return;
    event.preventDefault();
    setSample(null);
    onPositionChange({
      x: clampNaturalWatermarkRatio(profile.position.x + delta.x),
      y: clampNaturalWatermarkRatio(profile.position.y + delta.y),
    });
  }

  function beginDrag(event: PointerEvent<HTMLButtonElement>) {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSample(null);
    dragPositionRef.current = { ...profile.position };
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition: { ...profile.position },
    };
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    const safeArea = safeAreaRef.current;
    const mark = markRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !safeArea || !mark) return;
    const safeRect = safeArea.getBoundingClientRect();
    const markRect = mark.getBoundingClientRect();
    const availableWidth = Math.max(1, safeRect.width - markRect.width);
    const availableHeight = Math.max(1, safeRect.height - markRect.height);
    const nextPosition = {
      x: clampNaturalWatermarkRatio(drag.startPosition.x + (event.clientX - drag.startClientX) / availableWidth),
      y: clampNaturalWatermarkRatio(drag.startPosition.y + (event.clientY - drag.startClientY) / availableHeight),
    };
    dragPositionRef.current = nextPosition;
    setDragPosition(nextPosition);
  }

  function finishDrag(event: PointerEvent<HTMLButtonElement>, commit: boolean) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    const finalPosition = dragPositionRef.current;
    dragRef.current = null;
    dragPositionRef.current = null;
    setDragPosition(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (commit && finalPosition) onPositionChange(finalPosition);
  }

  function positionAtPointer(event: PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0) return;
    const safeArea = safeAreaRef.current;
    const mark = markRef.current;
    if (!safeArea || !mark) return;
    const safeRect = safeArea.getBoundingClientRect();
    const markRect = mark.getBoundingClientRect();
    const availableWidth = Math.max(1, safeRect.width - markRect.width);
    const availableHeight = Math.max(1, safeRect.height - markRect.height);
    setSample(null);
    onPositionChange({
      x: clampNaturalWatermarkRatio((event.clientX - safeRect.left - markRect.width / 2) / availableWidth),
      y: clampNaturalWatermarkRatio((event.clientY - safeRect.top - markRect.height / 2) / availableHeight),
    });
  }

  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{zh ? '预览' : 'Preview'}</span>
        <Segmented
          type="single"
          value={ratioId}
          aria-label={zh ? '预览比例' : 'Preview aspect ratio'}
          onValueChange={(value) => value && setRatioId(value as PreviewRatioId)}
        >
          {previewRatios.map(({ id }) => (
            <SegmentedItem key={id} value={id} className="px-2.5 tabular-nums">
              {id}
            </SegmentedItem>
          ))}
        </Segmented>
        <div className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
          <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onImportPreview}>
            {importingPreview ? (
              <LoaderCircleIcon className="size-3.5 animate-spin" />
            ) : (
              <ImagePlusIcon className="size-3.5" />
            )}
            {zh ? '预览图' : 'Preview image'}
          </Button>
          <span>X {Math.round(basePosition.x * 100)}%</span>
          <span>Y {Math.round(basePosition.y * 100)}%</span>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={disabled || !profile.positionJitter.enabled}
            aria-label={zh ? '刷新随机位置' : 'Refresh random position'}
            title={zh ? '刷新随机位置' : 'Refresh random position'}
            onClick={() => setSample({ x: Math.random(), y: Math.random() })}
          >
            <RefreshCwIcon className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="grid h-96 min-w-0 place-items-center overflow-hidden bg-surface-sunken p-3 sm:p-4">
        <div
          className="relative max-w-full overflow-hidden border bg-media-surround"
          style={{ aspectRatio: String(previewRatio), width: `min(100%, calc(22rem * ${previewRatio}))` }}
        >
          {previewImageUrl ? (
            <img src={previewImageUrl} alt="" draggable={false} className="absolute inset-0 size-full object-contain" />
          ) : (
            <PreviewFallback />
          )}
          <div
            ref={safeAreaRef}
            className={cn('absolute inset-[3%] touch-none', disabled ? 'cursor-default' : 'cursor-crosshair')}
            onPointerDown={positionAtPointer}
          >
            {profile.positionJitter.enabled && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute min-h-2 min-w-2 border border-dashed border-media-checker-a/70 bg-media-surround-dark/15"
                style={{
                  left: `${bounds.left * 100}%`,
                  right: `${(1 - bounds.right) * 100}%`,
                  top: `${bounds.top * 100}%`,
                  bottom: `${(1 - bounds.bottom) * 100}%`,
                }}
              />
            )}
            <button
              ref={markRef}
              type="button"
              disabled={disabled}
              aria-label={zh ? '拖动水印位置' : 'Drag watermark position'}
              className={cn(
                'absolute max-w-[94%] touch-none rounded-sm border border-media-checker-a/20 bg-media-surround-dark/40 px-1.5 py-1 outline-none backdrop-blur-sm focus-visible:ring-2 focus-visible:ring-ring',
                disabled ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
              )}
              style={{
                left: `${previewPosition.x * 100}%`,
                top: `${previewPosition.y * 100}%`,
                opacity: profile.opacity,
                transform: `translate(-${previewPosition.x * 100}%, -${previewPosition.y * 100}%)`,
              }}
              onKeyDown={moveByKeyboard}
              onPointerDown={beginDrag}
              onPointerMove={moveDrag}
              onPointerUp={(event) => finishDrag(event, true)}
              onPointerCancel={(event) => finishDrag(event, false)}
            >
              <NaturalWatermarkMark profile={profile} customLogoUrl={customLogoUrl} logoHeight={logoHeight} dark />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
