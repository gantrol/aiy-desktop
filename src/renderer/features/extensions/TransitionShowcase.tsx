import { useMemo, useState, type ReactNode } from 'react';
import { PauseIcon, PlayIcon, RotateCcwIcon } from 'lucide-react';
import type { LocalSpaceTransitionEvent, LocalSpaceTransitionStage, TransitionPreviewDto } from '@/shared/contracts';
import {
  PortraitFilmScene,
  PolaroidScene,
  type TransitionSceneMediaState,
} from '@/renderer/components/app/AppLoadingState';
import { LocalSpaceTransitionOverlay } from '@/renderer/components/spaces/LocalSpaceTransitionOverlay';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Slider } from '@/renderer/components/ui/slider';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

type ShowcaseScene = 'portrait' | 'ribbon' | 'space';
type ShowcaseSource = 'real' | 'stress';
type ShowcaseAspect = 'mixed' | 'landscape' | 'portrait' | 'square' | 'extreme';
type ShowcaseViewport = 'desktop' | 'tablet' | 'mobile';
type ShowcaseSpeed = 'half' | 'normal' | 'double';

const SHOWCASE_STAGES: readonly LocalSpaceTransitionStage[] = [
  'PREPARING',
  'OPENING_DATABASE',
  'CONNECTING_SERVICES',
  'LOADING_EXTENSIONS',
  'APPLYING_SETTINGS',
  'ACTIVATING',
  'LOADING_INTERFACE',
  'READY',
  'FAILED',
];

const STRESS_DIMENSIONS: Record<ShowcaseAspect, readonly (readonly [number, number])[]> = {
  mixed: [
    [216, 288],
    [288, 216],
    [240, 240],
    [420, 120],
    [120, 420],
    [320, 200],
  ],
  landscape: [
    [320, 180],
    [400, 200],
    [640, 240],
    [900, 120],
  ],
  portrait: [
    [180, 320],
    [200, 400],
    [240, 640],
    [120, 900],
  ],
  square: [
    [240, 240],
    [320, 320],
  ],
  extreme: [
    [900, 120],
    [120, 900],
    [640, 180],
    [180, 640],
  ],
};

const SPEED_MULTIPLIERS: Record<ShowcaseSpeed, number> = { half: 0.5, normal: 1, double: 2 };

