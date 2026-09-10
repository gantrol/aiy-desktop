import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DownloadIcon,
  ImagesIcon,
  LoaderCircleIcon,
  MaximizeIcon,
  MinimizeIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
} from 'lucide-react';
import type {
  FacetDefinitionDto,
  LocalSpaceTransitionEvent,
  LocalSpaceTransitionStage,
  TermListItem,
  TransitionPreviewDto,
} from '@/shared/contracts';
import {
  PortraitFilmScene,
  PolaroidScene,
  type TransitionSceneMediaState,
  type TransitionSceneMotion,
} from '@/renderer/components/app/AppLoadingState';
import { LocalSpaceTransitionOverlay } from '@/renderer/components/spaces/LocalSpaceTransitionOverlay';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Slider } from '@/renderer/components/ui/slider';
import { TransitionImagePickerDialog } from '@/renderer/features/extensions/TransitionImagePickerDialog';
import {
  type TransitionShowcaseAspect,
  type TransitionShowcaseScene,
  type TransitionShowcaseSource,
  type TransitionShowcaseSpeed,
  type TransitionShowcaseStoredImage,
  type TransitionShowcaseViewport,
  reorderTransitionShowcaseImages,
  useTransitionShowcasePreferences,
} from '@/renderer/features/extensions/transitionShowcasePreferences';
import {
  type MaterialImagePickerMaterialImage,
  useMaterialImagePickerMaterials,
} from '@/renderer/components/gallery/useMaterialImagePickerData';
import { useTransitionShowcasePngExport } from '@/renderer/features/extensions/transitionShowcasePngExport';
import { useElementFullscreen } from '@/renderer/hooks/useElementFullscreen';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

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

