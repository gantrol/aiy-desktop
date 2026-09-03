import {
  BlocksIcon,
  CheckIcon,
  CircleAlertIcon,
  DatabaseIcon,
  HardDriveIcon,
  ImageIcon,
  LayoutDashboardIcon,
  PlugZapIcon,
  PowerIcon,
  SlidersHorizontalIcon,
  type LucideIcon,
} from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import type { LocalSpaceTransitionEvent, LocalSpaceTransitionStage, TransitionPreviewDto } from '@/shared/contracts';
import { type TransitionSceneMediaState, type TransitionSceneMotion } from '@/renderer/components/app/AppLoadingState';
import { TransitionPreviewMedia, clampTransitionPreviewAspect } from '@/renderer/components/app/TransitionPreviewMedia';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import './LocalSpaceTransitionOverlay.css';

interface Props {
  transition: LocalSpaceTransitionEvent;
  motion?: TransitionSceneMotion;
  mediaState?: TransitionSceneMediaState;
  previewOnly?: boolean;
  previewReorderLabel?: string;
  onPreviewReorder?(sourceIndex: number, targetIndex: number, afterTarget: boolean): void;
}

const TRANSITION_PREVIEW_DRAG_TYPE = 'application/x-aiy-transition-preview-index';

const stageIcons: Record<LocalSpaceTransitionStage, LucideIcon> = {
  PREPARING: HardDriveIcon,
  OPENING_DATABASE: DatabaseIcon,
  CONNECTING_SERVICES: PlugZapIcon,
  LOADING_EXTENSIONS: BlocksIcon,
  APPLYING_SETTINGS: SlidersHorizontalIcon,
  ACTIVATING: PowerIcon,
  LOADING_INTERFACE: LayoutDashboardIcon,
  READY: CheckIcon,
  FAILED: CircleAlertIcon,
};

const previewSlots = [
  {
    fanY: '5.25rem',
    fanRotate: '-13deg',
    settledRotate: '-2deg',
    revealAt: 32,
  },
  {
    fanY: '2.5rem',
    fanRotate: '-8deg',
    settledRotate: '-1deg',
    revealAt: 16,
  },
  {
    fanY: '0rem',
    fanRotate: '-3deg',
    settledRotate: '0deg',
    revealAt: 0,
  },
  {
    fanY: '0rem',
    fanRotate: '3deg',
    settledRotate: '0deg',
    revealAt: 0,
  },
  {
    fanY: '2.5rem',
    fanRotate: '8deg',
    settledRotate: '1deg',
    revealAt: 16,
  },
  {
    fanY: '5.25rem',
    fanRotate: '13deg',
    settledRotate: '2deg',
    revealAt: 32,
  },
] as const;

const settledStages = new Set<LocalSpaceTransitionStage>(['ACTIVATING', 'LOADING_INTERFACE', 'READY']);

type TransitionPreviewStyle = CSSProperties & Record<`--${string}`, string | number>;

function previewFrameWidth(aspect: number) {
  return Math.min(6.5, Math.max(4.25, aspect * 8.25));
}

function LocalSpaceTransitionPreviewMedia({
  preview,
  mediaState,
}: {
  preview: TransitionPreviewDto | null;
  mediaState: TransitionSceneMediaState;
}) {
  return (
    <TransitionPreviewMedia
      preview={preview}
      requested
      mediaState={mediaState}
      className="local-space-transition-preview-media"
      placeholder={
        <span
          data-transition-preview-placeholder
          className="absolute inset-0 z-0 grid place-items-center bg-surface-sunken text-muted-foreground"
        >
          <ImageIcon className="size-5" />
        </span>
      }
    />
  );
}