function fixtureUrl(width: number, height: number, index: number) {
  const hue = (index * 47 + width + height) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${hue} 72% 68%)"/><stop offset="1" stop-color="hsl(${(hue + 75) % 360} 64% 34%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="72%" cy="24%" r="12%" fill="white" fill-opacity=".42"/><path d="M0 ${height * 0.76} L${width * 0.34} ${height * 0.38} L${width * 0.58} ${height * 0.68} L${width} ${height * 0.28} V${height} H0Z" fill="black" fill-opacity=".24"/><text x="50%" y="53%" text-anchor="middle" dominant-baseline="middle" fill="white" font-family="system-ui" font-size="${Math.max(12, Math.min(width, height) * 0.13)}" font-weight="600">${width}×${height}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function stressPreviews(aspect: ShowcaseAspect): TransitionPreviewDto[] {
  const dimensions = STRESS_DIMENSIONS[aspect];
  return Array.from({ length: 24 }, (_, index) => {
    const [width, height] = dimensions[index % dimensions.length]!;
    const url = fixtureUrl(width, height, index);
    const detailUrl = url.replace('charset=utf-8', 'profile=detail;charset=utf-8');
    return { url, detailUrl, width, height };
  });
}

function matchesAspect(preview: TransitionPreviewDto, aspect: ShowcaseAspect) {
  if (aspect === 'mixed') return true;
  const ratio = preview.width / preview.height;
  if (aspect === 'landscape') return ratio > 1.1 && ratio <= 2;
  if (aspect === 'portrait') return ratio < 0.9 && ratio >= 0.5;
  if (aspect === 'square') return ratio >= 0.9 && ratio <= 1.1;
  return ratio < 0.5 || ratio > 2;
}

function Control({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      {children}
    </div>
  );
}

export function TransitionShowcase({ realPreviews }: { realPreviews: readonly TransitionPreviewDto[] }) {
  const { messages } = useI18n();
  const l = messages.extensions.transitionShowcase;
  const [scene, setScene] = useState<ShowcaseScene>('portrait');
  const [source, setSource] = useState<ShowcaseSource>('stress');
  const [aspect, setAspect] = useState<ShowcaseAspect>('mixed');
  const [mediaState, setMediaState] = useState<TransitionSceneMediaState>('ready');
  const [viewport, setViewport] = useState<ShowcaseViewport>('desktop');
  const [speed, setSpeed] = useState<ShowcaseSpeed>('normal');
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const [stage, setStage] = useState<LocalSpaceTransitionStage>('CONNECTING_SERVICES');
  const [progress, setProgress] = useState(44);

  const previews = useMemo(
    () =>
      source === 'stress'
        ? stressPreviews(aspect)
        : realPreviews.filter((preview) => matchesAspect(preview, aspect)).slice(0, 24),
    [aspect, realPreviews, source],
  );
  const motion = {
    paused,
    reduced,
    replayKey,
    speedMultiplier: SPEED_MULTIPLIERS[speed],
  };
  const stageLabels: Record<LocalSpaceTransitionStage, string> = {
    PREPARING: messages.space.transition.preparing,
    OPENING_DATABASE: messages.space.transition.openingDatabase,
    CONNECTING_SERVICES: messages.space.transition.connectingServices,
    LOADING_EXTENSIONS: messages.space.transition.loadingExtensions,
    APPLYING_SETTINGS: messages.space.transition.applyingSettings,
    ACTIVATING: messages.space.transition.activating,
    LOADING_INTERFACE: messages.space.transition.loadingInterface,
    READY: messages.space.transition.ready,
    FAILED: messages.space.transition.failed,
  };
  const spaceTransition: LocalSpaceTransitionEvent = {
    phase: stage === 'FAILED' ? 'FAILED' : stage === 'READY' ? 'COMPLETED' : 'PROGRESS',
    stage,
    progress,
    space: {
      id: 'transition-showcase',
      name: l.title,
      coverUrl: null,
      isCurrent: false,
      available: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastOpenedAt: '2026-01-01T00:00:00.000Z',
    },
    previews: previews.slice(0, 6),
  };

  return (
    <section data-transition-showcase className="grid gap-4 rounded-lg border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{l.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{l.imageCount(previews.length)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setPaused((current) => !current)}>
            {paused ? <PlayIcon className="size-3.5" /> : <PauseIcon className="size-3.5" />}
            {paused ? l.resume : l.pause}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setReplayKey((current) => current + 1)}>
            <RotateCcwIcon className="size-3.5" />
            {l.replay}
          </Button>
          <label className="flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-medium">
            <Checkbox checked={reduced} onCheckedChange={(checked) => setReduced(checked === true)} />
            {l.reducedMotion}
          </label>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Control label={l.scene}>
          <Segmented
            type="single"
            value={scene}
            aria-label={l.scene}
            className="w-full"
            onValueChange={(value) => value && setScene(value as ShowcaseScene)}
          >
            {(Object.keys(l.scenes) as ShowcaseScene[]).map((value) => (
              <SegmentedItem value={value} className="flex-1 px-2" key={value}>
                {l.scenes[value]}
              </SegmentedItem>
            ))}
          </Segmented>
        </Control>
        <Control label={l.source}>
          <Select value={source} onValueChange={(value) => setSource(value as ShowcaseSource)}>
            <SelectTrigger aria-label={l.source}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(l.sources) as ShowcaseSource[]).map((value) => (
                <SelectItem value={value} key={value}>
                  {l.sources[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Control>
        <Control label={l.aspect}>
          <Select value={aspect} onValueChange={(value) => setAspect(value as ShowcaseAspect)}>
            <SelectTrigger aria-label={l.aspect}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(l.aspects) as ShowcaseAspect[]).map((value) => (
                <SelectItem value={value} key={value}>
                  {l.aspects[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Control>
        <Control label={l.mediaState}>
          <Select value={mediaState} onValueChange={(value) => setMediaState(value as TransitionSceneMediaState)}>
            <SelectTrigger aria-label={l.mediaState}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(l.mediaStates) as TransitionSceneMediaState[]).map((value) => (
                <SelectItem value={value} key={value}>
                  {l.mediaStates[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Control>
        <Control label={l.viewport}>
          <Select value={viewport} onValueChange={(value) => setViewport(value as ShowcaseViewport)}>
            <SelectTrigger aria-label={l.viewport}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(l.viewports) as ShowcaseViewport[]).map((value) => (
                <SelectItem value={value} key={value}>
                  {l.viewports[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Control>
        <Control label={l.speed}>
          <Select value={speed} onValueChange={(value) => setSpeed(value as ShowcaseSpeed)}>
            <SelectTrigger aria-label={l.speed}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(l.speeds) as ShowcaseSpeed[]).map((value) => (
                <SelectItem value={value} key={value}>
                  {l.speeds[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Control>
      </div>

      {scene === 'space' && (
        <div className="grid items-end gap-4 rounded-md border bg-background p-3 sm:grid-cols-[minmax(12rem,1fr)_2fr]">
          <Control label={l.stage}>
            <Select value={stage} onValueChange={(value) => setStage(value as LocalSpaceTransitionStage)}>
              <SelectTrigger aria-label={l.stage}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHOWCASE_STAGES.map((value) => (
                  <SelectItem value={value} key={value}>
                    {stageLabels[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Control>
          <Control label={`${l.progress}: ${progress}%`}>
            <Slider
              value={[progress]}
              min={0}
              max={100}
              step={1}
              aria-label={l.progress}
              aria-valuetext={`${progress}%`}
              onValueChange={([value]) => setProgress(value ?? 0)}
            />
          </Control>
        </div>
      )}

      {source === 'real' && previews.length === 0 && (
        <p className="rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">{l.realEmpty}</p>
      )}

      <div className="grid min-h-[32rem] place-items-center overflow-auto rounded-lg border bg-surface-sunken p-3">
        <div
          data-showcase-viewport={viewport}
          aria-label={l.previewAria}
          className={cn(
            'transition-showcase-stage relative shrink-0 overflow-hidden rounded-md border bg-background shadow-overlay',
            viewport === 'desktop' && 'h-[32rem] w-full',
            viewport === 'tablet' && 'h-[32rem] w-[min(42rem,100%)]',
            viewport === 'mobile' && 'h-[36rem] w-[22rem] max-w-full',
          )}
        >
          {scene === 'space' ? (
            <LocalSpaceTransitionOverlay
              transition={spaceTransition}
              motion={motion}
              mediaState={mediaState}
              previewOnly
            />
          ) : (
            <div data-app-loading-state className="grid size-full place-items-center overflow-hidden bg-background">
              {scene === 'portrait' ? (
                <PortraitFilmScene previews={previews} motion={motion} mediaState={mediaState} />
              ) : (
                <PolaroidScene previews={previews} motion={motion} mediaState={mediaState} />
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
