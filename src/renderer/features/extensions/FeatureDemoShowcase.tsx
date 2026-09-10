import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { DownloadIcon, PauseIcon, PlayIcon, RotateCcwIcon, SquareIcon } from 'lucide-react';
import type { BootstrapDto, ExtensionDto } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Slider } from '@/renderer/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import {
  downloadFeatureDemoVideo,
  exportFeatureDemoVideo,
} from '@/renderer/features/extensions/feature-demo/featureDemoExport';
import { FeatureDemoStage } from '@/renderer/features/extensions/feature-demo/FeatureDemoStage';
import {
  FEATURE_DEMO_PREVIEW_HEIGHT,
  FEATURE_DEMO_PREVIEW_WIDTH,
  featureDemoDuration,
  featureDemoSceneAt,
  featureDemoSceneStart,
} from '@/renderer/features/extensions/feature-demo/featureDemoTimeline';
import { createFeatureDemoRunPlan } from '@/renderer/features/extensions/feature-demo/featureDemoRunPlan';
import { useFeatureDemoVideoSnapshot } from '@/renderer/features/extensions/feature-demo/useFeatureDemoVideoSnapshot';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

interface FeatureDemoShowcaseProps {
  active: boolean;
  data: BootstrapDto;
  extensions: readonly ExtensionDto[];
  notify(message: string): void;
}

function formatTime(seconds: number) {
  const bounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(bounded / 60);
  return `${minutes}:${String(bounded % 60).padStart(2, '0')}`;
}

function afterPaint() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
}

const DemoV050Showcase = lazy(() =>
  import('@/renderer/features/extensions/feature-demo/v050/DemoV050Showcase').then((module) => ({
    default: module.DemoV050Showcase,
  })),
);

export function FeatureDemoShowcase(props: FeatureDemoShowcaseProps) {
  const copy = useI18n().messages.extensions.featureDemo;
  return (
    <Tabs defaultValue="v050" className="grid gap-4">
      <TabsList>
        <TabsTrigger value="v050">{copy.v050.title}</TabsTrigger>
        <TabsTrigger value="features">{copy.title}</TabsTrigger>
      </TabsList>
      <TabsContent value="v050">
        <Suspense fallback={null}>
          <DemoV050Showcase active={props.active} />
        </Suspense>
      </TabsContent>
      <TabsContent value="features">
        <CurrentFeatureDemoShowcase {...props} />
      </TabsContent>
    </Tabs>
  );
}