export function LocalSpaceTransitionOverlay({
  transition,
  motion = {},
  mediaState = 'ready',
  previewOnly = false,
  previewReorderLabel,
  onPreviewReorder,
}: Props) {
  const { messages } = useI18n();
  const copy = messages.space.transition;
  const labels: Record<LocalSpaceTransitionStage, string> = {
    PREPARING: copy.preparing,
    OPENING_DATABASE: copy.openingDatabase,
    CONNECTING_SERVICES: copy.connectingServices,
    LOADING_EXTENSIONS: copy.loadingExtensions,
    APPLYING_SETTINGS: copy.applyingSettings,
    ACTIVATING: copy.activating,
    LOADING_INTERFACE: copy.loadingInterface,
    READY: copy.ready,
    FAILED: copy.failed,
  };
  const StageIcon = stageIcons[transition.stage];
  const stageLabel = labels[transition.stage];
  const ready = transition.stage === 'READY';
  const failed = transition.stage === 'FAILED';
  const settled = settledStages.has(transition.stage);
  const speedMultiplier = Math.max(0.25, motion.speedMultiplier ?? 1);
  const [draggingPreviewIndex, setDraggingPreviewIndex] = useState<number | null>(null);
  const [dropPreviewIndex, setDropPreviewIndex] = useState<number | null>(null);
  const previewsSortable = previewOnly && Boolean(onPreviewReorder);
  const renderedPreviewSlots = previewOnly || transition.previews.length > 0 ? previewSlots : [];

  return (
    <div
      data-local-space-transition
      data-transition-owner="space"
      data-stage={transition.stage}
      data-progress={transition.progress}
      data-motion-paused={motion.paused ? 'true' : undefined}
      data-reduced-motion={motion.reduced ? 'true' : undefined}
      data-overlay-layer={previewOnly ? undefined : 'takeover'}
      className={cn(
        'local-space-transition absolute inset-0 grid place-items-center overflow-hidden bg-background',
        previewOnly ? 'z-0' : 'z-takeover',
      )}
      style={
        {
          '--space-transition-card-duration': `${320 / speedMultiplier}ms`,
          '--space-transition-stage-duration': `${160 / speedMultiplier}ms`,
          '--space-transition-logo-duration': `${1.8 / speedMultiplier}s`,
        } as TransitionPreviewStyle
      }
      role={previewOnly ? undefined : 'status'}
      aria-live={previewOnly ? undefined : 'polite'}
      aria-label={previewOnly ? undefined : `${transition.space.name}: ${stageLabel}`}
    >
      <div
        data-transition-showcase-export-backdrop
        className="pointer-events-none absolute inset-0 grid place-items-center"
        aria-hidden="true"
      >
        <div className="size-[30rem] rounded-full bg-selected opacity-20 blur-3xl" />
      </div>

      <div
        key={motion.replayKey ?? 0}
        className={cn(
          'local-space-transition-card relative flex w-[min(44rem,calc(100%-3rem))] flex-col items-center transition-opacity duration-base',
          ready && !previewOnly && 'opacity-0',
        )}
      >
        <div
          className="relative h-72 w-full"
          data-local-space-preview-count={transition.previews.length}
          data-preview-state={transition.previews.length > 0 ? 'available' : 'empty'}
          aria-hidden={previewsSortable ? undefined : 'true'}
          role={previewsSortable ? 'list' : undefined}
        >
          {renderedPreviewSlots.map((slot, index) => {
            const directPreview = transition.previews[index] ?? null;
            const preview =
              directPreview ??
              (!previewOnly && transition.previews.length > 0
                ? transition.previews[index % transition.previews.length]!
                : null);
            const aspect = preview ? clampTransitionPreviewAspect(preview.width, preview.height) : 0.75;
            const revealed = transition.progress >= slot.revealAt || ready || failed;
            const previewSortable = previewsSortable && directPreview !== null;
            return (
              <div
                key={preview ? `${index}-${preview.url}-${preview.detailUrl ?? preview.url}` : `placeholder-${index}`}
                className="local-space-transition-preview-anchor absolute top-1 grid h-40 place-items-start"
                style={{ left: `${index * (100 / previewSlots.length)}%`, width: `${100 / previewSlots.length}%` }}
              >
                <div
                  role={previewSortable ? 'listitem' : undefined}
                  tabIndex={previewSortable ? 0 : undefined}
                  draggable={previewSortable}
                  aria-label={previewSortable ? `${previewReorderLabel ?? ''} ${index + 1}`.trim() : undefined}
                  title={previewSortable ? previewReorderLabel : undefined}
                  data-space-preview={preview ? (mediaState === 'ready' ? 'image' : mediaState) : 'placeholder'}
                  data-preview-aspect={aspect}
                  data-preview-sortable={previewSortable ? 'true' : undefined}
                  data-preview-dragging={draggingPreviewIndex === index ? 'true' : undefined}
                  data-preview-drop-target={dropPreviewIndex === index ? 'true' : undefined}
                  className={cn(
                    'local-space-transition-preview relative z-10 max-w-[calc(100%-.25rem)] origin-bottom overflow-hidden rounded-xl border bg-surface shadow-overlay',
                    revealed ? 'opacity-100 blur-0' : 'opacity-0 blur-sm',
                    previewSortable &&
                      'cursor-grab outline-none hover:ring-2 hover:ring-ring focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing',
                    draggingPreviewIndex === index && 'opacity-40',
                    dropPreviewIndex === index &&
                      draggingPreviewIndex !== index &&
                      'ring-2 ring-ring ring-offset-2 ring-offset-background',
                  )}
                  style={
                    {
                      '--preview-aspect': aspect,
                      '--preview-fan-y': slot.fanY,
                      '--preview-fan-rotation': slot.fanRotate,
                      '--preview-settled-rotation': slot.settledRotate,
                      '--preview-scale': revealed ? 1 : 0.75,
                      '--preview-transition-delay': `${index * 35}ms`,
                      width: `${previewFrameWidth(aspect)}rem`,
                    } as TransitionPreviewStyle
                  }
                  data-settled={settled ? 'true' : undefined}
                  onDragStart={(event) => {
                    if (!previewSortable) return;
                    setDraggingPreviewIndex(index);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData(TRANSITION_PREVIEW_DRAG_TYPE, String(index));
                    event.dataTransfer.setData('text/plain', String(index));
                  }}
                  onDragEnd={() => {
                    setDraggingPreviewIndex(null);
                    setDropPreviewIndex(null);
                  }}
                  onDragOver={(event) => {
                    if (!previewSortable || draggingPreviewIndex === index) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setDropPreviewIndex(index);
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropPreviewIndex(null);
                  }}
                  onDrop={(event) => {
                    if (!previewSortable) return;
                    event.preventDefault();
                    const serializedSourceIndex =
                      event.dataTransfer.getData(TRANSITION_PREVIEW_DRAG_TYPE) ||
                      event.dataTransfer.getData('text/plain');
                    const sourceIndex = draggingPreviewIndex ?? Number.parseInt(serializedSourceIndex, 10);
                    if (Number.isInteger(sourceIndex) && sourceIndex !== index) {
                      const bounds = event.currentTarget.getBoundingClientRect();
                      onPreviewReorder?.(sourceIndex, index, event.clientX >= bounds.left + bounds.width / 2);
                    }
                    setDraggingPreviewIndex(null);
                    setDropPreviewIndex(null);
                  }}
                  onKeyDown={(event) => {
                    if (!previewSortable || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) {
                      return;
                    }
                    const targetIndex = index + (event.key === 'ArrowLeft' ? -1 : 1);
                    if (targetIndex < 0 || targetIndex >= transition.previews.length) return;
                    event.preventDefault();
                    onPreviewReorder?.(index, targetIndex, event.key === 'ArrowRight');
                  }}
                >
                  <LocalSpaceTransitionPreviewMedia preview={preview} mediaState={mediaState} />
                  <span className="absolute inset-x-0 bottom-0 z-[3] h-1/3 bg-gradient-to-t from-background/15 to-transparent" />
                </div>
              </div>
            );
          })}

          <div
            className={cn(
              'pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 -translate-y-1/2 transition-[top,transform] duration-overlay ease-enter',
              settled ? 'top-[79%] scale-90' : 'top-1/2 scale-100',
            )}
          >
            <div className="local-space-transition-logo relative h-24 w-28">
              <span className="absolute inset-y-2 left-1 w-1/2 origin-right rotate-[-8deg] rounded-l-2xl border bg-surface shadow-overlay" />
              <span className="absolute inset-y-2 right-1 w-1/2 origin-left rotate-[8deg] rounded-r-2xl border bg-surface shadow-overlay" />
              <span className="absolute inset-x-3 inset-y-1 grid place-items-center overflow-hidden rounded-2xl border bg-surface shadow-overlay">
                <img className="size-16 object-contain" src="./icon.png" alt="" draggable={false} />
                {transition.space.coverUrl && (
                  <img
                    key={transition.space.coverUrl}
                    className="absolute inset-0 size-full object-cover"
                    src={transition.space.coverUrl}
                    alt=""
                    draggable={false}
                    onError={(event) => {
                      event.currentTarget.hidden = true;
                    }}
                  />
                )}
              </span>
              <span
                className={cn(
                  'absolute -bottom-1 -right-1 grid size-8 place-items-center rounded-full border bg-surface text-muted-foreground shadow-overlay transition-colors duration-base',
                  ready && 'border-success bg-success-surface text-success',
                  failed && 'border-destructive bg-destructive-surface text-destructive',
                )}
              >
                <StageIcon className="size-4" />
              </span>
            </div>
          </div>
        </div>

        <div className="-mt-1 w-[min(28rem,100%)]">
          <h2 className="max-w-full truncate text-center text-lg font-semibold text-foreground">
            {transition.space.name}
          </h2>
          <p
            key={transition.stage}
            className="local-space-transition-stage mt-1 text-center text-sm text-muted-foreground"
          >
            {stageLabel}
          </p>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-4 text-xs text-muted-foreground">
              <span>{copy.progressLabel}</span>
              <span className="tabular-nums text-foreground">{transition.progress}%</span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-surface-sunken"
              role="progressbar"
              aria-label={copy.progressLabel}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={transition.progress}
              aria-valuetext={stageLabel}
            >
              <div
                className={cn(
                  'h-full rounded-full bg-selected-foreground transition-[width,background-color] duration-base ease-enter',
                  ready && 'bg-success',
                  failed && 'bg-destructive',
                )}
                style={{ width: `${transition.progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