const STRESS_DIMENSIONS: Record<TransitionShowcaseAspect, readonly (readonly [number, number])[]> = {
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

const SPEED_MULTIPLIERS: Record<TransitionShowcaseSpeed, number> = { half: 0.5, normal: 1, double: 2 };
const MIN_DEFAULT_MATERIAL_IMAGES = 6;
const ALL_MATERIALS_COLLECTION = { kind: 'all' } as const;

type TransitionShowcasePreview = TransitionPreviewDto & { sourceImageId?: string };

function fixtureUrl(width: number, height: number, index: number) {
  const hue = (index * 47 + width + height) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${hue} 72% 68%)"/><stop offset="1" stop-color="hsl(${(hue + 75) % 360} 64% 34%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="72%" cy="24%" r="12%" fill="white" fill-opacity=".42"/><path d="M0 ${height * 0.76} L${width * 0.34} ${height * 0.38} L${width * 0.58} ${height * 0.68} L${width} ${height * 0.28} V${height} H0Z" fill="black" fill-opacity=".24"/><text x="50%" y="53%" text-anchor="middle" dominant-baseline="middle" fill="white" font-family="system-ui" font-size="${Math.max(12, Math.min(width, height) * 0.13)}" font-weight="600">${width}×${height}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function stressPreviews(aspect: TransitionShowcaseAspect): TransitionShowcasePreview[] {
  const dimensions = STRESS_DIMENSIONS[aspect];
  return Array.from({ length: 24 }, (_, index) => {
    const [width, height] = dimensions[index % dimensions.length]!;
    const url = fixtureUrl(width, height, index);
    const detailUrl = url.replace('charset=utf-8', 'profile=detail;charset=utf-8');
    return { url, detailUrl, width, height };
  });
}

function matchesAspect(preview: TransitionPreviewDto, aspect: TransitionShowcaseAspect) {
  if (aspect === 'mixed') return true;
  const ratio = preview.width / preview.height;
  if (aspect === 'landscape') return ratio > 1.1 && ratio <= 2;
  if (aspect === 'portrait') return ratio < 0.9 && ratio >= 0.5;
  if (aspect === 'square') return ratio >= 0.9 && ratio <= 1.1;
  return ratio < 0.5 || ratio > 2;
}

function showcasePreviews(
  materialImages: readonly MaterialImagePickerMaterialImage[],
  manualImages: readonly TransitionShowcaseStoredImage[],
  source: TransitionShowcaseSource,
  aspect: TransitionShowcaseAspect,
): TransitionShowcasePreview[] {
  if (source === 'stress') return stressPreviews(aspect);
  const images =
    source === 'real'
      ? materialImages.map(({ asset }) => ({
          id: asset.id,
          mediaUrl: asset.mediaUrl,
          width: asset.width,
          height: asset.height,
        }))
      : manualImages;
  return images
    .map((image) => ({
      sourceImageId: image.id,
      url: image.mediaUrl,
      detailUrl: image.mediaUrl,
      width: image.width,
      height: image.height,
    }))
    .filter((preview) => matchesAspect(preview, aspect))
    .slice(0, 24);
}

function showcaseSpaceTransition(
  stage: LocalSpaceTransitionStage,
  progress: number,
  spaceName: string,
  previews: readonly TransitionPreviewDto[],
): LocalSpaceTransitionEvent {
  return {
    phase: stage === 'FAILED' ? 'FAILED' : stage === 'READY' ? 'COMPLETED' : 'PROGRESS',
    stage,
    progress,
    space: {
      id: 'transition-showcase',
      name: spaceName,
      coverUrl: null,
      isCurrent: false,
      available: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastOpenedAt: '2026-01-01T00:00:00.000Z',
    },
    previews: previews.slice(0, 6),
  };
}

function showcaseStageLabels(
  messages: ReturnType<typeof useI18n>['messages'],
): Record<LocalSpaceTransitionStage, string> {
  return {
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
}

function Control({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      {children}
    </div>
  );
}

function TransitionShowcaseHeader({
  imageCount,
  manualImageCount,
  canChooseImages,
  exporting,
  paused,
  reduced,
  onChooseImages,
  onExport,
  onTogglePaused,
  onReplay,
  onReducedChange,
}: {
  imageCount: number;
  manualImageCount: number;
  canChooseImages: boolean;
  exporting: boolean;
  paused: boolean;
  reduced: boolean;
  onChooseImages(): void;
  onExport(): void;
  onTogglePaused(): void;
  onReplay(): void;
  onReducedChange(reduced: boolean): void;
}) {
  const { messages } = useI18n();
  const l = messages.extensions.transitionShowcase;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold">{l.title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{l.imageCount(imageCount)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          data-action="transition-choose-images"
          type="button"
          variant="outline"
          size="sm"
          disabled={!canChooseImages}
          onClick={onChooseImages}
        >
          <ImagesIcon className="size-3.5" />
          {l.chooseImages}
          {manualImageCount > 0 && ` · ${manualImageCount}`}
        </Button>
        <Button type="button" size="sm" disabled={exporting} onClick={onExport}>
          {exporting ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : <DownloadIcon className="size-3.5" />}
          {exporting ? l.exportingPng : l.exportTransparentPng}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onTogglePaused}>
          {paused ? <PlayIcon className="size-3.5" /> : <PauseIcon className="size-3.5" />}
          {paused ? l.resume : l.pause}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onReplay}>
          <RotateCcwIcon className="size-3.5" />
          {l.replay}
        </Button>
        <label className="flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-medium">
          <Checkbox checked={reduced} onCheckedChange={(checked) => onReducedChange(checked === true)} />
          {l.reducedMotion}
        </label>
      </div>
    </div>
  );
}

function TransitionShowcaseMaterialStatus({
  loading,
  failed,
  empty,
}: {
  loading: boolean;
  failed: boolean;
  empty: boolean;
}) {
  const l = useI18n().messages.extensions.transitionShowcase;
  return (
    <>
      {loading && (
        <p className="rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">{l.loadingMaterials}</p>
      )}
      {failed && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {l.materialsLoadFailed}
        </p>
      )}
      {empty && (
        <p className="rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">{l.realEmpty}</p>
      )}
    </>
  );
}