function CurrentFeatureDemoShowcase({ active, data, notify }: FeatureDemoShowcaseProps) {
  const { messages } = useI18n();
  const l = messages.extensions.featureDemo;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const timeRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [stageScale, setStageScale] = useState(1);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [demoData] = useState(data);
  const [plan] = useState(() => createFeatureDemoRunPlan(data));
  const duration = featureDemoDuration(plan.scenes);
  const position = featureDemoSceneAt(time, plan.scenes);
  const exporting = exportProgress !== null;
  const videoState = useFeatureDemoVideoSnapshot(active && (position.scene.id === 'videoDocument' || exporting));
  const stageBusy =
    position.scene.id === 'videoDocument' && (videoState.status === 'loading' || videoState.status === 'idle');

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateScale = () => setStageScale(viewport.clientWidth / FEATURE_DEMO_PREVIEW_WIDTH);
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!active || !playing || stageBusy) return;
    let previousFrameAt = performance.now();
    let lastPublishedAt = 0;
    const tick = (now: number) => {
      const next = timeRef.current + (now - previousFrameAt) / 1000;
      previousFrameAt = now;
      if (next >= duration) {
        timeRef.current = duration;
        setTime(duration);
        setPlaying(false);
        return;
      }
      timeRef.current = next;
      if (now - lastPublishedAt >= 33) {
        lastPublishedAt = now;
        setTime(next);
      }
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };
    animationFrameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    };
  }, [active, duration, playing, stageBusy]);

  useEffect(
    () => () => {
      exportAbortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!active) exportAbortRef.current?.abort();
  }, [active]);

  function seek(next: number) {
    const bounded = Math.min(duration, Math.max(0, next));
    timeRef.current = bounded;
    setTime(bounded);
  }

  function stopPlayback() {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setPlaying(false);
  }

  function togglePlayback() {
    if (playing) stopPlayback();
    else {
      if (timeRef.current >= duration) seek(0);
      setPlaying(true);
    }
  }

  function replay() {
    seek(0);
    setPlaying(true);
  }

  function selectScene(sceneIndex: number) {
    stopPlayback();
    seek(featureDemoSceneStart(sceneIndex, plan.scenes));
  }

  function scrub(next: number) {
    stopPlayback();
    seek(next);
  }

  async function exportVideo() {
    if (exporting) {
      exportAbortRef.current?.abort();
      return;
    }
    const stage = stageRef.current;
    if (!stage) return;
    const restoreTime = timeRef.current;
    const resumePlayback = playing;
    const controller = new AbortController();
    exportAbortRef.current = controller;
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    flushSync(() => setPlaying(false));
    setExportProgress(0);
    try {
      await document.fonts.ready;
      const video = await exportFeatureDemoVideo({
        stage,
        scenes: plan.scenes,
        signal: controller.signal,
        onProgress: setExportProgress,
        renderAt: async (nextTime) => {
          flushSync(() => seek(nextTime));
          await afterPaint();
        },
      });
      downloadFeatureDemoVideo(video);
      notify(l.exported);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) notify(l.exportFailed);
    } finally {
      exportAbortRef.current = null;
      setExportProgress(null);
      flushSync(() => seek(restoreTime));
      if (resumePlayback) setPlaying(true);
    }
  }

  return (
    <section data-feature-demo-showcase className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{l.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{formatTime(duration)} · 2560×1440 · 30 FPS</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={exporting} onClick={togglePlayback}>
            {playing ? <PauseIcon className="size-3.5" /> : <PlayIcon className="size-3.5" />}
            {playing ? l.pause : l.play}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={exporting} onClick={replay}>
            <RotateCcwIcon className="size-3.5" />
            {l.replay}
          </Button>
          <Button type="button" size="sm" onClick={() => void exportVideo()}>
            {exporting ? <SquareIcon className="size-3.5" /> : <DownloadIcon className="size-3.5" />}
            {exporting ? l.cancelExport : l.export2k}
          </Button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {plan.scenes.map((scene, index) => (
          <Button
            type="button"
            key={scene.id}
            variant="ghost"
            disabled={exporting}
            aria-pressed={position.scene.id === scene.id}
            className={cn(
              'h-auto justify-start whitespace-normal px-3 py-2 text-left text-xs',
              position.scene.id === scene.id && 'bg-selected font-semibold text-selected-foreground',
            )}
            onClick={() => selectScene(index)}
          >
            {l.scenes[scene.id].title}
          </Button>
        ))}
      </div>

      <div className="grid gap-2">
        <div ref={viewportRef} className="relative aspect-video w-full overflow-hidden border bg-muted">
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{
              width: FEATURE_DEMO_PREVIEW_WIDTH,
              height: FEATURE_DEMO_PREVIEW_HEIGHT,
              transform: `scale(${stageScale})`,
            }}
          >
            <FeatureDemoStage
              ref={stageRef}
              data={demoData}
              videoState={videoState}
              plan={plan}
              timeInSeconds={time}
              notify={notify}
              key={plan.seed}
            />
          </div>
        </div>
        <Slider
          disabled={exporting}
          value={[time]}
          min={0}
          max={duration}
          step={1 / 30}
          aria-label={l.timelineAria}
          aria-valuetext={`${formatTime(time)} / ${formatTime(duration)}`}
          onValueChange={([value]) => scrub(value ?? 0)}
        />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{l.scenes[position.scene.id].title}</span>
          <span>
            {formatTime(time)} / {formatTime(duration)}
          </span>
        </div>
      </div>

      {exporting && (
        <div className="grid gap-2 rounded-md border bg-background p-3">
          <div className="flex items-center justify-between text-xs font-medium">
            <span>{l.exporting}</span>
            <span>{Math.round(exportProgress * 100)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary" style={{ width: `${exportProgress * 100}%` }} />
          </div>
        </div>
      )}
    </section>
  );
}
