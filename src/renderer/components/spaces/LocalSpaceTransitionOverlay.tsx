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
import type { LocalSpaceTransitionEvent, LocalSpaceTransitionStage } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

interface Props {
  transition: LocalSpaceTransitionEvent;
}

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
    fan: 'left-[3%] top-[34%] rotate-[-13deg]',
    settled: 'left-[1%] top-[12%] rotate-[-2deg]',
    revealAt: 72,
  },
  {
    fan: 'left-[16%] top-[18%] rotate-[-8deg]',
    settled: 'left-[17.5%] top-[12%] rotate-[-1deg]',
    revealAt: 55,
  },
  {
    fan: 'left-[30%] top-[7%] rotate-[-3deg]',
    settled: 'left-[34%] top-[12%] rotate-0',
    revealAt: 20,
  },
  {
    fan: 'left-[55%] top-[7%] rotate-[3deg]',
    settled: 'left-[50.5%] top-[12%] rotate-0',
    revealAt: 20,
  },
  {
    fan: 'left-[69%] top-[18%] rotate-[8deg]',
    settled: 'left-[67%] top-[12%] rotate-[1deg]',
    revealAt: 55,
  },
  {
    fan: 'left-[82%] top-[34%] rotate-[13deg]',
    settled: 'left-[83%] top-[12%] rotate-[2deg]',
    revealAt: 72,
  },
] as const;

const settledStages = new Set<LocalSpaceTransitionStage>(['ACTIVATING', 'LOADING_INTERFACE', 'READY']);

export function LocalSpaceTransitionOverlay({ transition }: Props) {
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
  const fullColor = transition.progress >= 82 || ready;

  return (
    <div
      data-local-space-transition
      data-stage={transition.stage}
      data-progress={transition.progress}
      className={cn(
        'local-space-transition absolute inset-0 z-50 grid place-items-center overflow-hidden bg-background transition-opacity duration-base',
        ready && 'pointer-events-none opacity-0',
      )}
      role="status"
      aria-live="polite"
      aria-label={`${transition.space.name}: ${stageLabel}`}
    >
      <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
        <div className="size-[30rem] rounded-full bg-selected opacity-60 blur-3xl" />
      </div>

      <div className="local-space-transition-card relative flex w-[min(44rem,calc(100%-3rem))] flex-col items-center">
        <div
          className="relative h-72 w-full"
          data-local-space-preview-count={transition.previewUrls.length}
          aria-hidden="true"
        >
          {previewSlots.map((slot, index) => {
            const previewUrl =
              transition.previewUrls.length > 0 ? transition.previewUrls[index % transition.previewUrls.length] : null;
            const revealed = transition.progress >= slot.revealAt || ready || failed;
            return (
              <div
                key={`${previewUrl ?? 'placeholder'}-${index}`}
                data-space-preview={previewUrl ? 'image' : 'placeholder'}
                className={cn(
                  'absolute z-10 aspect-[3/4] w-[15%] min-w-[4.75rem] max-w-[6.5rem] origin-bottom overflow-hidden rounded-xl border bg-surface shadow-overlay transition-[left,top,opacity,transform,filter] duration-overlay ease-enter',
                  settled ? slot.settled : slot.fan,
                  revealed ? 'scale-100 opacity-100 blur-0' : 'scale-75 opacity-0 blur-sm',
                  fullColor ? 'saturate-100' : 'saturate-50',
                )}
                style={{ transitionDelay: `${index * 35}ms` }}
              >
                {previewUrl ? (
                  <img
                    className="size-full bg-surface-sunken object-contain"
                    src={previewUrl}
                    alt=""
                    draggable={false}
                  />
                ) : (
                  <div className="grid size-full place-items-center bg-surface-sunken text-muted-foreground">
                    <ImageIcon className="size-5" />
                  </div>
                )}
                <span className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-background/30 to-transparent" />
              </div>
            );
          })}

          <div
            className={cn(
              'absolute left-1/2 z-20 -translate-x-1/2 -translate-y-1/2 transition-[top,transform] duration-overlay ease-enter',
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
                    className="absolute inset-0 size-full object-contain"
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