function TransitionShowcaseStage({
  exporting,
  fullscreen,
  mediaState,
  motion,
  onPreviewReorder,
  previews,
  previewStageRef,
  scene,
  spaceTransition,
  toggleFullscreen,
  viewport,
}: {
  exporting: boolean;
  fullscreen: boolean;
  mediaState: TransitionSceneMediaState;
  motion: TransitionSceneMotion;
  onPreviewReorder?: (sourceIndex: number, targetIndex: number, afterTarget: boolean) => void;
  previews: readonly TransitionPreviewDto[];
  previewStageRef: ReturnType<typeof useElementFullscreen<HTMLDivElement>>['targetRef'];
  scene: TransitionShowcaseScene;
  spaceTransition: LocalSpaceTransitionEvent;
  toggleFullscreen: ReturnType<typeof useElementFullscreen<HTMLDivElement>>['toggleFullscreen'];
  viewport: TransitionShowcaseViewport;
}) {
  const l = useI18n().messages.extensions.transitionShowcase;
  return (
    <div className="grid min-h-[32rem] place-items-center overflow-auto rounded-lg border bg-background p-3">
      <div
        ref={previewStageRef}
        data-showcase-viewport={viewport}
        data-showcase-fullscreen={fullscreen ? 'true' : undefined}
        aria-label={l.previewAria}
        className={cn(
          'transition-showcase-stage relative isolate shrink-0 overflow-hidden rounded-md border bg-background shadow-overlay',
          viewport === 'desktop' && 'h-[32rem] w-full',
          viewport === 'tablet' && 'h-[32rem] w-[min(42rem,100%)]',
          viewport === 'mobile' && 'h-[36rem] w-[22rem] max-w-full',
          fullscreen && 'fixed inset-0 z-fullscreen m-0 h-dvh w-dvw max-w-none rounded-none border-0',
        )}
      >
        <Button
          data-transition-showcase-export-exclude
          type="button"
          variant="outline"
          size="icon-sm"
          className="absolute right-3 top-3 z-chrome bg-overlay/95 shadow-overlay backdrop-blur-sm"
          aria-label={fullscreen ? l.exitFullscreen : l.enterFullscreen}
          aria-pressed={fullscreen}
          title={fullscreen ? l.exitFullscreen : l.enterFullscreen}
          onClick={() => void toggleFullscreen()}
        >
          {fullscreen ? <MinimizeIcon className="size-4" /> : <MaximizeIcon className="size-4" />}
        </Button>
        {scene === 'space' ? (
          <LocalSpaceTransitionOverlay
            transition={spaceTransition}
            motion={motion}
            mediaState={mediaState}
            previewOnly
            previewReorderLabel={l.dragToReorder}
            onPreviewReorder={onPreviewReorder}
          />
        ) : (
          <div data-app-loading-state className="grid size-full place-items-center overflow-hidden bg-background">
            {scene === 'portrait' ? (
              <PortraitFilmScene
                previews={previews}
                motion={motion}
                mediaState={mediaState}
                loadAllPreviews={exporting && mediaState === 'ready'}
              />
            ) : (
              <PolaroidScene previews={previews} motion={motion} mediaState={mediaState} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TransitionShowcaseSpaceControls({
  progress,
  stage,
  stageLabels,
  onProgressChange,
  onStageChange,
}: {
  progress: number;
  stage: LocalSpaceTransitionStage;
  stageLabels: Record<LocalSpaceTransitionStage, string>;
  onProgressChange(progress: number): void;
  onStageChange(stage: LocalSpaceTransitionStage): void;
}) {
  const l = useI18n().messages.extensions.transitionShowcase;
  return (
    <div className="grid items-end gap-4 rounded-md border bg-background p-3 sm:grid-cols-[minmax(12rem,1fr)_2fr]">
      <Control label={l.stage}>
        <Select value={stage} onValueChange={(value) => onStageChange(value as LocalSpaceTransitionStage)}>
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
          onValueChange={([value]) => onProgressChange(value ?? 0)}
        />
      </Control>
    </div>
  );
}

interface TransitionShowcaseProps {
  active?: boolean;
  libraryKey?: string;
  dataRevision?: number;
  terms?: readonly TermListItem[];
  facets?: readonly FacetDefinitionDto[];
  realPreviews?: readonly TransitionPreviewDto[];
  notify?(message: string): void;
}

export function TransitionShowcase({
  active = false,
  libraryKey = 'transition-showcase',
  dataRevision = 0,
  terms = [],
  facets = [],
  notify,
}: TransitionShowcaseProps) {
  const { messages } = useI18n();
  const l = messages.extensions.transitionShowcase;
  const { preferences, updatePreferences } = useTransitionShowcasePreferences(libraryKey, active);
  const materialState = useMaterialImagePickerMaterials({
    active,
    libraryKey,
    dataRevision,
    collection: ALL_MATERIALS_COLLECTION,
  });
  const {
    scene,
    aspect,
    mediaState,
    viewport,
    speed,
    paused,
    reduced,
    stage,
    progress,
    manualImages,
    pickerCollection,
  } = preferences;
  const source =
    preferences.source ??
    (materialState.loading || materialState.images.length >= MIN_DEFAULT_MATERIAL_IMAGES ? 'real' : 'stress');
  const [replayKey, setReplayKey] = useState(0);
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const { fullscreen, targetRef: previewStageRef, toggleFullscreen } = useElementFullscreen<HTMLDivElement>();

  useEffect(() => {
    if (!active) setImagePickerOpen(false);
  }, [active]);

  const previews = useMemo(
    () => showcasePreviews(materialState.images, manualImages, source, aspect),
    [aspect, manualImages, materialState.images, source],
  );
  const exportAssetIds = mediaState === 'ready' ? previews.flatMap((preview) => preview.sourceImageId ?? []) : [];
  const { exporting, exportPng } = useTransitionShowcasePngExport({
    stageRef: previewStageRef,
    assetIds: exportAssetIds,
    scene,
    viewport,
    notify,
    exportedMessage: l.pngExported,
    exportFailedMessage: l.pngExportFailed,
  });
  const motion = {
    paused: paused || imagePickerOpen || exporting,
    reduced,
    replayKey,
    speedMultiplier: SPEED_MULTIPLIERS[speed],
  };
  const stageLabels = showcaseStageLabels(messages);
  const spaceTransition = showcaseSpaceTransition(stage, progress, l.spacePreviewName, previews);

  function reorderManualPreview(sourceIndex: number, targetIndex: number, afterTarget: boolean) {
    const sourceImageId = previews[sourceIndex]?.sourceImageId;
    const targetImageId = previews[targetIndex]?.sourceImageId;
    if (!sourceImageId || !targetImageId) return;
    updatePreferences({
      manualImages: reorderTransitionShowcaseImages(manualImages, sourceImageId, targetImageId, afterTarget),
    });
  }

  return (
    <section data-transition-showcase className="grid gap-4 rounded-lg border bg-background p-4">
      <TransitionShowcaseHeader
        imageCount={previews.length}
        manualImageCount={manualImages.length}
        canChooseImages={active}
        exporting={exporting}
        paused={paused}
        reduced={reduced}
        onChooseImages={() => setImagePickerOpen(true)}
        onExport={() => void exportPng()}
        onTogglePaused={() => updatePreferences({ paused: !paused })}
        onReplay={() => setReplayKey((current) => current + 1)}
        onReducedChange={(nextReduced) => updatePreferences({ reduced: nextReduced })}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Control label={l.scene}>
          <Segmented
            type="single"
            value={scene}
            aria-label={l.scene}
            className="w-full"
            onValueChange={(value) => value && updatePreferences({ scene: value as TransitionShowcaseScene })}
          >
            {(Object.keys(l.scenes) as TransitionShowcaseScene[]).map((value) => (
              <SegmentedItem value={value} className="flex-1 px-2" key={value}>
                {l.scenes[value]}
              </SegmentedItem>
            ))}
          </Segmented>
        </Control>
        <Control label={l.source}>
          <Select
            value={source}
            onValueChange={(value) => {
              const next = value as TransitionShowcaseSource;
              if (next === 'manual' && manualImages.length === 0) {
                setImagePickerOpen(true);
                return;
              }
              updatePreferences({ source: next });
            }}
          >
            <SelectTrigger aria-label={l.source}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(l.sources) as TransitionShowcaseSource[]).map((value) => (
                <SelectItem value={value} key={value}>
                  {l.sources[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Control>
        <Control label={l.aspect}>
          <Select
            value={aspect}
            onValueChange={(value) => updatePreferences({ aspect: value as TransitionShowcaseAspect })}
          >
            <SelectTrigger aria-label={l.aspect}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(l.aspects) as TransitionShowcaseAspect[]).map((value) => (
                <SelectItem value={value} key={value}>
                  {l.aspects[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Control>
        <Control label={l.mediaState}>
          <Select
            value={mediaState}
            onValueChange={(value) => updatePreferences({ mediaState: value as typeof mediaState })}
          >
            <SelectTrigger aria-label={l.mediaState}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(l.mediaStates) as Array<typeof mediaState>).map((value) => (
                <SelectItem value={value} key={value}>
                  {l.mediaStates[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Control>
        <Control label={l.viewport}>
          <Select
            value={viewport}
            onValueChange={(value) => updatePreferences({ viewport: value as TransitionShowcaseViewport })}
          >
            <SelectTrigger aria-label={l.viewport}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(l.viewports) as TransitionShowcaseViewport[]).map((value) => (
                <SelectItem value={value} key={value}>
                  {l.viewports[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Control>
        <Control label={l.speed}>
          <Select
            value={speed}
            onValueChange={(value) => updatePreferences({ speed: value as TransitionShowcaseSpeed })}
          >
            <SelectTrigger aria-label={l.speed}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(l.speeds) as TransitionShowcaseSpeed[]).map((value) => (
                <SelectItem value={value} key={value}>
                  {l.speeds[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Control>
      </div>

      {scene === 'space' && (
        <TransitionShowcaseSpaceControls
          progress={progress}
          stage={stage}
          stageLabels={stageLabels}
          onProgressChange={(nextProgress) => updatePreferences({ progress: nextProgress })}
          onStageChange={(nextStage) => updatePreferences({ stage: nextStage })}
        />
      )}

      <TransitionShowcaseMaterialStatus
        loading={materialState.loading}
        failed={materialState.failed}
        empty={!materialState.loading && !materialState.failed && source !== 'stress' && previews.length === 0}
      />

      <TransitionShowcaseStage
        exporting={exporting}
        fullscreen={fullscreen}
        mediaState={mediaState}
        motion={motion}
        onPreviewReorder={source === 'manual' && manualImages.length > 1 ? reorderManualPreview : undefined}
        previews={previews}
        previewStageRef={previewStageRef}
        scene={scene}
        spaceTransition={spaceTransition}
        toggleFullscreen={toggleFullscreen}
        viewport={viewport}
      />

      <TransitionImagePickerDialog
        open={imagePickerOpen}
        libraryKey={libraryKey}
        dataRevision={dataRevision}
        terms={terms}
        facets={facets}
        collection={pickerCollection}
        selectedImages={manualImages}
        onOpenChange={setImagePickerOpen}
        onCollectionChange={(collection) => updatePreferences({ pickerCollection: collection })}
        onApply={(images) => {
          if (images.length === 0) {
            updatePreferences({
              manualImages: [],
              source: preferences.source === 'manual' ? null : preferences.source,
            });
          } else {
            updatePreferences({ manualImages: images, source: 'manual', aspect: 'mixed' });
          }
          setReplayKey((current) => current + 1);
        }}
      />
    </section>
  );
}
